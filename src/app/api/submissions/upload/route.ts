// calibra/src/app/api/submissions/upload/route.ts
import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabaseServer";
import {
  encodePacked,
  keccak256,
  recoverMessageAddress,
  toBytes,
  type Address,
  type Hex,
} from "viem";

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

function bytesToBase64(b: Uint8Array) {
  return Buffer.from(b.buffer, b.byteOffset, b.byteLength).toString("base64");
}

function randomHex(bytesLen: number) {
  const b = new Uint8Array(bytesLen);
  crypto.getRandomValues(b);
  return (
    "0x" +
    Array.from(b)
      .map((x) => x.toString(16).padStart(2, "0"))
      .join("")
  );
}

function canonicalizePayload(input: unknown) {
  if (!Array.isArray(input)) throw new Error("payload must be an array");

  const rows = input
    .map((x) => {
      const sk = (x as any)?.schedule_key;
      const probs = (x as any)?.probabilities;

      if (typeof sk !== "string") return null;
      const schedule_key = sk.trim();
      if (!schedule_key) return null;

      if (!probs || typeof probs !== "object") return null;

      const entries = Object.entries(probs as Record<string, unknown>)
        .map(([k, v]) => {
          const label = (k ?? "").toString().trim();
          if (!label) return null;

          const num =
            typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;

          if (!Number.isFinite(num) || num < 0 || num > 100) return null;

          const rounded = Math.round(num * 100) / 100;
          return [label, rounded] as const;
        })
        .filter((x): x is readonly [string, number] => Array.isArray(x));

      if (entries.length === 0) return null;

      entries.sort((a, b) => a[0].localeCompare(b[0]));

      const probabilities: Record<string, number> = {};
      for (const [label, v] of entries) probabilities[label] = v;

      return { schedule_key, probabilities };
    })
    .filter(
      (
        x,
      ): x is { schedule_key: string; probabilities: Record<string, number> } =>
        !!x,
    );

  rows.sort((a, b) => a.schedule_key.localeCompare(b.schedule_key));
  return rows;
}

async function aesGcmEncrypt(plaintext: Uint8Array) {
  const keyB64 = process.env.CALIBRA_SUBMISSION_ENC_KEY_BASE64 ?? "";
  if (!keyB64) throw new Error("Missing CALIBRA_SUBMISSION_ENC_KEY_BASE64");

  const keyBytes = base64ToBytes(keyB64);
  if (keyBytes.length !== 32) {
    throw new Error(
      "CALIBRA_SUBMISSION_ENC_KEY_BASE64 must decode to 32 bytes",
    );
  }

  const key = await crypto.subtle.importKey(
    "raw",
    keyBytes as Uint8Array<ArrayBuffer>,
    { name: "AES-GCM" },
    false,
    ["encrypt"],
  );

  const iv = new Uint8Array(12);
  crypto.getRandomValues(iv);

  const ctBuf = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: iv as Uint8Array<ArrayBuffer> },
    key,
    plaintext as Uint8Array<ArrayBuffer>,
  );

  const ct = new Uint8Array(ctBuf);
  return { iv, ct };
}

export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => null)) as any;

    const addressRaw = (body?.address ?? "").toString().trim();
    const signatureRaw = (body?.signature ?? "").toString().trim();
    const batchId = (body?.batchId ?? "").toString().trim();
    const batchIdHashRaw = (body?.batchIdHash ?? "").toString().trim();
    const payload = body?.payload;

    if (!addressRaw || !isHexAddress(addressRaw)) {
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

    if (!batchId) {
      return NextResponse.json(
        { ok: false, error: "Missing batchId" },
        { status: 400 },
      );
    }

    if (!batchIdHashRaw || !isBytes32Hex(batchIdHashRaw)) {
      return NextResponse.json(
        { ok: false, error: "Invalid batchIdHash" },
        { status: 400 },
      );
    }

    const address = addressRaw.toLowerCase() as Address;
    const batchIdHash = batchIdHashRaw as Hex;
    const signature = signatureRaw as Hex;

    const sb = supabaseServer();

    const { data: nonceRow, error: nonceErr } = await sb
      .from("auth_nonces")
      .select("nonce, expires_at")
      .eq("address", address)
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

    const message =
      `Calibra login\n` +
      `Address: ${address}\n` +
      `Nonce: ${nonceRow.nonce}\n` +
      `Expires: ${expiresAtIso}`;

    const recovered = (
      await recoverMessageAddress({ message, signature })
    ).toLowerCase();

    if (recovered !== address) {
      return NextResponse.json(
        { ok: false, error: "Bad signature" },
        { status: 401 },
      );
    }

    const canonical = canonicalizePayload(payload);
    if (canonical.length === 0) {
      return NextResponse.json(
        { ok: false, error: "Empty payload" },
        { status: 400 },
      );
    }

    const canonicalJson = JSON.stringify(canonical);
    const root = keccak256(toBytes(canonicalJson)) as Hex;

    const salt = randomHex(32) as Hex;

    const commitHash = keccak256(
      encodePacked(
        ["bytes32", "bytes32", "bytes32"],
        [batchIdHash, root, salt],
      ),
    ) as Hex;

    const plaintext = new Uint8Array(toBytes(canonicalJson));
    const { iv, ct } = await aesGcmEncrypt(plaintext);

    const envelope = {
      v: 1,
      alg: "A256GCM",
      iv_b64: bytesToBase64(iv),
      ct_b64: bytesToBase64(ct),
    };

    const fileBytes = new Uint8Array(toBytes(JSON.stringify(envelope)));
    const encryptedUriHash = keccak256(ct) as Hex;

    const bucket = "calibra-submissions";
    const path = `${batchIdHash}/${address}/${Date.now()}-${randomHex(8).slice(2)}.json`;

    const up = await sb.storage.from(bucket).upload(path, fileBytes, {
      contentType: "application/json",
      upsert: false,
    });

    if (up.error) {
      return NextResponse.json(
        { ok: false, error: up.error.message },
        { status: 500 },
      );
    }

    const ins = await sb.from("submissions").insert({
      batch_id: batchId,
      batch_id_hash: batchIdHash,
      provider_address: address,
      commit_index: null,
      commit_hash: commitHash,
      root,
      salt,
      storage_bucket: bucket,
      storage_path: path,
      encrypted_uri_hash: encryptedUriHash,
    });

    if (ins.error) {
      return NextResponse.json(
        { ok: false, error: ins.error.message },
        { status: 500 },
      );
    }

    await sb.from("auth_nonces").delete().eq("address", address);

    return NextResponse.json(
      {
        ok: true,
        batchId,
        batchIdHash,
        address,
        root,
        salt,
        commitHash,
        encryptedUriHash,
        storage: { bucket, path },
        publicUri: `sb://${bucket}/${path}`,
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
