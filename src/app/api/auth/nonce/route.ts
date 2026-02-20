// calibra/src/app/api/auth/nonce/route.ts
import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabaseServer";

function isHexAddress(s: string) {
  return /^0x[a-fA-F0-9]{40}$/.test(s);
}

function randomNonceHex(bytesLen: number) {
  const b = new Uint8Array(bytesLen);
  crypto.getRandomValues(b);
  return (
    "0x" +
    Array.from(b)
      .map((x) => x.toString(16).padStart(2, "0"))
      .join("")
  );
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const addressRaw = (url.searchParams.get("address") ?? "").trim();

    if (!addressRaw) {
      return NextResponse.json(
        { ok: false, error: "Missing address" },
        { status: 400 },
      );
    }

    if (!isHexAddress(addressRaw)) {
      return NextResponse.json(
        { ok: false, error: "Invalid address" },
        { status: 400 },
      );
    }

    const address = addressRaw.toLowerCase();

    const nonce = randomNonceHex(32);
    const expiresAtMs = Date.now() + 10 * 60 * 1000;
    const expiresAtIso = new Date(expiresAtMs).toISOString();

    const message =
      `Calibra login\n` +
      `Address: ${address}\n` +
      `Nonce: ${nonce}\n` +
      `Expires: ${expiresAtIso}`;

    const sb = supabaseServer();

    const { error } = await sb.from("auth_nonces").upsert(
      {
        address,
        nonce,
        expires_at: expiresAtIso,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "address" },
    );

    if (error) {
      return NextResponse.json(
        { ok: false, error: error.message },
        { status: 500 },
      );
    }

    return NextResponse.json(
      { ok: true, address, nonce, expires_at: expiresAtIso, message },
      { status: 200 },
    );
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message ?? "Unknown server error" },
      { status: 500 },
    );
  }
}
