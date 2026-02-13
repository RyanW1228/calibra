import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabaseServer";
import { computeFlightListHashHex } from "@/lib/flightHash";

type SelectedFlight = {
  flightKey: string;

  carrier: string;
  flightNumber: string;
  origin: string;
  destination: string;

  scheduledDepartureTs: string; // ISO string
  scheduledArrivalTs?: string | null;

  terminal?: string | null;
  gate?: string | null;
};

type SnapshotRequest = {
  title?: string;

  airport: string;
  direction: "departures" | "arrivals";

  startTs: string;
  endTs: string;
  airlineCodes?: string[];

  commitDeadlineTs: string;
  revealDeadlineTs: string;

  // IMPORTANT: send as string to avoid JS integer issues
  bountyAmountUsdc: string;

  operatorAddress: string;

  selectedFlights: SelectedFlight[];
};

export async function POST(req: Request) {
  let body: SnapshotRequest;

  try {
    body = (await req.json()) as SnapshotRequest;
  } catch {
    return NextResponse.json(
      { ok: false, error: "Invalid JSON" },
      { status: 400 },
    );
  }

  const {
    title,
    airport,
    direction,
    startTs,
    endTs,
    airlineCodes,
    commitDeadlineTs,
    revealDeadlineTs,
    bountyAmountUsdc,
    operatorAddress,
    selectedFlights,
  } = body;

  // Basic validation (kept strict for demo stability)
  if (!airport)
    return NextResponse.json(
      { ok: false, error: "Missing airport" },
      { status: 400 },
    );
  if (!direction)
    return NextResponse.json(
      { ok: false, error: "Missing direction" },
      { status: 400 },
    );
  if (!startTs || !endTs)
    return NextResponse.json(
      { ok: false, error: "Missing startTs/endTs" },
      { status: 400 },
    );
  if (!commitDeadlineTs || !revealDeadlineTs)
    return NextResponse.json(
      { ok: false, error: "Missing commitDeadlineTs/revealDeadlineTs" },
      { status: 400 },
    );
  if (!bountyAmountUsdc)
    return NextResponse.json(
      { ok: false, error: "Missing bountyAmountUsdc" },
      { status: 400 },
    );
  if (!operatorAddress)
    return NextResponse.json(
      { ok: false, error: "Missing operatorAddress" },
      { status: 400 },
    );

  if (!Array.isArray(selectedFlights) || selectedFlights.length === 0) {
    return NextResponse.json(
      { ok: false, error: "selectedFlights must be a non-empty array" },
      { status: 400 },
    );
  }

  // Deterministic ordering + dedupe by flightKey
  const sorted = [...selectedFlights].sort((a, b) => {
    const t = a.scheduledDepartureTs.localeCompare(b.scheduledDepartureTs);
    if (t !== 0) return t;
    const c = a.carrier.localeCompare(b.carrier);
    if (c !== 0) return c;
    const n = a.flightNumber.localeCompare(b.flightNumber);
    if (n !== 0) return n;
    const d = a.destination.localeCompare(b.destination);
    if (d !== 0) return d;
    return a.flightKey.localeCompare(b.flightKey);
  });

  const seen = new Set<string>();
  const deduped = sorted.filter((f) => {
    if (!f.flightKey) return false;
    if (seen.has(f.flightKey)) return false;
    seen.add(f.flightKey);
    return true;
  });

  if (deduped.length === 0) {
    return NextResponse.json(
      { ok: false, error: "No valid flights after dedupe" },
      { status: 400 },
    );
  }

  const flightKeys = deduped.map((f) => f.flightKey);
  const flightListHashHex = computeFlightListHashHex(flightKeys);

  const sb = supabaseServer();

  // Insert pool
  const { data: poolRow, error: poolErr } = await sb
    .from("pools")
    .insert({
      title: title ?? null,
      airport,
      direction,
      start_ts: startTs,
      end_ts: endTs,
      airline_codes: airlineCodes ?? [],
      commit_deadline_ts: commitDeadlineTs,
      reveal_deadline_ts: revealDeadlineTs,
      bounty_amount_usdc: bountyAmountUsdc, // stored in bigint column; passing string is OK
      operator_address: operatorAddress,
      flight_list_hash_hex: flightListHashHex,
      aeroapi_request_meta: {},
    })
    .select("id")
    .single();

  if (poolErr || !poolRow) {
    return NextResponse.json(
      { ok: false, error: poolErr?.message ?? "Failed to insert pool" },
      { status: 500 },
    );
  }

  const poolUuid = poolRow.id as string;

  // Insert pool flights
  const flightInserts = deduped.map((f) => ({
    pool_uuid: poolUuid,
    flight_key: f.flightKey,
    carrier: f.carrier,
    flight_number: f.flightNumber,
    origin: f.origin,
    destination: f.destination,
    scheduled_departure_ts: f.scheduledDepartureTs,
    scheduled_arrival_ts: f.scheduledArrivalTs ?? null,
    terminal: f.terminal ?? null,
    gate: f.gate ?? null,
  }));

  const { error: flightsErr } = await sb
    .from("pool_flights")
    .insert(flightInserts);

  if (flightsErr) {
    return NextResponse.json(
      { ok: false, error: flightsErr.message },
      { status: 500 },
    );
  }

  return NextResponse.json({
    ok: true,
    poolUuid,
    flightListHashHex,
    flightCount: deduped.length,
  });
}
