//app / page.tsx;
"use client";

import React, { useMemo, useState } from "react";
import Image from "next/image";

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

type FlightBatchItem = {
  airline: string;
  flightNumber: string;
  origin: string;
  destination: string;
  departLocalISO?: string; // optional
};

type SearchResponse =
  | {
      ok: true;
      flights: FlightResult[];
      raw?: unknown;
    }
  | {
      ok: false;
      error: string;
      details?: unknown;
    };

function todayISO() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function normalize(s: string) {
  return s.trim().toUpperCase();
}

function buildBatch(flights: FlightResult[]): FlightBatchItem[] {
  // IMPORTANT: build directly as FlightBatchItem | null so the type guard is valid.
  const items: Array<FlightBatchItem | null> = flights.map((f) => {
    const airline = (f.airline ?? "").trim();
    const flightNumber = (f.flightNumber ?? "").trim();
    const origin = (f.origin ?? "").trim();
    const destination = (f.destination ?? "").trim();

    if (!airline || !flightNumber || !origin || !destination) return null;

    const item: FlightBatchItem = {
      airline,
      flightNumber,
      origin,
      destination,
    };

    if (f.departLocalISO) item.departLocalISO = f.departLocalISO;

    return item;
  });

  return items.filter((x): x is FlightBatchItem => x !== null);
}

export default function Home() {
  const [origin, setOrigin] = useState("DEN");
  const [destination, setDestination] = useState("JFK");
  const [date, setDate] = useState(todayISO());
  const [airline, setAirline] = useState("");
  const [maxResults, setMaxResults] = useState(25);

  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [flights, setFlights] = useState<FlightResult[]>([]);
  const [lastResponseRaw, setLastResponseRaw] = useState<unknown>(null);

  const batch = useMemo(() => buildBatch(flights), [flights]);

  async function onSearch() {
    setIsLoading(true);
    setError(null);

    try {
      const payload = {
        origin: normalize(origin),
        destination: normalize(destination),
        date,
        airline: airline.trim() ? normalize(airline) : null,
        limit: Math.max(1, Math.min(200, maxResults)),
      };

      const res = await fetch("/api/flights/search", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });

      const json = (await res.json()) as SearchResponse;

      if (!res.ok || !json.ok) {
        setFlights([]);
        setLastResponseRaw((json as any)?.details ?? json);
        setError(json.ok ? "Unknown error" : json.error);
        return;
      }

      setFlights(json.flights ?? []);
      setLastResponseRaw(json.raw ?? null);
    } catch (e: any) {
      setFlights([]);
      setLastResponseRaw(null);
      setError(e?.message ?? "Request failed");
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-zinc-50 font-sans dark:bg-black">
      <main className="w-full max-w-4xl px-6 py-12">
        <div className="rounded-2xl bg-white p-8 shadow-sm dark:bg-zinc-950">
          <div className="flex items-start justify-between gap-6">
            <div className="flex flex-col gap-2">
              <div className="flex items-center gap-3">
                <Image
                  className="dark:invert"
                  src="/next.svg"
                  alt="Next.js logo"
                  width={72}
                  height={16}
                  priority
                />
                <span className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
                  Calibra
                </span>
              </div>
              <h1 className="text-2xl font-semibold tracking-tight text-zinc-950 dark:text-zinc-50">
                Flight Filter → Batch Builder
              </h1>
              <p className="text-sm leading-6 text-zinc-600 dark:text-zinc-400">
                Filter and fetch flights via a server-side API route, then
                generate a batch payload you can reuse downstream.
              </p>
            </div>
          </div>

          <div className="mt-8 grid grid-cols-1 gap-4 md:grid-cols-5">
            <div className="md:col-span-1">
              <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-400">
                Origin (IATA)
              </label>
              <input
                value={origin}
                onChange={(e) => setOrigin(e.target.value)}
                className="mt-1 w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900 outline-none focus:border-zinc-400 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-50"
                placeholder="DEN"
              />
            </div>

            <div className="md:col-span-1">
              <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-400">
                Destination (IATA)
              </label>
              <input
                value={destination}
                onChange={(e) => setDestination(e.target.value)}
                className="mt-1 w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900 outline-none focus:border-zinc-400 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-50"
                placeholder="JFK"
              />
            </div>

            <div className="md:col-span-1">
              <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-400">
                Date
              </label>
              <input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className="mt-1 w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900 outline-none focus:border-zinc-400 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-50"
              />
            </div>

            <div className="md:col-span-1">
              <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-400">
                Airline (optional)
              </label>
              <input
                value={airline}
                onChange={(e) => setAirline(e.target.value)}
                className="mt-1 w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900 outline-none focus:border-zinc-400 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-50"
                placeholder="UA / DL / AA"
              />
            </div>

            <div className="md:col-span-1">
              <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-400">
                Max Results
              </label>
              <input
                type="number"
                value={maxResults}
                onChange={(e) => setMaxResults(Number(e.target.value))}
                min={1}
                max={200}
                className="mt-1 w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900 outline-none focus:border-zinc-400 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-50"
              />
            </div>
          </div>

          <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <button
              onClick={onSearch}
              disabled={isLoading}
              className="inline-flex h-11 items-center justify-center rounded-full bg-zinc-900 px-5 text-sm font-medium text-white transition hover:bg-zinc-800 disabled:opacity-60 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-white"
            >
              {isLoading ? "Searching…" : "Search Flights"}
            </button>

            <div className="text-xs text-zinc-500 dark:text-zinc-400">
              Calls <span className="font-mono">POST /api/flights/search</span>
            </div>
          </div>

          {error ? (
            <div className="mt-6 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-200">
              <div className="font-medium">Error</div>
              <div className="mt-1">{error}</div>
            </div>
          ) : null}

          <div className="mt-8 grid grid-cols-1 gap-6 md:grid-cols-2">
            <div className="rounded-2xl border border-zinc-200 p-5 dark:border-zinc-800">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">
                  Results ({flights.length})
                </h2>
                <span className="text-xs text-zinc-500 dark:text-zinc-400">
                  Preview
                </span>
              </div>

              <div className="mt-4 max-h-[420px] overflow-auto rounded-xl bg-zinc-50 p-3 text-xs text-zinc-900 dark:bg-black dark:text-zinc-50">
                {flights.length === 0 ? (
                  <div className="text-zinc-500 dark:text-zinc-400">
                    No results yet.
                  </div>
                ) : (
                  <pre className="whitespace-pre-wrap break-words">
                    {JSON.stringify(flights.slice(0, 50), null, 2)}
                  </pre>
                )}
              </div>
            </div>

            <div className="rounded-2xl border border-zinc-200 p-5 dark:border-zinc-800">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">
                  Batch ({batch.length})
                </h2>
                <span className="text-xs text-zinc-500 dark:text-zinc-400">
                  What you’ll persist / process
                </span>
              </div>

              <div className="mt-4 max-h-[420px] overflow-auto rounded-xl bg-zinc-50 p-3 text-xs text-zinc-900 dark:bg-black dark:text-zinc-50">
                {batch.length === 0 ? (
                  <div className="text-zinc-500 dark:text-zinc-400">
                    Batch will appear after search.
                  </div>
                ) : (
                  <pre className="whitespace-pre-wrap break-words">
                    {JSON.stringify(batch, null, 2)}
                  </pre>
                )}
              </div>

              {lastResponseRaw ? (
                <details className="mt-4">
                  <summary className="cursor-pointer text-xs font-medium text-zinc-600 dark:text-zinc-400">
                    Debug: raw response
                  </summary>
                  <div className="mt-2 max-h-[220px] overflow-auto rounded-xl bg-zinc-50 p-3 text-xs text-zinc-900 dark:bg-black dark:text-zinc-50">
                    <pre className="whitespace-pre-wrap break-words">
                      {JSON.stringify(lastResponseRaw, null, 2)}
                    </pre>
                  </div>
                </details>
              ) : null}
            </div>
          </div>

          <div className="mt-8 text-xs leading-5 text-zinc-500 dark:text-zinc-400">
            Next step: create{" "}
            <span className="font-mono">app/api/flights/search/route.ts</span>{" "}
            to call FlightAware server-side using{" "}
            <span className="font-mono">FLIGHTAWARE_API_KEY</span> and return
            the normalized fields used above.
          </div>
        </div>
      </main>
    </div>
  );
}
