import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabaseServer";

type CreateBatchRequest = {
  displayTimeZone: string;

  search: Record<string, unknown>;

  includedScheduleKeys: string[];

  flights: Array<{
    scheduleKey: string;
    airline: string;
    flightNumber: string;
    origin: string;
    destination: string;
    scheduledDepartISO?: string;
    scheduledArriveISO?: string;
  }>;
};

function cleanKey(s: unknown) {
  if (typeof s !== "string") return "";
  return s.trim();
}

export async function POST(req: Request) {
  let body: CreateBatchRequest;

  try {
    body = (await req.json()) as CreateBatchRequest;
  } catch {
    return NextResponse.json(
      { ok: false, error: "Invalid JSON" },
      { status: 400 },
    );
  }

  const { displayTimeZone, flights, search, includedScheduleKeys } = body;

  if (!displayTimeZone) {
    return NextResponse.json(
      { ok: false, error: "Missing displayTimeZone" },
      { status: 400 },
    );
  }

  if (!search || typeof search !== "object") {
    return NextResponse.json(
      { ok: false, error: "Missing search payload" },
      { status: 400 },
    );
  }

  const included = Array.isArray(includedScheduleKeys)
    ? includedScheduleKeys.map(cleanKey).filter(Boolean)
    : [];

  if (included.length === 0) {
    return NextResponse.json(
      { ok: false, error: "No includedScheduleKeys provided" },
      { status: 400 },
    );
  }

  if (!Array.isArray(flights) || flights.length === 0) {
    return NextResponse.json(
      { ok: false, error: "No flights provided" },
      { status: 400 },
    );
  }

  const includedSet = new Set(included);
  const filteredFlights = flights.filter((f) => includedSet.has(f.scheduleKey));

  if (filteredFlights.length === 0) {
    return NextResponse.json(
      { ok: false, error: "No provided flights matched includedScheduleKeys" },
      { status: 400 },
    );
  }

  const sb = supabaseServer();

  const { data: batchRow, error: batchErr } = await sb
    .from("batches")
    .insert({
      display_time_zone: displayTimeZone,
      flight_count: filteredFlights.length,
      status: "draft",
      search_payload: search,
      included_schedule_keys: included,
    })
    .select("id")
    .single();

  if (batchErr || !batchRow) {
    return NextResponse.json(
      { ok: false, error: batchErr?.message ?? "Failed to create batch" },
      { status: 500 },
    );
  }

  const batchId = batchRow.id as string;

  const inserts = filteredFlights.map((f) => ({
    batch_id: batchId,
    schedule_key: f.scheduleKey,
    airline: f.airline,
    flight_number: f.flightNumber,
    origin: f.origin,
    destination: f.destination,
    scheduled_depart_iso: f.scheduledDepartISO ?? null,
    scheduled_arrive_iso: f.scheduledArriveISO ?? null,
  }));

  const { error: flightsErr } = await sb.from("batch_flights").insert(inserts);

  if (flightsErr) {
    return NextResponse.json(
      { ok: false, error: flightsErr.message },
      { status: 500 },
    );
  }

  return NextResponse.json({
    ok: true,
    batchId,
  });
}
