// calibra/src/app/api/batches/list-by-funder/route.ts
import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabaseServer";

type BatchRow = {
  id: string;
  display_time_zone: string | null;
  flight_count: number | null;
  status: string | null;
  created_at: string | null;
};

type ListByFunderResponse =
  | { ok: true; batches: BatchRow[] }
  | { ok: false; error: string; details?: unknown };

function isHexAddress(s: string) {
  return /^0x[a-fA-F0-9]{40}$/.test(s);
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);

    const funderRaw = (url.searchParams.get("funder") ?? "").trim();
    const limitRaw = (url.searchParams.get("limit") ?? "25").trim();

    if (!funderRaw) {
      return NextResponse.json(
        { ok: false, error: "Missing funder" } satisfies ListByFunderResponse,
        { status: 400 },
      );
    }

    if (!isHexAddress(funderRaw)) {
      return NextResponse.json(
        {
          ok: false,
          error: "Invalid funder address",
        } satisfies ListByFunderResponse,
        { status: 400 },
      );
    }

    const limitParsed = Number.parseInt(limitRaw, 10);
    const limit = Number.isFinite(limitParsed)
      ? Math.max(1, Math.min(100, limitParsed))
      : 25;

    const sb = supabaseServer();

    const { data, error } = await sb
      .from("batches")
      .select("id, display_time_zone, flight_count, status, created_at")
      .eq("funder_address", funderRaw.toLowerCase())
      .order("created_at", { ascending: false })
      .limit(limit);

    if (error) {
      return NextResponse.json(
        { ok: false, error: error.message } satisfies ListByFunderResponse,
        { status: 500 },
      );
    }

    return NextResponse.json(
      {
        ok: true,
        batches: (data ?? []) as BatchRow[],
      } satisfies ListByFunderResponse,
      { status: 200 },
    );
  } catch (e: any) {
    return NextResponse.json(
      {
        ok: false,
        error: e?.message ?? "Unknown server error",
      } satisfies ListByFunderResponse,
      { status: 500 },
    );
  }
}
