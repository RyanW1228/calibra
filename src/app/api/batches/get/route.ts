// calibra/src/app/api/batches/get/route.ts
import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabaseServer";

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const batchId = (url.searchParams.get("batchId") ?? "").trim();

    if (!batchId) {
      return NextResponse.json(
        { ok: false, error: "Missing batchId" },
        { status: 400 },
      );
    }

    const sb = supabaseServer();

    const { data: batch, error: batchErr } = await sb
      .from("batches")
      .select(
        "id, display_time_zone, flight_count, status, created_at, search_payload, included_schedule_keys",
      )
      .eq("id", batchId)
      .single();

    if (batchErr || !batch) {
      return NextResponse.json(
        { ok: false, error: batchErr?.message ?? "Batch not found" },
        { status: 404 },
      );
    }

    const { data: flights, error: flightsErr } = await sb
      .from("batch_flights")
      .select(
        "schedule_key, airline, flight_number, origin, destination, scheduled_depart_iso, scheduled_arrive_iso",
      )
      .eq("batch_id", batchId)
      .order("scheduled_depart_iso", { ascending: true });

    if (flightsErr) {
      return NextResponse.json(
        { ok: false, error: flightsErr.message },
        { status: 500 },
      );
    }

    return NextResponse.json(
      { ok: true, batch, flights: flights ?? [] },
      { status: 200 },
    );
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message ?? "Unknown server error" },
      { status: 500 },
    );
  }
}
