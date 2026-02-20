// calibra/src/app/api/submissions/read/route.ts
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

export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => null)) as any;

    const viewerAddressRaw = (body?.address ?? "").toString().trim();
    const signatureRaw = (body?.signature ?? "").toString().trim();

    const batchIdHashRaw = (body?.batchIdHash ?? "").toString().trim();
    const providerAddressRaw = (body?.providerAddress ?? "").toString().trim();

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

    if (!providerAddressRaw || !isHexAddress(providerAddressRaw)) {
      return NextResponse.json(
        { ok: false, error: "Invalid providerAddress" },
        { status: 400 },
      );
    }

    const viewerAddress = viewerAddressRaw.toLowerCase() as Address;
    const providerAddress = providerAddressRaw.toLowerCase() as Address;
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
    const operator = (batch[1] ?? "").toLowerCase();
    const funder = (batch[2] ?? "").toLowerCase();

    if (!exists) {
      return NextResponse.json(
        { ok: false, error: "Batch not found on-chain" },
        { status: 404 },
      );
    }

    const viewerOk =
      viewerAddress === (operator as Address) ||
      viewerAddress === (funder as Address) ||
      viewerAddress === providerAddress;

    if (!viewerOk) {
      return NextResponse.json(
        { ok: false, error: "Not authorized" },
        { status: 403 },
      );
    }

    const { data: subRow, error: subErr } = await sb
      .from("submissions")
      .select(
        "storage_bucket, storage_path, commit_hash, root, salt, encrypted_uri_hash, created_at",
      )
      .eq("batch_id_hash", batchIdHash)
      .eq("provider_address", providerAddress)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (subErr) {
      return NextResponse.json(
        { ok: false, error: subErr.message },
        { status: 500 },
      );
    }

    if (!subRow?.storage_bucket || !subRow?.storage_path) {
      return NextResponse.json(
        { ok: false, error: "Submission not found" },
        { status: 404 },
      );
    }

    const dl = await sb.storage
      .from(subRow.storage_bucket)
      .download(subRow.storage_path);

    if (dl.error || !dl.data) {
      return NextResponse.json(
        { ok: false, error: dl.error?.message ?? "Download failed" },
        { status: 500 },
      );
    }

    const buf = await dl.data.arrayBuffer();
    const rawText = Buffer.from(buf).toString("utf8");
    const envelope = JSON.parse(rawText);

    if ((envelope?.v ?? null) !== 1 || envelope?.alg !== "A256GCM") {
      return NextResponse.json(
        { ok: false, error: "Unsupported envelope" },
        { status: 400 },
      );
    }

    const pt = await aesGcmDecrypt(envelope);
    const plaintextJson = Buffer.from(pt).toString("utf8");
    const payload = JSON.parse(plaintextJson);

    await sb.from("auth_nonces").delete().eq("address", viewerAddress);

    return NextResponse.json(
      {
        ok: true,
        batchIdHash,
        providerAddress,
        submission: {
          commitHash: subRow.commit_hash ?? null,
          root: subRow.root ?? null,
          salt: subRow.salt ?? null,
          encryptedUriHash: subRow.encrypted_uri_hash ?? null,
          createdAt: subRow.created_at ?? null,
          storage: {
            bucket: subRow.storage_bucket,
            path: subRow.storage_path,
          },
        },
        payload,
      },
      { status: 200 },
    );
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message ?? "Unknown server error" },
      { status: 500 },
    );
  }
}
