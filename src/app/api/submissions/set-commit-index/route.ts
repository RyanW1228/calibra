// calibra/src/app/api/submissions/set-commit-index/route.ts
import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabaseServer";
import { recoverMessageAddress, type Address, type Hex } from "viem";

function isHexAddress(s: string) {
  return /^0x[a-fA-F0-9]{40}$/.test(s);
}

function isBytes32Hex(s: string) {
  return /^0x[a-fA-F0-9]{64}$/.test(s);
}

async function safeJson(req: Request) {
  try {
    return await req.json();
  } catch {
    return null;
  }
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

export async function POST(req: Request) {
  try {
    const body = (await safeJson(req)) as any;

    const addressRaw = (body?.address ?? "").toString().trim();
    const signatureRaw = (body?.signature ?? "").toString().trim();
    const batchIdHashRaw = (body?.batchIdHash ?? "").toString().trim();
    const providerRaw = (body?.providerAddress ?? "").toString().trim();
    const commitHashRaw = (body?.commitHash ?? "").toString().trim();

    const commitIndexAny = body?.commitIndex;
    const commitIndexNum =
      typeof commitIndexAny === "number"
        ? commitIndexAny
        : typeof commitIndexAny === "string"
          ? Number(commitIndexAny)
          : NaN;

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

    if (!batchIdHashRaw || !isBytes32Hex(batchIdHashRaw)) {
      return NextResponse.json(
        { ok: false, error: "Invalid batchIdHash" },
        { status: 400 },
      );
    }

    if (!providerRaw || !isHexAddress(providerRaw)) {
      return NextResponse.json(
        { ok: false, error: "Invalid providerAddress" },
        { status: 400 },
      );
    }

    if (!commitHashRaw || !isBytes32Hex(commitHashRaw)) {
      return NextResponse.json(
        { ok: false, error: "Invalid commitHash" },
        { status: 400 },
      );
    }

    if (!Number.isFinite(commitIndexNum) || commitIndexNum < 0) {
      return NextResponse.json(
        { ok: false, error: "Invalid commitIndex" },
        { status: 400 },
      );
    }

    const address = addressRaw.toLowerCase() as Address;
    const providerAddress = providerRaw.toLowerCase() as Address;
    const batchIdHash = batchIdHashRaw as Hex;
    const signature = signatureRaw as Hex;
    const commitHash = commitHashRaw as Hex;

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

    const msg = buildAuthMessage(address, nonceRow.nonce, expiresAtIso);

    const recovered = (
      await recoverMessageAddress({ message: msg, signature })
    ).toLowerCase();

    if (recovered !== address) {
      return NextResponse.json(
        { ok: false, error: "Bad signature" },
        { status: 401 },
      );
    }

    if (address !== providerAddress) {
      return NextResponse.json(
        { ok: false, error: "address must equal providerAddress" },
        { status: 403 },
      );
    }

    const { data: rows, error: selErr } = await sb
      .from("submissions")
      .select("id, commit_index")
      .eq("batch_id_hash", batchIdHash)
      .eq("provider_address", providerAddress)
      .eq("commit_hash", commitHash)
      .limit(2);

    if (selErr) {
      return NextResponse.json(
        { ok: false, error: selErr.message },
        { status: 500 },
      );
    }

    if (!rows || rows.length === 0) {
      return NextResponse.json(
        { ok: false, error: "Submission not found" },
        { status: 404 },
      );
    }

    if (rows.length > 1) {
      return NextResponse.json(
        { ok: false, error: "Multiple submissions matched (unexpected)" },
        { status: 409 },
      );
    }

    const row = rows[0] as any;
    const id = row?.id;

    if (!id) {
      return NextResponse.json(
        { ok: false, error: "Submission missing id" },
        { status: 500 },
      );
    }

    if (row.commit_index !== null && row.commit_index !== undefined) {
      return NextResponse.json(
        { ok: true, already_set: true, commitIndex: row.commit_index },
        { status: 200 },
      );
    }

    const { error: upErr } = await sb
      .from("submissions")
      .update({ commit_index: commitIndexNum })
      .eq("id", id);

    if (upErr) {
      return NextResponse.json(
        { ok: false, error: upErr.message },
        { status: 500 },
      );
    }

    return NextResponse.json(
      { ok: true, commitIndex: commitIndexNum },
      { status: 200 },
    );
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message ?? "Unknown server error" },
      { status: 500 },
    );
  }
}
