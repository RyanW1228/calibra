// calibra/src/app/api/batches/get-enriched/route.ts
import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabaseServer";

type BatchRow = {
  id: string;
  display_time_zone: string;
  flight_count: number;
  status: string;
  created_at: string;
  search_payload: any | null;
  included_schedule_keys: string[] | null;

  prediction_window_start_unix?: number | null;
  prediction_window_end_unix?: number | null;
  end_when_all_landed?: boolean | null;
  thresholds_minutes?: number[] | null;

  spec_hash?: string | null;
  seed_hash?: string | null;
  fund_tx_hash?: string | null;
};

type BatchFlightRow = {
  schedule_key: string;
  airline: string;
  flight_number: string;
  origin: string;
  destination: string;
  scheduled_depart_iso: string | null;
  scheduled_arrive_iso: string | null;

  actual_depart_iso?: string | null;
  expected_arrive_iso?: string | null;
  actual_arrive_iso?: string | null;

  status?: string | null;
  departure_delay_min?: number | null;
  arrival_delay_min?: number | null;
};

type AeroApiSchedulesResponse = {
  links?: { next?: string } | null;
  scheduled?: Array<{
    ident?: string;
    ident_icao?: string | null;
    ident_iata?: string | null;

    actual_ident?: string | null;
    actual_ident_icao?: string | null;
    actual_ident_iata?: string | null;

    scheduled_out?: string | null;
    scheduled_in?: string | null;

    origin?: string;
    origin_iata?: string | null;
    origin_icao?: string | null;

    destination?: string;
    destination_iata?: string | null;
    destination_icao?: string | null;

    fa_flight_id?: string | null;
  }>;
};

type AeroApiFlightResponse = {
  flights?: Array<{
    scheduled_out?: string | null;
    actual_out?: string | null;

    scheduled_in?: string | null;
    estimated_in?: string | null;
    actual_in?: string | null;

    departure_delay?: number | null; // seconds
    arrival_delay?: number | null; // seconds
    status?: string | null;
  }> | null;
};

function buildAeroApiUrl(
  path: string,
  params: Record<string, string | undefined>,
) {
  const base = "https://aeroapi.flightaware.com/aeroapi";
  const url = new URL(`${base}${path}`);
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== "") url.searchParams.set(k, v);
  }
  return url.toString();
}

function secToMin(sec: number | null | undefined) {
  if (typeof sec !== "number" || Number.isNaN(sec)) return null;
  return Math.round(sec / 60);
}

function toIsoOrNull(s: string | null | undefined) {
  if (!s) return null;
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

function splitIdent(ident: string | undefined | null): {
  airline?: string;
  flightNumber?: string;
} {
  if (!ident) return {};
  const compact = ident.trim().toUpperCase().replace(/\s+/g, "");
  const m = compact.match(/^([A-Z]{2,3})(\d{1,5}[A-Z]?)$/);
  if (!m) return {};
  return { airline: m[1], flightNumber: m[2] };
}

async function fetchSchedules(opts: {
  apiKey: string;
  startISO: string;
  endISO: string;
  origin?: string;
  destination?: string;
  airline?: string;
}) {
  const url = buildAeroApiUrl(
    `/schedules/${encodeURIComponent(opts.startISO)}/${encodeURIComponent(
      opts.endISO,
    )}`,
    {
      origin: opts.origin,
      destination: opts.destination,
      airline: opts.airline,
      include_codeshares: "false",
      include_regional: "true",
      max_pages: "1",
    },
  );

  const r = await fetch(url, {
    method: "GET",
    headers: { "x-apikey": opts.apiKey, accept: "application/json" },
    cache: "no-store",
  });

  return { r, url };
}

async function fetchFlightById(opts: { apiKey: string; faFlightId: string }) {
  const url = buildAeroApiUrl(
    `/flights/${encodeURIComponent(opts.faFlightId)}`,
    {},
  );

  const r = await fetch(url, {
    method: "GET",
    headers: { "x-apikey": opts.apiKey, accept: "application/json" },
    cache: "no-store",
  });

  return { r, url };
}

function normalizeUpper(s: string) {
  return s.trim().toUpperCase();
}

function findBestFaFlightId(args: {
  scheduledDepartISO: string | null;
  airline: string;
  flightNumber: string;
  origin: string;
  destination: string;
  scheduled: NonNullable<AeroApiSchedulesResponse["scheduled"]>;
}) {
  const targetDepart = toIsoOrNull(args.scheduledDepartISO);
  const a0 = normalizeUpper(args.airline);
  const n0 = normalizeUpper(args.flightNumber);
  const o0 = normalizeUpper(args.origin);
  const d0 = normalizeUpper(args.destination);

  let best: { fa: string; score: number } | null = null;

  for (const s of args.scheduled) {
    const fa = (s.fa_flight_id ?? "").trim();
    if (!fa) continue;

    const bestIdent =
      s.actual_ident_iata ??
      s.actual_ident_icao ??
      s.actual_ident ??
      s.ident_iata ??
      s.ident_icao ??
      s.ident ??
      "";

    const { airline, flightNumber } = splitIdent(bestIdent);

    const so = normalizeUpper(s.origin_iata ?? s.origin_icao ?? s.origin ?? "");
    const sd = normalizeUpper(
      s.destination_iata ?? s.destination_icao ?? s.destination ?? "",
    );

    const dep = toIsoOrNull(s.scheduled_out ?? null);

    let score = 0;

    if (airline && normalizeUpper(airline) === a0) score += 5;
    if (flightNumber && normalizeUpper(flightNumber) === n0) score += 5;

    if (so && so === o0) score += 3;
    if (sd && sd === d0) score += 3;

    if (targetDepart && dep && dep === targetDepart) score += 10;

    if (!best || score > best.score) best = { fa, score };
  }

  return best?.fa ?? null;
}

function isoFromUnixSeconds(u: unknown): string | null {
  const n = typeof u === "string" ? Number(u) : u;
  if (typeof n !== "number" || !Number.isFinite(n)) return null;
  const s = Math.floor(n);
  if (s <= 0) return null;
  return new Date(s * 1000).toISOString();
}

export async function GET(req: Request) {
  try {
    const apiKey = process.env.FLIGHTAWARE_API_KEY ?? "";
    if (!apiKey) {
      return NextResponse.json(
        { ok: false, error: "Server missing FLIGHTAWARE_API_KEY" },
        { status: 500 },
      );
    }

    const url = new URL(req.url);
    const batchId = (url.searchParams.get("batchId") ?? "").trim();

    if (!batchId) {
      return NextResponse.json(
        { ok: false, error: "Missing batchId" },
        { status: 400 },
      );
    }

    const sb = supabaseServer();

    // ANCHOR: expand select to include Option A columns
    const { data: batch, error: batchErr } = await sb
      .from("batches")
      .select(
        "id, display_time_zone, flight_count, status, created_at, search_payload, included_schedule_keys, prediction_window_start_unix, prediction_window_end_unix, end_when_all_landed, thresholds_minutes, spec_hash, seed_hash, fund_tx_hash",
      )
      .eq("id", batchId)
      .single();

    if (batchErr || !batch) {
      return NextResponse.json(
        { ok: false, error: batchErr?.message ?? "Batch not found" },
        { status: 404 },
      );
    }

    const prediction_window_start_at = isoFromUnixSeconds(
      (batch as any).prediction_window_start_unix ?? null,
    );
    const prediction_window_end_at = isoFromUnixSeconds(
      (batch as any).prediction_window_end_unix ?? null,
    );

    const { data: flightsRaw, error: flightsErr } = await sb
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

    const flights: BatchFlightRow[] = (flightsRaw ?? []).map((f: any) => ({
      schedule_key: f.schedule_key,
      airline: f.airline,
      flight_number: f.flight_number,
      origin: f.origin,
      destination: f.destination,
      scheduled_depart_iso: f.scheduled_depart_iso,
      scheduled_arrive_iso: f.scheduled_arrive_iso,
    }));

    const concurrency = 6;
    let idx = 0;

    async function enrichOne(row: BatchFlightRow) {
      const dep = row.scheduled_depart_iso
        ? new Date(row.scheduled_depart_iso)
        : null;
      if (!dep || Number.isNaN(dep.getTime())) return;

      const startISO = new Date(
        dep.getTime() - 6 * 60 * 60 * 1000,
      ).toISOString();
      const endISO = new Date(
        dep.getTime() + 18 * 60 * 60 * 1000,
      ).toISOString();

      const { r: schedRes } = await fetchSchedules({
        apiKey,
        startISO,
        endISO,
        origin: row.origin,
        destination: row.destination,
        airline: row.airline,
      });

      if (!schedRes.ok) return;

      const schedJson = (await schedRes.json()) as AeroApiSchedulesResponse;
      const scheduled = Array.isArray(schedJson.scheduled)
        ? schedJson.scheduled
        : [];
      if (scheduled.length === 0) return;

      const fa = findBestFaFlightId({
        scheduledDepartISO: row.scheduled_depart_iso,
        airline: row.airline,
        flightNumber: row.flight_number,
        origin: row.origin,
        destination: row.destination,
        scheduled,
      });

      if (!fa) return;

      const { r: flightRes } = await fetchFlightById({
        apiKey,
        faFlightId: fa,
      });
      if (!flightRes.ok) return;

      const fj = (await flightRes.json()) as AeroApiFlightResponse;
      const f0 = Array.isArray(fj.flights) ? fj.flights[0] : undefined;
      if (!f0) return;

      row.scheduled_depart_iso = f0.scheduled_out ?? row.scheduled_depart_iso;
      row.actual_depart_iso = f0.actual_out ?? null;

      row.scheduled_arrive_iso = f0.scheduled_in ?? row.scheduled_arrive_iso;
      row.expected_arrive_iso = f0.estimated_in ?? null;
      row.actual_arrive_iso = f0.actual_in ?? null;

      row.departure_delay_min = secToMin(f0.departure_delay);
      row.arrival_delay_min = secToMin(f0.arrival_delay);

      row.status = f0.status ?? null;
    }

    async function worker() {
      while (idx < flights.length) {
        const j = idx;
        idx += 1;
        await enrichOne(flights[j]);
      }
    }

    await Promise.all(Array.from({ length: concurrency }, () => worker()));

    // ANCHOR: return the new fields so batch/[batchId] can display timer
    return NextResponse.json(
      {
        ok: true,
        batch: {
          ...(batch as BatchRow),
          prediction_window_start_unix:
            (batch as any).prediction_window_start_unix ?? null,
          prediction_window_end_unix:
            (batch as any).prediction_window_end_unix ?? null,
          prediction_window_start_at,
          prediction_window_end_at,
          end_when_all_landed: (batch as any).end_when_all_landed ?? null,
          thresholds_minutes: (batch as any).thresholds_minutes ?? null,
          spec_hash: (batch as any).spec_hash ?? null,
          seed_hash: (batch as any).seed_hash ?? null,
          fund_tx_hash: (batch as any).fund_tx_hash ?? null,
        },
        flights,
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
