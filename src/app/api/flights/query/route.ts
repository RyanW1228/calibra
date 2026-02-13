//calibra/src/app/api/flights/query/route.ts
import { NextResponse } from "next/server";

type QueryReq = {
  airport: string; // "JFK" or "KJFK"
  start?: string | null; // optional ISO string
  end?: string | null; // optional ISO string
  maxPages?: number | null; // keep low for Personal plan
};

export async function POST(req: Request) {
  const apiKey = process.env.FLIGHTAWARE_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { ok: false, error: "Missing FLIGHTAWARE_API_KEY" },
      { status: 500 },
    );
  }

  let body: QueryReq;
  try {
    body = (await req.json()) as QueryReq;
  } catch {
    return NextResponse.json(
      { ok: false, error: "Invalid JSON" },
      { status: 400 },
    );
  }

  const airport = (body.airport ?? "").trim();
  if (!airport) {
    return NextResponse.json(
      { ok: false, error: "Missing airport" },
      { status: 400 },
    );
  }

  const url = new URL(
    `https://aeroapi.flightaware.com/aeroapi/airports/${encodeURIComponent(airport)}/flights/scheduled_departures`,
  );

  if (body.start) url.searchParams.set("start", body.start);
  if (body.end) url.searchParams.set("end", body.end);
  url.searchParams.set("max_pages", String(body.maxPages ?? 1));

  const resp = await fetch(url.toString(), {
    headers: {
      "x-apikey": apiKey,
      accept: "application/json",
    },
    cache: "no-store",
  });

  const text = await resp.text();

  if (!resp.ok) {
    return NextResponse.json(
      { ok: false, status: resp.status, error: text.slice(0, 800) },
      { status: 502 },
    );
  }

  return new NextResponse(text, {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}
