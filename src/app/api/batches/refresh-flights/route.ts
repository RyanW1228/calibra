// calibra/src/app/api/batches/refresh-flights/route.ts
import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabaseServer";

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

    departure_delay?: number | null;
    arrival_delay?: number | null;
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
  if (typeof sec !== "number" || !Number.isFinite(sec)) return null;
  return Math.round(sec / 60);
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

function toIsoOrNull(s: string | null | undefined) {
  if (!s) return null;
  const d = new Date(s);
  if (!Number.isFinite(d.getTime())) return null;
  return d.toISOString();
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
  if (!Number.isFinite(dt.getTime())) return null;

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

type DbFlight = {
  schedule_key: string;
  airline: string;
  flight_number: string;
  origin: string;
  destination: string;
  scheduled_depart_iso: string | null;
  scheduled_arrive_iso: string | null;
  fa_flight_id: string | null;
};

export async function POST(req: Request) {
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

    const { data: lastFetchRow } = await sb
      .from("batch_flights")
      .select("last_aero_fetch_at")
      .eq("batch_id", batchId)
      .order("last_aero_fetch_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    const lastFetchIso = (lastFetchRow as any)?.last_aero_fetch_at ?? null;
    const lastFetchMs = lastFetchIso ? new Date(lastFetchIso).getTime() : NaN;
    const nowMs = Date.now();
    const cooldownMs = 30_000;

    if (Number.isFinite(lastFetchMs) && nowMs - lastFetchMs < cooldownMs) {
      const retryAfterMs = cooldownMs - (nowMs - lastFetchMs);
      return NextResponse.json(
        {
          ok: false,
          error: "Update cooldown active",
          retry_after_ms: Math.max(0, Math.ceil(retryAfterMs)),
        },
        { status: 429 },
      );
    }

    const { data: batch, error: batchErr } = await sb
      .from("batches")
      .select("id, search_payload")
      .eq("id", batchId)
      .single();

    if (batchErr || !batch) {
      return NextResponse.json(
        { ok: false, error: batchErr?.message ?? "Batch not found" },
        { status: 404 },
      );
    }

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

    const dbFlights: DbFlight[] = (flightsRaw ?? []).map((f: any) => ({
      schedule_key: f.schedule_key,
      airline: f.airline,
      flight_number: f.flight_number,
      origin: f.origin,
      destination: f.destination,
      scheduled_depart_iso: f.scheduled_depart_iso,
      scheduled_arrive_iso: f.scheduled_arrive_iso,
      fa_flight_id: (f.fa_flight_id ?? "").trim() || null,
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

    const canRunSchedules = Boolean(dateStart && dateEnd);

    const aeroStart = canRunSchedules ? `${dateStart}T00:00:00Z` : "";
    const aeroEnd = canRunSchedules ? `${dateEnd}T00:00:00Z` : "";

    const maxPagesCapPerQuery = 5;

    let schedulesUpdated = 0;

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

      const fa = (s.fa_flight_id ?? "").trim() || null;
      if (!fa) return;

      const { error } = await sb
        .from("batch_flights")
        .update({
          fa_flight_id: fa,
          scheduled_depart_iso: toIsoOrNull(scheduledDepartISO) ?? undefined,
          scheduled_arrive_iso: toIsoOrNull(scheduledArriveISO) ?? undefined,
        })
        .eq("batch_id", batchId)
        .eq("schedule_key", scheduleKey);

      if (!error) schedulesUpdated += 1;
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

    if (canRunSchedules) {
      if (airlines.length === 0) {
        const errRes = await runQueryForAirline(undefined);
        if (errRes) return errRes;
      } else {
        for (const a of airlines) {
          const errRes = await runQueryForAirline(a);
          if (errRes) return errRes;
        }
      }
    }

    const { data: flightsAfterSchedRaw } = await sb
      .from("batch_flights")
      .select("schedule_key, fa_flight_id")
      .eq("batch_id", batchId);

    const faByScheduleKey = new Map<string, string>();
    for (const r of flightsAfterSchedRaw ?? []) {
      const k = ((r as any).schedule_key ?? "").trim();
      const fa = (((r as any).fa_flight_id ?? "") as string).trim();
      if (k && fa) faByScheduleKey.set(k, fa);
    }

    const enrichTargets = dbFlights
      .map((f) => {
        const k = (f.schedule_key ?? "").trim();
        const fa = faByScheduleKey.get(k) ?? f.fa_flight_id ?? "";
        return { schedule_key: k, fa_flight_id: fa.trim() };
      })
      .filter((x) => x.schedule_key && x.fa_flight_id);

    const concurrency = 6;
    let idx = 0;

    let flightsAttempted = 0;
    let flightsUpdated = 0;
    let flightsFailed = 0;

    async function worker() {
      while (idx < enrichTargets.length) {
        const j = idx;
        idx += 1;

        const t = enrichTargets[j];
        flightsAttempted += 1;

        const { r } = await fetchFlightById({
          apiKey,
          faFlightId: t.fa_flight_id,
        });

        if (!r.ok) {
          flightsFailed += 1;
          continue;
        }

        const fj = (await r.json()) as AeroApiFlightResponse;
        const f0 = Array.isArray(fj.flights) ? fj.flights[0] : undefined;
        if (!f0) {
          flightsFailed += 1;
          continue;
        }

        const payload = {
          scheduled_depart_iso: toIsoOrNull(f0.scheduled_out) ?? undefined,
          actual_depart_iso: toIsoOrNull(f0.actual_out),
          scheduled_arrive_iso: toIsoOrNull(f0.scheduled_in) ?? undefined,
          expected_arrive_iso: toIsoOrNull(f0.estimated_in),
          actual_arrive_iso: toIsoOrNull(f0.actual_in),
          departure_delay_min: secToMin(f0.departure_delay),
          arrival_delay_min: secToMin(f0.arrival_delay),
          status: (f0.status ?? "").trim() || null,
          last_aero_fetch_at: new Date().toISOString(),
        } as any;

        const { error } = await sb
          .from("batch_flights")
          .update(payload)
          .eq("batch_id", batchId)
          .eq("schedule_key", t.schedule_key);

        if (error) {
          flightsFailed += 1;
          continue;
        }

        flightsUpdated += 1;
      }
    }

    await Promise.all(Array.from({ length: concurrency }, () => worker()));

    return NextResponse.json(
      {
        ok: true,
        batch_id: batchId,
        schedules_updated: schedulesUpdated,
        flights_attempted: flightsAttempted,
        flights_updated: flightsUpdated,
        flights_failed: flightsFailed,
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
