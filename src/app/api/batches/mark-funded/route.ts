// calibra/src/app/api/batches/mark-funded/route.ts
import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabaseServer";

type MarkFundedRequest = {
  batchId: string;

  predictionWindowStartUnix?: number | null;
  predictionWindowEndUnix?: number | null;
  endWhenAllLanded?: boolean | null;
  thresholdsMinutes?: number[] | null;

  specHash?: string | null;
  seedHash?: string | null;
  fundTxHash?: string | null;

  bountyUsdc?: string | number | null;
};

function cleanUnix(v: unknown): number | null {
  const n = typeof v === "string" ? Number(v) : v;
  if (typeof n !== "number" || !Number.isFinite(n)) return null;
  const u = Math.floor(n);
  if (u <= 0) return null;
  return u;
}

function cleanBool(v: unknown): boolean | null {
  if (typeof v === "boolean") return v;
  if (v === "true") return true;
  if (v === "false") return false;
  return null;
}

function cleanThresholds(v: unknown, max = 5): number[] | null {
  if (!Array.isArray(v)) return null;
  const nums = v
    .map((x) => (typeof x === "string" ? Number(x) : x))
    .filter((x) => typeof x === "number" && Number.isFinite(x))
    .map((x) => Math.floor(x))
    .filter((x) => x > 0);

  const uniq = Array.from(new Set(nums))
    .sort((a, b) => a - b)
    .slice(0, max);
  if (uniq.length === 0) return null;
  return uniq;
}

function cleanHex32(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const s = v.trim();
  if (!s) return null;
  if (!/^0x[0-9a-fA-F]{64}$/.test(s)) return null;
  return s;
}

function cleanTxHash(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const s = v.trim();
  if (!s) return null;
  if (!/^0x[0-9a-fA-F]{64}$/.test(s)) return null;
  return s;
}

function cleanBountyUsdc(v: unknown): number | null {
  if (typeof v === "number") {
    if (!Number.isFinite(v) || v <= 0) return null;
    const rounded = Math.round(v * 100) / 100;
    return rounded > 0 ? rounded : null;
  }

  if (typeof v === "string") {
    const s = v.trim();
    if (!s) return null;
    const n = Number(s);
    if (!Number.isFinite(n) || n <= 0) return null;
    const rounded = Math.round(n * 100) / 100;
    return rounded > 0 ? rounded : null;
  }

  return null;
}

export async function POST(req: Request) {
  let body: MarkFundedRequest;

  try {
    body = (await req.json()) as MarkFundedRequest;
  } catch {
    return NextResponse.json(
      { ok: false, error: "Invalid JSON" },
      { status: 400 },
    );
  }

  const batchId = (body.batchId ?? "").trim();
  if (!batchId) {
    return NextResponse.json(
      { ok: false, error: "Missing batchId" },
      { status: 400 },
    );
  }

  const wsU = cleanUnix(body.predictionWindowStartUnix);
  const weU = cleanUnix(body.predictionWindowEndUnix);
  const endWhenAllLanded = cleanBool(body.endWhenAllLanded);
  const thresholdsMinutes = cleanThresholds(body.thresholdsMinutes, 5);

  const specHash = cleanHex32(body.specHash);
  const seedHash = cleanHex32(body.seedHash);
  const fundTxHash = cleanTxHash(body.fundTxHash);

  const bountyUsdc = cleanBountyUsdc(body.bountyUsdc);

  if (wsU === null || weU === null) {
    return NextResponse.json(
      { ok: false, error: "Missing or invalid prediction window" },
      { status: 400 },
    );
  }

  if (wsU >= weU) {
    return NextResponse.json(
      { ok: false, error: "Prediction window start must be < end" },
      { status: 400 },
    );
  }

  if (endWhenAllLanded === null) {
    return NextResponse.json(
      { ok: false, error: "Missing endWhenAllLanded" },
      { status: 400 },
    );
  }

  if (!thresholdsMinutes) {
    return NextResponse.json(
      { ok: false, error: "Missing thresholdsMinutes" },
      { status: 400 },
    );
  }

  if (!specHash || !seedHash || !fundTxHash) {
    return NextResponse.json(
      { ok: false, error: "Missing specHash / seedHash / fundTxHash" },
      { status: 400 },
    );
  }

  if (bountyUsdc === null) {
    return NextResponse.json(
      { ok: false, error: "Missing bountyUsdc" },
      { status: 400 },
    );
  }

  const sb = supabaseServer();

  const { data, error } = await sb
    .from("batches")
    .update({
      status: "funded",
      prediction_window_start_unix: wsU,
      prediction_window_end_unix: weU,
      end_when_all_landed: endWhenAllLanded,
      thresholds_minutes: thresholdsMinutes,
      spec_hash: specHash,
      seed_hash: seedHash,
      fund_tx_hash: fundTxHash,
      bounty_usdc: bountyUsdc,
      bonded_model_count: 0,
    })
    .eq("id", batchId)
    .select(
      "id, status, prediction_window_start_unix, prediction_window_end_unix, end_when_all_landed, thresholds_minutes, spec_hash, seed_hash, fund_tx_hash, bounty_usdc, bonded_model_count",
    )
    .single();

  if (error || !data) {
    return NextResponse.json(
      { ok: false, error: error?.message ?? "Failed to update batch" },
      { status: 500 },
    );
  }

  return NextResponse.json({ ok: true, batch: data }, { status: 200 });
}
