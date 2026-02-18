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

  thresholds_minutes: number[] | null;

  prediction_window_start_unix: number | string | null;
  prediction_window_end_unix: number | string | null;
};

type BatchFlightRow = {
  schedule_key: string;
  airline: string;
  flight_number: string;
  origin: string;
  destination: string;
  scheduled_depart_iso: string | null;
  scheduled_arrive_iso: string | null;

  fa_flight_id?: string | null;

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
  num_pages?: number;
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

function unixSecToIso(v: unknown): string | null {
  if (typeof v === "string") {
    const n = Number(v);
    if (!Number.isFinite(n)) return null;
    return new Date(n * 1000).toISOString();
  }
  if (typeof v === "number") {
    if (!Number.isFinite(v)) return null;
    return new Date(v * 1000).toISOString();
  }
  return null;
}

function pickIso(payload: any, keys: string[]): string | null {
  for (const k of keys) {
    const v = payload?.[k];
    const iso = toIsoOrNull(typeof v === "string" ? v : null);
    if (iso) return iso;
  }
  return null;
}

function pickBool(payload: any, keys: string[]): boolean | null {
  for (const k of keys) {
    const v = payload?.[k];
    if (typeof v === "boolean") return v;
    if (v === "true") return true;
    if (v === "false") return false;
  }
  return null;
}

function toIsoFromDatetimeLocal(s: unknown): string | null {
  if (typeof s !== "string") return null;
  const v = s.trim();
  if (!v) return null;
  const d = new Date(v);
  if (!Number.isFinite(d.getTime())) return null;
  return d.toISOString();
}

function computePredictionWindowFromSearchPayload(searchPayload: any | null): {
  prediction_window_start_at: string | null;
  prediction_window_end_at: string | null;
  end_when_all_landed: boolean | null;
} {
  if (!searchPayload || typeof searchPayload !== "object") {
    return {
      prediction_window_start_at: null,
      prediction_window_end_at: null,
      end_when_all_landed: null,
    };
  }

  const startIso =
    pickIso(searchPayload, [
      "prediction_window_start_at",
      "predictionWindowStartAt",
      "predictionWindowStartISO",
    ]) ??
    toIsoFromDatetimeLocal(
      searchPayload.windowStartLocal ??
        searchPayload.predictionWindowStartLocal ??
        null,
    );

  const endIso =
    pickIso(searchPayload, [
      "prediction_window_end_at",
      "predictionWindowEndAt",
      "predictionWindowEndISO",
    ]) ??
    toIsoFromDatetimeLocal(
      searchPayload.windowEndLocal ??
        searchPayload.predictionWindowEndLocal ??
        null,
    );

  const endWhenAllLanded =
    pickBool(searchPayload, ["endWhenAllLanded", "end_when_all_landed"]) ??
    null;

  return {
    prediction_window_start_at: startIso,
    prediction_window_end_at: endIso,
    end_when_all_landed: endWhenAllLanded,
  };
}

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
        "id, display_time_zone, flight_count, status, created_at, search_payload, included_schedule_keys, thresholds_minutes, prediction_window_start_unix, prediction_window_end_unix",
      )

      .eq("id", batchId)
      .single();

    if (batchErr || !batch) {
      return NextResponse.json(
        { ok: false, error: batchErr?.message ?? "Batch not found" },
        { status: 404 },
      );
    }

    const window = {
      prediction_window_start_at: unixSecToIso(
        (batch as any).prediction_window_start_unix,
      ),
      prediction_window_end_at: unixSecToIso(
        (batch as any).prediction_window_end_unix,
      ),
      end_when_all_landed: null as boolean | null,
    };

    const { data: flightsRaw, error: flightsErr } = await sb
      .from("batch_flights")
      .select(
        "schedule_key, airline, flight_number, origin, destination, scheduled_depart_iso, scheduled_arrive_iso, fa_flight_id, actual_depart_iso, expected_arrive_iso, actual_arrive_iso, status, departure_delay_min, arrival_delay_min",
      )
      .eq("batch_id", batchId)
      .order("scheduled_depart_iso", { ascending: true });

    if (flightsErr) {
      return NextResponse.json(
        { ok: false, error: flightsErr.message },
        { status: 500 },
      );
    }

    const dbFlights: BatchFlightRow[] = (flightsRaw ?? []).map((f: any) => ({
      schedule_key: f.schedule_key,
      airline: f.airline,
      flight_number: f.flight_number,
      origin: f.origin,
      destination: f.destination,
      scheduled_depart_iso: f.scheduled_depart_iso,
      scheduled_arrive_iso: f.scheduled_arrive_iso,

      fa_flight_id: f.fa_flight_id ?? null,

      actual_depart_iso: f.actual_depart_iso ?? null,
      expected_arrive_iso: f.expected_arrive_iso ?? null,
      actual_arrive_iso: f.actual_arrive_iso ?? null,

      status: f.status ?? null,
      departure_delay_min:
        typeof f.departure_delay_min === "number"
          ? f.departure_delay_min
          : null,
      arrival_delay_min:
        typeof f.arrival_delay_min === "number" ? f.arrival_delay_min : null,
    }));

    const flights: BatchFlightRow[] = dbFlights;

    return NextResponse.json(
      {
        ok: true,
        batch: {
          ...(batch as BatchRow),
          prediction_window_start_at: window.prediction_window_start_at,
          prediction_window_end_at: window.prediction_window_end_at,
          end_when_all_landed: window.end_when_all_landed,
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
