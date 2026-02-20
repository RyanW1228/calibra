import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabaseServer";
import {
  createPublicClient,
  http,
  recoverMessageAddress,
  type Address,
  type Hex,
} from "viem";
import {
  ADI_TESTNET_CHAIN_ID,
  CALIBRA_PROTOCOL,
  CALIBRA_PROTOCOL_ABI,
} from "@/lib/calibraOnchain";

function isHexAddress(s: string) {
  return /^0x[a-fA-F0-9]{40}$/.test(s);
}

function isBytes32Hex(s: string) {
  return /^0x[a-fA-F0-9]{64}$/.test(s);
}

function base64ToBytes(b64: string) {
  const buf = Buffer.from(b64, "base64");
  return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
}

function buildAuthMessage(
  address: string,
  nonce: string,
  expiresAtIso: string,
) {
  return (
    `Calibra login\n` +
    `Address: ${address}\n` +
    `Nonce: ${nonce}\n` +
    `Expires: ${expiresAtIso}`
  );
}

async function aesGcmDecrypt(envelope: any) {
  const keyB64 = process.env.CALIBRA_SUBMISSION_ENC_KEY_BASE64 ?? "";
  if (!keyB64) throw new Error("Missing CALIBRA_SUBMISSION_ENC_KEY_BASE64");

  const keyBytes = base64ToBytes(keyB64);
  if (keyBytes.length !== 32) {
    throw new Error(
      "CALIBRA_SUBMISSION_ENC_KEY_BASE64 must decode to 32 bytes",
    );
  }

  const ivB64 = (envelope?.iv_b64 ?? "").toString();
  const ctB64 = (envelope?.ct_b64 ?? "").toString();

  if (!ivB64 || !ctB64) throw new Error("Bad envelope");

  const iv = base64ToBytes(ivB64);
  const ct = base64ToBytes(ctB64);

  const key = await crypto.subtle.importKey(
    "raw",
    keyBytes as Uint8Array<ArrayBuffer>,
    { name: "AES-GCM" },
    false,
    ["decrypt"],
  );

  const ptBuf = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: iv as Uint8Array<ArrayBuffer> },
    key,
    ct as Uint8Array<ArrayBuffer>,
  );

  return new Uint8Array(ptBuf);
}

async function safeJson(req: Request) {
  try {
    return await req.json();
  } catch {
    return null;
  }
}

export async function POST(req: Request) {
  try {
    const body = (await safeJson(req)) as any;

    const viewerAddressRaw = (body?.address ?? "").toString().trim();
    const signatureRaw = (body?.signature ?? "").toString().trim();
    const batchIdHashRaw = (body?.batchIdHash ?? "").toString().trim();

    if (!viewerAddressRaw || !isHexAddress(viewerAddressRaw)) {
      return NextResponse.json(
        { ok: false, error: "Invalid address" },
        { status: 400 },
      );
    }

    if (!signatureRaw || !signatureRaw.startsWith("0x")) {
      return NextResponse.json(
        { ok: false, error: "Missing signature" },
        { status: 400 },
      );
    }

    if (!batchIdHashRaw || !isBytes32Hex(batchIdHashRaw)) {
      return NextResponse.json(
        { ok: false, error: "Invalid batchIdHash" },
        { status: 400 },
      );
    }

    const viewerAddress = viewerAddressRaw.toLowerCase() as Address;
    const signature = signatureRaw as Hex;
    const batchIdHash = batchIdHashRaw as Hex;

    const sb = supabaseServer();

    const { data: nonceRow, error: nonceErr } = await sb
      .from("auth_nonces")
      .select("nonce, expires_at")
      .eq("address", viewerAddress)
      .single();

    if (nonceErr || !nonceRow?.nonce || !nonceRow?.expires_at) {
      return NextResponse.json(
        { ok: false, error: "Missing nonce" },
        { status: 401 },
      );
    }

    const expiresAtIso = new Date(nonceRow.expires_at).toISOString();
    const expiresMs = new Date(expiresAtIso).getTime();
    if (!Number.isFinite(expiresMs) || Date.now() > expiresMs) {
      return NextResponse.json(
        { ok: false, error: "Nonce expired" },
        { status: 401 },
      );
    }

    const message = buildAuthMessage(
      viewerAddress,
      nonceRow.nonce,
      expiresAtIso,
    );

    const recovered = (
      await recoverMessageAddress({ message, signature })
    ).toLowerCase();

    if (recovered !== viewerAddress) {
      return NextResponse.json(
        { ok: false, error: "Bad signature" },
        { status: 401 },
      );
    }

    const rpcUrl = (process.env.ADI_TESTNET_RPC_URL ?? "").trim();
    if (!rpcUrl) {
      return NextResponse.json(
        { ok: false, error: "Missing ADI_TESTNET_RPC_URL" },
        { status: 500 },
      );
    }

    const client = createPublicClient({
      chain: {
        id: ADI_TESTNET_CHAIN_ID,
        name: "ADI Testnet",
        nativeCurrency: { name: "ADI", symbol: "ADI", decimals: 18 },
        rpcUrls: { default: { http: [rpcUrl] } },
      },
      transport: http(rpcUrl),
    });

    const batch = (await client.readContract({
      address: CALIBRA_PROTOCOL,
      abi: CALIBRA_PROTOCOL_ABI,
      functionName: "getBatch",
      args: [batchIdHash],
    })) as unknown as readonly [boolean, Address, Address];

    const exists = batch[0];
    const funder = (batch[2] ?? "").toLowerCase();

    if (!exists) {
      return NextResponse.json(
        { ok: false, error: "Batch not found on-chain" },
        { status: 404 },
      );
    }

    if (viewerAddress !== (funder as Address)) {
      return NextResponse.json(
        { ok: false, error: "Not authorized (funder only)" },
        { status: 403 },
      );
    }

    const { data: rows, error: listErr } = await sb
      .from("submissions")
      .select(
        "id, batch_id, batch_id_hash, provider_address, commit_index, commit_hash, root, salt, encrypted_uri_hash, storage_bucket, storage_path, created_at",
      )
      .eq("batch_id_hash", batchIdHash)
      .order("created_at", { ascending: false })
      .limit(250);

    if (listErr) {
      return NextResponse.json(
        { ok: false, error: listErr.message },
        { status: 500 },
      );
    }

    const out: any[] = [];

    for (const r of rows ?? []) {
      const bucket = (r as any).storage_bucket as string | null;
      const path = (r as any).storage_path as string | null;

      if (!bucket || !path) continue;

      const dl = await sb.storage.from(bucket).download(path);
      if (dl.error || !dl.data) continue;

      const buf = await dl.data.arrayBuffer();
      const rawText = Buffer.from(buf).toString("utf8");

      let envelope: any = null;
      try {
        envelope = JSON.parse(rawText);
      } catch {
        continue;
      }

      if ((envelope?.v ?? null) !== 1 || envelope?.alg !== "A256GCM") continue;

      let payload: any = null;
      try {
        const pt = await aesGcmDecrypt(envelope);
        const plaintextJson = Buffer.from(pt).toString("utf8");
        payload = JSON.parse(plaintextJson);
        if (Array.isArray(payload)) {
          payload = { predictions: payload };
        }
      } catch {
        continue;
      }

      out.push({
        submission: {
          id: (r as any).id ?? null,
          batchId: (r as any).batch_id ?? null,
          batchIdHash: (r as any).batch_id_hash ?? null,
          providerAddress: (r as any).provider_address ?? null,
          commitIndex: (r as any).commit_index ?? null,
          commitHash: (r as any).commit_hash ?? null,
          root: (r as any).root ?? null,
          salt: (r as any).salt ?? null,
          encryptedUriHash: (r as any).encrypted_uri_hash ?? null,
          createdAt: (r as any).created_at ?? null,
          storage: { bucket, path },
        },
        payload,
      });
    }

    await sb.from("auth_nonces").delete().eq("address", viewerAddress);

    return NextResponse.json(
      { ok: true, batchIdHash, funder: viewerAddress, submissions: out },
      { status: 200 },
    );
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message ?? "Unknown server error" },
      { status: 500 },
    );
  }
}
