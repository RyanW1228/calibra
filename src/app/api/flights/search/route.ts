// app/api/flights/search/route.ts
import { NextResponse } from "next/server";

type SearchBody = {
  origin?: string | null; // optional (wildcard if blank)
  destination?: string | null; // optional (wildcard if blank)
  date: string; // YYYY-MM-DD
  airline?: string | null; // legacy: single airline (IATA or ICAO)
  airlines?: string[] | null; // new: multiple airlines
  departStartHour?: number | null; // 0..23 (UTC hour, inclusive)
  departEndHour?: number | null; // 0..23 (UTC hour, inclusive)
  limit: number; // 1..200
};

type AeroApiSchedulesResponse = {
  links?: { next?: string } | null;
  num_pages?: number;
  scheduled?: Array<{
    ident?: string;
    ident_icao?: string | null;
    ident_iata?: string | null;

    // If ident is a codeshare, AeroAPI provides actual_ident fields.
    // We use actual_ident* when available to represent the operating flight.
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

  // Inclusive window. Supports wraparound (e.g., 22 → 2).
  if (start <= end) return h >= start && h <= end;
  return h >= start || h <= end;
}

function uniqKeyForFlight(r: FlightResult) {
  // Prefer FlightAware ID when available (best).
  if (r.id) return `id:${r.id}`;

  // Otherwise dedupe by route + departure time + operating ident.
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
  airline?: string; // single airline filter, if provided
  cursor?: string;
}) {
  const url = buildAeroApiUrl(
    `/schedules/${encodeURIComponent(opts.dateStart)}/${encodeURIComponent(opts.dateEnd)}`,
    {
      origin: opts.origin,
      destination: opts.destination,
      airline: opts.airline,
      include_codeshares: "false", // critical: avoid marketing-flight duplicates
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

    const date = (body.date ?? "").trim();
    if (!isValidYyyyMmDd(date)) {
      return NextResponse.json(
        { ok: false, error: "date must be YYYY-MM-DD" },
        { status: 400 },
      );
    }

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

    // Airline filters:
    // - Support legacy `airline` (single)
    // - Support `airlines` (multi)
    // If multiple are provided, we query each airline separately (more “institutional” control)
    // and then dedupe + cap to limit.
    let airlines: string[] = [];
    if (Array.isArray(body.airlines) && body.airlines.length > 0) {
      airlines = body.airlines
        .map(cleanAirlineCode)
        .filter((x): x is string => Boolean(x));
    } else {
      const single = cleanAirlineCode(body.airline);
      if (single) airlines = [single];
    }

    const dateStart = date;
    const dateEnd = addDaysISO(date, 1);

    const maxPagesCapPerQuery = 5;

    const out: FlightResult[] = [];
    const seen = new Set<string>();

    async function ingestFromScheduleItem(
      s: NonNullable<AeroApiSchedulesResponse["scheduled"]>[number],
    ) {
      // Prefer operating ident fields when present (more “physical flight” oriented)
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

      const key = uniqKeyForFlight(candidate);
      if (seen.has(key)) return;

      seen.add(key);
      out.push(candidate);
    }

    async function runQueryForAirline(airline?: string) {
      let cursor: string | undefined = undefined;
      let pagesFetched = 0;

      while (pagesFetched < maxPagesCapPerQuery && out.length < limit) {
        const { r } = await fetchSchedulesPage({
          apiKey,
          dateStart,
          dateEnd,
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
              details: text ? { body: text } : undefined,
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
      // No airline filter: single query for the whole market slice (origin/dest optional)
      const errRes = await runQueryForAirline(undefined);
      if (errRes) return errRes;
    } else {
      // Multi-airline: query each carrier, dedupe/cap in server
      for (const a of airlines) {
        if (out.length >= limit) break;
        const errRes = await runQueryForAirline(a);
        if (errRes) return errRes;
      }
    }

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

        // Back-compat:
        row.departLocalISO = row.scheduledDepartISO;
        row.arriveLocalISO = row.scheduledArriveISO;
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
