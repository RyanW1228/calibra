// app/api/flights/search/route.ts
import { NextResponse } from "next/server";

type SearchBody = {
  origin: string;
  destination: string;
  date: string; // YYYY-MM-DD
  airline: string | null; // IATA or ICAO
  limit: number; // 1..200
};

type AeroApiSchedulesResponse = {
  links?: { next?: string } | null;
  num_pages?: number;
  scheduled?: Array<{
    ident?: string;
    ident_icao?: string | null;
    ident_iata?: string | null;
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
  id?: string;
  airline?: string;
  flightNumber?: string;
  origin?: string;
  destination?: string;
  departLocalISO?: string;
  arriveLocalISO?: string;
  status?: string;
};

function isValidYyyyMmDd(s: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(s);
}

function normalizeUpper(s: string) {
  return s.trim().toUpperCase();
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
  const s = ident.trim().toUpperCase();
  const compact = s.replace(/\s+/g, "");
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

export async function POST(req: Request) {
  try {
    const apiKey = process.env.FLIGHTAWARE_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        { ok: false, error: "Server missing FLIGHTAWARE_API_KEY" },
        { status: 500 },
      );
    }

    const body = (await req.json()) as Partial<SearchBody>;

    const origin = normalizeUpper(body.origin ?? "");
    const destination = normalizeUpper(body.destination ?? "");
    const date = (body.date ?? "").trim();
    const airline = body.airline ? normalizeUpper(body.airline) : null;

    const limitRaw = typeof body.limit === "number" ? body.limit : 25;
    const limit = Math.max(1, Math.min(200, Math.floor(limitRaw)));

    if (!origin || !destination) {
      return NextResponse.json(
        { ok: false, error: "origin and destination are required" },
        { status: 400 },
      );
    }

    if (!isValidYyyyMmDd(date)) {
      return NextResponse.json(
        { ok: false, error: "date must be YYYY-MM-DD" },
        { status: 400 },
      );
    }

    const dateStart = date;
    const dateEnd = addDaysISO(date, 1);

    // We keep pagination, but IMPORTANT CHANGE:
    // include_codeshares=false so we don't return a bunch of marketing-flight duplicates
    // (this is why you saw many “different airlines” at the same departure time).
    const maxPagesCap = 5;
    let cursor: string | undefined = undefined;
    let pagesFetched = 0;

    const out: FlightResult[] = [];

    while (pagesFetched < maxPagesCap && out.length < limit) {
      const url = buildAeroApiUrl(
        `/schedules/${encodeURIComponent(dateStart)}/${encodeURIComponent(dateEnd)}`,
        {
          origin,
          destination,
          airline: airline ?? undefined,
          include_codeshares: "false", // <-- change here
          include_regional: "true",
          max_pages: "1",
          cursor,
        },
      );

      const r = await fetch(url, {
        method: "GET",
        headers: {
          "x-apikey": apiKey,
          accept: "application/json",
        },
        cache: "no-store",
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

        const bestIdent = s.ident_iata ?? s.ident_icao ?? s.ident ?? "";
        const { airline: a, flightNumber } = splitIdent(bestIdent);

        const originOut = s.origin_iata ?? s.origin_icao ?? s.origin ?? origin;
        const destOut =
          s.destination_iata ??
          s.destination_icao ??
          s.destination ??
          destination;

        out.push({
          id: s.fa_flight_id ?? undefined,
          airline: a,
          flightNumber,
          origin: originOut,
          destination: destOut,
          departLocalISO: s.scheduled_out ?? undefined,
          arriveLocalISO: s.scheduled_in ?? undefined,
          status: undefined,
        });
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

    return NextResponse.json({ ok: true, flights: out }, { status: 200 });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message ?? "Unknown server error" },
      { status: 500 },
    );
  }
}
