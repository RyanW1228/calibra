// calibra/src/app/api/batches/list-active/route.ts
import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabaseServer";

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);

    const limitRaw = Number(url.searchParams.get("limit") ?? "25");
    const limit = Math.max(
      1,
      Math.min(100, Number.isFinite(limitRaw) ? limitRaw : 25),
    );

    const statusesCsv = (
      url.searchParams.get("statuses") ?? "active,created"
    ).trim();
    const statuses = statusesCsv
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s.length > 0);

    const sb = supabaseServer();

    let q = sb
      .from("batches")
      .select("id, display_time_zone, flight_count, status, created_at")
      .order("created_at", { ascending: false })
      .limit(limit);

    if (statuses.length > 0) {
      q = q.in("status", statuses);
    }

    const { data, error } = await q;

    if (error) {
      return NextResponse.json(
        { ok: false, error: error.message },
        { status: 500 },
      );
    }

    return NextResponse.json(
      { ok: true, batches: data ?? [] },
      { status: 200 },
    );
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message ?? "Unknown server error" },
      { status: 500 },
    );
  }
}
