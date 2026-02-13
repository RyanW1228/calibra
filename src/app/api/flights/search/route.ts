// app/api/flights/search/route.ts
import { NextResponse } from "next/server";

type SearchBody = {
  origin?: string | null;
  destination?: string | null;
  dateStart: string;
  dateEnd: string;
  airline?: string | null;
  airlines?: string[] | null;
  departStartHour?: number | null;
  departEndHour?: number | null;
  limit: number;
};

type AeroApiSchedulesResponse = {
  links?: { next?: string } | null;
  num_pages?: number;
  scheduled?: Array<{
    ident?: string;
    ident_icao?: string | null;
    ident_iata?: string | null;

    actual_ident?: string | null;
    actual_ident_icao?: string | null;
    actual_ident_iata?: string | null;

    scheduled_out?: string; // date-time (Z)
    scheduled_in?: string; // date-time (Z)

    origin?: string;
    origin_iata?: string | null;
    origin_icao?: string | null;

    destination?: string;
    destination_iata?: string | null;
    destination_icao?: string | null;

    fa_flight_id?: string | null;
  }>;
};

type FlightResult = {
  // NEW: primary identity
  scheduleKey?: string;

  // Back-compat: keep returning this for now (we will stop using it next)
  id?: string; // fa_flight_id

  airline?: string;
  flightNumber?: string;
  origin?: string;
  destination?: string;

  scheduledDepartISO?: string;
  actualDepartISO?: string;
  scheduledArriveISO?: string;
  actualArriveISO?: string;

  departureDelayMin?: number;
  arrivalDelayMin?: number;

  status?: string;

  departLocalISO?: string;
  arriveLocalISO?: string;
};

function isValidYyyyMmDd(s: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(s);
}

function normalizeUpper(s: string) {
  return s.trim().toUpperCase();
}

function cleanAirportCode(s: string | null | undefined) {
  const v = (s ?? "").trim();
  if (!v) return undefined;
  return normalizeUpper(v);
}

function cleanAirlineCode(s: string | null | undefined) {
  const v = (s ?? "").trim();
  if (!v) return undefined;
  return normalizeUpper(v);
}

function addDaysISO(dateISO: string, days: number) {
  const [y, m, d] = dateISO.split("-").map((x) => Number(x));
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  const yy = dt.getUTCFullYear();
  const mm = String(dt.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(dt.getUTCDate()).padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
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

function clampInt(n: unknown, min: number, max: number, fallback: number) {
  if (typeof n !== "number" || Number.isNaN(n)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(n)));
}

function hourInWindowUTC(iso: string | undefined, start: number, end: number) {
  if (!iso) return false;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return false;
  const h = d.getUTCHours();

  if (start <= end) return h >= start && h <= end;
  return h >= start || h <= end;
}

// NEW: deterministic schedule identity (UTC timestamp baked in)
function buildScheduleKey(r: {
  airline?: string;
  flightNumber?: string;
  origin?: string;
  destination?: string;
  scheduledDepartISO?: string;
}) {
  const a = (r.airline ?? "").trim().toUpperCase();
  const n = (r.flightNumber ?? "").trim().toUpperCase();
  const o = (r.origin ?? "").trim().toUpperCase();
  const d = (r.destination ?? "").trim().toUpperCase();
  const t = (r.scheduledDepartISO ?? "").trim();

  if (!a || !n || !o || !d || !t) return undefined;

  const dt = new Date(t);
  if (Number.isNaN(dt.getTime())) return undefined;

  // ISO string canonicalizes to UTC with seconds/ms; stable
  const isoUTC = dt.toISOString();
  return `${a}|${n}|${o}|${d}|${isoUTC}`;
}

function uniqKeyForFlight(r: FlightResult) {
  // NEW: prefer scheduleKey always
  if (r.scheduleKey) return `sk:${r.scheduleKey}`;

  // Back-compat fallback:
  if (r.id) return `id:${r.id}`;

  return [
    r.origin ?? "",
    r.destination ?? "",
    r.scheduledDepartISO ?? r.departLocalISO ?? "",
    r.airline ?? "",
    r.flightNumber ?? "",
  ].join("|");
}

async function fetchSchedulesPage(opts: {
  apiKey: string;
  dateStart: string;
  dateEnd: string;
  origin?: string;
  destination?: string;
  airline?: string;
  cursor?: string;
}) {
  const url = buildAeroApiUrl(
    `/schedules/${encodeURIComponent(opts.dateStart)}/${encodeURIComponent(
      opts.dateEnd,
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
    headers: {
      "x-apikey": opts.apiKey,
      accept: "application/json",
    },
    cache: "no-store",
  });

  return { r, url };
}

type AeroApiFlightResponse = {
  flights?: Array<{
    fa_flight_id?: string | null;
    scheduled_out?: string | null;
    actual_out?: string | null;
    scheduled_in?: string | null;
    actual_in?: string | null;
    departure_delay?: number | null; // seconds
    arrival_delay?: number | null; // seconds
    status?: string | null;
  }> | null;
};

async function fetchFlightById(opts: { apiKey: string; faFlightId: string }) {
  const url = buildAeroApiUrl(
    `/flights/${encodeURIComponent(opts.faFlightId)}`,
    {},
  );
  const r = await fetch(url, {
    method: "GET",
    headers: {
      "x-apikey": opts.apiKey,
      accept: "application/json",
    },
    cache: "no-store",
  });
  return { r, url };
}

function secToMin(sec: number | null | undefined) {
  if (typeof sec !== "number" || Number.isNaN(sec)) return undefined;
  return Math.round(sec / 60);
}

export async function POST(req: Request) {
  try {
    const apiKey = process.env.FLIGHTAWARE_API_KEY ?? "";
    if (!apiKey) {
      return NextResponse.json(
        { ok: false, error: "Server missing FLIGHTAWARE_API_KEY" },
        { status: 500 },
      );
    }

    const body = (await req.json()) as Partial<SearchBody>;

    const origin = cleanAirportCode(body.origin);
    const destination = cleanAirportCode(body.destination);

    const dateStart = (body.dateStart ?? "").trim();
    const dateEnd = (body.dateEnd ?? "").trim();

    if (!isValidYyyyMmDd(dateStart) || !isValidYyyyMmDd(dateEnd)) {
      return NextResponse.json(
        { ok: false, error: "dateStart/dateEnd must be YYYY-MM-DD" },
        { status: 400 },
      );
    }

    // enforce (dateEnd > dateStart) and max horizon <= 30 days
    const startMs = Date.parse(`${dateStart}T00:00:00Z`);
    const endMs = Date.parse(`${dateEnd}T00:00:00Z`);

    if (
      !Number.isFinite(startMs) ||
      !Number.isFinite(endMs) ||
      endMs <= startMs
    ) {
      return NextResponse.json(
        { ok: false, error: "dateEnd must be after dateStart" },
        { status: 400 },
      );
    }

    const days = Math.ceil((endMs - startMs) / 86400000);
    if (days > 30) {
      return NextResponse.json(
        { ok: false, error: "date range too large (max 30 days)" },
        { status: 400 },
      );
    }

    const aeroStart = `${dateStart}T00:00:00Z`;
    const aeroEnd = `${dateEnd}T00:00:00Z`;

    const limit = clampInt(body.limit, 1, 200, 25);

    const departStartHour =
      body.departStartHour === null || body.departStartHour === undefined
        ? undefined
        : clampInt(body.departStartHour, 0, 23, 0);

    const departEndHour =
      body.departEndHour === null || body.departEndHour === undefined
        ? undefined
        : clampInt(body.departEndHour, 0, 23, 23);

    const hasHourFilter =
      departStartHour !== undefined && departEndHour !== undefined;

    let airlines: string[] = [];
    if (Array.isArray(body.airlines) && body.airlines.length > 0) {
      airlines = body.airlines
        .map(cleanAirlineCode)
        .filter((x): x is string => Boolean(x));
    } else {
      const single = cleanAirlineCode(body.airline);
      if (single) airlines = [single];
    }

    const maxPagesCapPerQuery = 5;

    const out: FlightResult[] = [];
    const seen = new Set<string>();

    async function ingestFromScheduleItem(
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

      const originOut =
        s.origin_iata ?? s.origin_icao ?? s.origin ?? origin ?? undefined;
      const destOut =
        s.destination_iata ??
        s.destination_icao ??
        s.destination ??
        destination ??
        undefined;

      const scheduledDepartISO = s.scheduled_out ?? undefined;

      if (
        hasHourFilter &&
        departStartHour !== undefined &&
        departEndHour !== undefined
      ) {
        if (
          !hourInWindowUTC(scheduledDepartISO, departStartHour, departEndHour)
        )
          return;
      }

      const candidate: FlightResult = {
        // NEW: compute scheduleKey now
        scheduleKey: undefined,

        // Back-compat: keep returning FlightAware ID if present (we'll stop using it next)
        id: s.fa_flight_id ?? undefined,

        airline,
        flightNumber,
        origin: originOut,
        destination: destOut,

        scheduledDepartISO,
        scheduledArriveISO: s.scheduled_in ?? undefined,

        departLocalISO: scheduledDepartISO,
        arriveLocalISO: s.scheduled_in ?? undefined,

        status: undefined,
      };

      candidate.scheduleKey = buildScheduleKey(candidate);

      const key = uniqKeyForFlight(candidate);
      if (seen.has(key)) return;

      seen.add(key);
      out.push(candidate);
    }

    async function runQueryForAirline(airline?: string) {
      let cursor: string | undefined = undefined;
      let pagesFetched = 0;

      while (pagesFetched < maxPagesCapPerQuery && out.length < limit) {
        const { r, url } = await fetchSchedulesPage({
          apiKey,
          dateStart: aeroStart,
          dateEnd: aeroEnd,
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
              details: { url, body: text },
            },
            { status: 502 },
          );
        }

        const json = (await r.json()) as AeroApiSchedulesResponse;
        const scheduled = Array.isArray(json.scheduled) ? json.scheduled : [];

        for (const s of scheduled) {
          if (out.length >= limit) break;
          await ingestFromScheduleItem(s);
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
        if (out.length >= limit) break;
        const errRes = await runQueryForAirline(a);
        if (errRes) return errRes;
      }
    }

    // NOTE: enrichment still keys off row.id for now.
    // Next step after frontend migration: either remove enrichment, or switch to scheduleKey->resolve->enrich.
    const maxEnrich = Math.min(out.length, limit);
    const concurrency = 6;

    let i = 0;
    async function worker() {
      while (i < maxEnrich) {
        const idx = i;
        i += 1;

        const row = out[idx];
        if (!row?.id) continue;

        const { r } = await fetchFlightById({ apiKey, faFlightId: row.id });
        if (!r.ok) continue;

        const fj = (await r.json()) as AeroApiFlightResponse;
        const f0 = Array.isArray(fj.flights) ? fj.flights[0] : undefined;
        if (!f0) continue;

        row.scheduledDepartISO = f0.scheduled_out ?? row.scheduledDepartISO;
        row.actualDepartISO = f0.actual_out ?? undefined;
        row.scheduledArriveISO = f0.scheduled_in ?? row.scheduledArriveISO;
        row.actualArriveISO = f0.actual_in ?? undefined;

        row.departureDelayMin = secToMin(f0.departure_delay);
        row.arrivalDelayMin = secToMin(f0.arrival_delay);

        row.status = f0.status ?? row.status;

        row.departLocalISO = row.scheduledDepartISO;
        row.arriveLocalISO = row.scheduledArriveISO;

        // Keep scheduleKey consistent even if scheduledDepartISO got normalized/updated.
        row.scheduleKey = buildScheduleKey(row) ?? row.scheduleKey;
      }
    }

    await Promise.all(Array.from({ length: concurrency }, () => worker()));

    return NextResponse.json({ ok: true, flights: out }, { status: 200 });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message ?? "Unknown server error" },
      { status: 500 },
    );
  }
}
