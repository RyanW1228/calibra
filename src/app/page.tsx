// app/page.tsx
"use client";

import React, { useState } from "react";
import Image from "next/image";
import BatchPortfolioTable, {
  type BatchRow,
} from "./components/BatchPortfolioTable";
import FlightFilters, {
  type SearchPayloadV1,
} from "./components/FlightFilters";

type FlightResult = {
  scheduleKey?: string;
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

  // Back-compat
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

function normalize(s: string) {
  return s.trim().toUpperCase();
}

function todayISO() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

async function postSearch(payload: any): Promise<SearchResponse> {
  const res = await fetch("/api/flights/search", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });

  const json = (await res.json()) as SearchResponse;

  if (!res.ok) {
    return {
      ok: false,
      error: json.ok ? "Request failed" : json.error,
      details: json,
    };
  }

  return json;
}

export default function Home() {
  const [displayTimeZone, setDisplayTimeZone] = useState("UTC");

  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [batchRows, setBatchRows] = useState<BatchRow[]>([]);

  async function onSearch(payloadV1: SearchPayloadV1) {
    setIsLoading(true);
    setError(null);

    try {
      if (payloadV1.mode === "lookup") {
        setBatchRows([]);
        setError("Lookup mode isn’t wired to the backend yet.");
        return;
      }

      const origin = (payloadV1.origins?.[0] ?? "").trim();
      const destination = (payloadV1.destinations?.[0] ?? "").trim();
      const dateStart = payloadV1.dateStart;
      const dateEnd = payloadV1.dateEnd;

      // carriers[] -> airlines
      const airlines = Array.isArray(payloadV1.carriers)
        ? payloadV1.carriers
        : null;

      const payload = {
        origin: origin ? normalize(origin) : null,
        destination: destination ? normalize(destination) : null,
        dateStart,
        dateEnd,
        airlines: airlines && airlines.length ? airlines.map(normalize) : null,
        limit: Math.max(1, Math.min(200, payloadV1.limit)),
      };

      const json = await postSearch(payload);

      if (!json.ok) {
        setBatchRows([]);
        setError(json.error);
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

          const scheduledDepartISO =
            f.scheduledDepartISO ?? f.departLocalISO ?? undefined;
          const scheduledArriveISO =
            f.scheduledArriveISO ?? f.arriveLocalISO ?? undefined;

          const scheduleKey = (f.scheduleKey ?? "").trim();
          if (!scheduleKey) return null;

          const row: BatchRow = {
            scheduleKey,
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

            // optional debug / future enrichment, not used for identity
            faFlightId: f.id,
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

          <div className="mt-8">
            <FlightFilters
              isLoading={isLoading}
              onSearch={onSearch}
              displayTimeZone={displayTimeZone}
              onDisplayTimeZoneChange={setDisplayTimeZone}
              defaultOrigin="DEN"
              defaultDestination="JFK"
              defaultCarriersCsv=""
              defaultLimit={25}
            />
          </div>

          <div className="mt-8">
            <BatchPortfolioTable
              rows={batchRows}
              setRows={setBatchRows}
              isLoading={isLoading}
              error={error}
              displayTimeZone={displayTimeZone}
            />
          </div>
        </div>
      </main>
    </div>
  );
}
