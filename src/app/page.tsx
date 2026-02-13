// app/page.tsx
"use client";

import React, { useState } from "react";
import Image from "next/image";
import BatchPortfolioTable, {
  type BatchRow,
} from "./components/BatchPortfolioTable";

type FlightResult = {
  id?: string; // fa_flight_id
  airline?: string;
  flightNumber?: string;
  origin?: string;
  destination?: string;

  // NEW fields coming from your updated /api/flights/search
  scheduledDepartISO?: string;
  actualDepartISO?: string;
  scheduledArriveISO?: string;
  actualArriveISO?: string;
  departureDelayMin?: number;
  arrivalDelayMin?: number;

  status?: string;

  // Back-compat (safe if server still returns these)
  departLocalISO?: string;
  arriveLocalISO?: string;
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

export default function Home() {
  const [origin, setOrigin] = useState("DEN");
  const [destination, setDestination] = useState("JFK");
  const [date, setDate] = useState(todayISO());
  const [airline, setAirline] = useState("");
  const [maxResults, setMaxResults] = useState(25);

  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [batchRows, setBatchRows] = useState<BatchRow[]>([]);

  async function onSearch() {
    setIsLoading(true);
    setError(null);

    try {
      const airlineList = airline
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
        .map(normalize);

      const payload = {
        origin: origin.trim() ? normalize(origin) : null,
        destination: destination.trim() ? normalize(destination) : null,
        date,
        airlines: airlineList.length > 0 ? airlineList : null,
        limit: Math.max(1, Math.min(200, maxResults)),
      };

      const res = await fetch("/api/flights/search", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });

      const json = (await res.json()) as SearchResponse;

      if (!res.ok || !json.ok) {
        setBatchRows([]);
        setError(json.ok ? "Unknown error" : json.error);
        return;
      }

      const nextRows: BatchRow[] = (json.flights ?? [])
        .map((f) => {
          const a = (f.airline ?? "").trim();
          const n = (f.flightNumber ?? "").trim();
          const o = (f.origin ?? "").trim();
          const d = (f.destination ?? "").trim();

          if (!a || !n || !o || !d) return null;

          const status = (f.status ?? "Scheduled").trim() || "Scheduled";

          // Prefer the new scheduled/actual fields; fall back to old fields if present
          const scheduledDepartISO =
            f.scheduledDepartISO ?? f.departLocalISO ?? undefined;
          const scheduledArriveISO =
            f.scheduledArriveISO ?? f.arriveLocalISO ?? undefined;

          const row: BatchRow = {
            id: f.id,
            airline: a,
            flightNumber: n,
            origin: o,
            destination: d,

            scheduledDepartISO,
            actualDepartISO: f.actualDepartISO,
            scheduledArriveISO,
            actualArriveISO: f.actualArriveISO,
            departureDelayMin: f.departureDelayMin,
            arrivalDelayMin: f.arrivalDelayMin,

            status,
            included: true,
          };

          return row;
        })
        .filter((x): x is BatchRow => x !== null);

      setBatchRows(nextRows);
    } catch (e: any) {
      setBatchRows([]);
      setError(e?.message ?? "Request failed");
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-zinc-50 font-sans dark:bg-black">
      {/* widened from max-w-4xl -> max-w-7xl so the table fits */}
      <main className="w-full max-w-7xl px-6 py-12">
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
                Search flights and generate a normalized batch for downstream
                processing.
              </p>
            </div>
          </div>

          <div className="mt-8 grid grid-cols-1 gap-4 md:grid-cols-5">
            <div className="md:col-span-1">
              <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-400">
                Origin (IATA, optional)
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
                Destination (IATA, optional)
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
                Airlines (optional, comma-separated)
              </label>
              <input
                value={airline}
                onChange={(e) => setAirline(e.target.value)}
                className="mt-1 w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900 outline-none focus:border-zinc-400 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-50"
                placeholder="UA, DL, AA"
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

          <div className="mt-8">
            <BatchPortfolioTable
              rows={batchRows}
              setRows={setBatchRows}
              isLoading={isLoading}
              error={error}
            />
          </div>
        </div>
      </main>
    </div>
  );
}
