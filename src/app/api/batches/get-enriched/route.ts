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

function toYyyyMmDdOrNull(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const s = v.trim();
  if (!s) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const m = s.match(/^(\d{4}-\d{2}-\d{2})T/);
  if (m) return m[1];
  return null;
}

function normalizeUpperSafe(v: unknown) {
  if (typeof v !== "string") return "";
  return v.trim().toUpperCase();
}

function buildScheduleKey(r: {
  airline?: string | null;
  flightNumber?: string | null;
  origin?: string | null;
  destination?: string | null;
  scheduledDepartISO?: string | null;
}) {
  const a = (r.airline ?? "").trim().toUpperCase();
  const n = (r.flightNumber ?? "").trim().toUpperCase();
  const o = (r.origin ?? "").trim().toUpperCase();
  const d = (r.destination ?? "").trim().toUpperCase();
  const t = (r.scheduledDepartISO ?? "").trim();

  if (!a || !n || !o || !d || !t) return null;

  const dt = new Date(t);
  if (Number.isNaN(dt.getTime())) return null;

  const isoUTC = dt.toISOString();
  return `${a}|${n}|${o}|${d}|${isoUTC}`;
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

async function fetchSchedulesPage(opts: {
  apiKey: string;
  startISO: string;
  endISO: string;
  origin?: string;
  destination?: string;
  airline?: string;
  cursor?: string;
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
      cursor: opts.cursor,
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

    const window = computePredictionWindowFromSearchPayload(
      (batch as any).search_payload ?? null,
    );

    const { data: flightsRaw, error: flightsErr } = await sb
      .from("batch_flights")
      .select(
        "schedule_key, airline, flight_number, origin, destination, scheduled_depart_iso, scheduled_arrive_iso, fa_flight_id",
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
    }));

    const scheduleKeySet = new Set(
      dbFlights.map((f) => (f.schedule_key ?? "").trim()).filter(Boolean),
    );

    const searchPayload = (batch as any).search_payload ?? null;
    const origin = normalizeUpperSafe(searchPayload?.origin) || undefined;
    const destination =
      normalizeUpperSafe(searchPayload?.destination) || undefined;

    const dateStart = toYyyyMmDdOrNull(searchPayload?.dateStart);
    const dateEnd = toYyyyMmDdOrNull(searchPayload?.dateEnd);

    const airlinesRaw = Array.isArray(searchPayload?.airlines)
      ? (searchPayload.airlines as unknown[])
      : null;

    const airlines = airlinesRaw
      ? airlinesRaw.map((x) => normalizeUpperSafe(x)).filter(Boolean)
      : [];

    const limit =
      typeof searchPayload?.limit === "number" &&
      Number.isFinite(searchPayload.limit)
        ? Math.max(1, Math.min(200, Math.floor(searchPayload.limit)))
        : 200;

    if (!dateStart || !dateEnd) {
      return NextResponse.json(
        { ok: false, error: "Batch missing search payload dateStart/dateEnd" },
        { status: 500 },
      );
    }

    const aeroStart = `${dateStart}T00:00:00Z`;
    const aeroEnd = `${dateEnd}T00:00:00Z`;

    const maxPagesCapPerQuery = 5;

    const byScheduleKey = new Map<string, BatchFlightRow>();
    for (const f of dbFlights) {
      const k = (f.schedule_key ?? "").trim();
      if (!k) continue;
      byScheduleKey.set(k, f);
    }

    async function ingestScheduleItem(
      s: NonNullable<AeroApiSchedulesResponse["scheduled"]>[number],
    ) {
      const bestIdent =
        s.actual_ident_iata ??
        s.actual_ident_icao ??
        s.actual_ident ??
        s.ident_iata ??
        s.ident_icao ??
        s.ident ??
        "";

      const { airline, flightNumber } = splitIdent(bestIdent);

      const originOut = (
        s.origin_iata ??
        s.origin_icao ??
        s.origin ??
        origin ??
        ""
      ).trim();
      const destOut = (
        s.destination_iata ??
        s.destination_icao ??
        s.destination ??
        destination ??
        ""
      ).trim();

      const scheduledDepartISO = s.scheduled_out ?? null;
      const scheduledArriveISO = s.scheduled_in ?? null;

      const scheduleKey = buildScheduleKey({
        airline: airline ?? null,
        flightNumber: flightNumber ?? null,
        origin: originOut ?? null,
        destination: destOut ?? null,
        scheduledDepartISO,
      });

      if (!scheduleKey) return;
      if (!scheduleKeySet.has(scheduleKey)) return;

      const row = byScheduleKey.get(scheduleKey);
      if (!row) return;

      const fa = (s.fa_flight_id ?? "").trim() || null;
      if (fa) {
        row.fa_flight_id = fa;
        try {
          await sb
            .from("batch_flights")
            .update({ fa_flight_id: fa })
            .eq("batch_id", batchId)
            .eq("schedule_key", scheduleKey);
        } catch {}
      }

      row.scheduled_depart_iso = scheduledDepartISO;
      row.scheduled_arrive_iso = scheduledArriveISO;
    }

    async function runQueryForAirline(airline?: string) {
      let cursor: string | undefined = undefined;
      let pagesFetched = 0;

      while (pagesFetched < maxPagesCapPerQuery) {
        const { r, url: reqUrl } = await fetchSchedulesPage({
          apiKey,
          startISO: aeroStart,
          endISO: aeroEnd,
          origin,
          destination,
          airline,
          cursor,
        });

        if (!r.ok) {
          const text = await r.text().catch(() => "");
          return NextResponse.json(
            {
              ok: false,
              error: `FlightAware request failed (${r.status})`,
              details: { url: reqUrl, body: text },
            },
            { status: 502 },
          );
        }

        const json = (await r.json()) as AeroApiSchedulesResponse;
        const scheduled = Array.isArray(json.scheduled) ? json.scheduled : [];

        for (const s of scheduled) {
          await ingestScheduleItem(s);
        }

        pagesFetched += 1;

        const next = json.links?.next;
        if (next) {
          try {
            const nextUrl = new URL(next, "https://aeroapi.flightaware.com");
            cursor = nextUrl.searchParams.get("cursor") ?? undefined;
          } catch {
            cursor = undefined;
          }
        } else {
          cursor = undefined;
        }

        if (!cursor) break;
      }

      return null;
    }

    if (airlines.length === 0) {
      const errRes = await runQueryForAirline(undefined);
      if (errRes) return errRes;
    } else {
      for (const a of airlines) {
        const errRes = await runQueryForAirline(a);
        if (errRes) return errRes;
      }
    }

    const flights: BatchFlightRow[] = dbFlights;

    const maxEnrich = Math.min(flights.length, limit);
    const concurrency = 6;
    let i = 0;

    async function enrichWorker() {
      while (i < maxEnrich) {
        const idx2 = i;
        i += 1;

        const row = flights[idx2];
        const fa = (row.fa_flight_id ?? "").trim();
        if (!fa) continue;

        const { r } = await fetchFlightById({ apiKey, faFlightId: fa });
        if (!r.ok) continue;

        const fj = (await r.json()) as AeroApiFlightResponse;
        const f0 = Array.isArray(fj.flights) ? fj.flights[0] : undefined;
        if (!f0) continue;

        row.scheduled_depart_iso = f0.scheduled_out ?? row.scheduled_depart_iso;
        row.actual_depart_iso = f0.actual_out ?? null;

        row.scheduled_arrive_iso = f0.scheduled_in ?? row.scheduled_arrive_iso;
        row.expected_arrive_iso = f0.estimated_in ?? null;
        row.actual_arrive_iso = f0.actual_in ?? null;

        row.departure_delay_min = secToMin(f0.departure_delay);
        row.arrival_delay_min = secToMin(f0.arrival_delay);

        row.status = f0.status ?? null;
      }
    }

    await Promise.all(
      Array.from({ length: concurrency }, () => enrichWorker()),
    );

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
