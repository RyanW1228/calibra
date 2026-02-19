// app/builder/page.tsx
"use client";

import React, { useState } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { useAccount } from "wagmi";
import BatchPortfolioTable, {
  type BatchRow,
} from "./components/BatchPortfolioTable";
import FlightFilters, {
  type SearchPayloadV1,
} from "./components/FlightFilters";

type FlightResult = {
  scheduleKey?: string;
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

function toYyyyMmDd(v: unknown): string {
  if (typeof v !== "string") return "";
  const s = v.trim();

  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;

  const m = s.match(/^(\d{4}-\d{2}-\d{2})T/);
  if (m) return m[1];

  return "";
}

function addDaysYyyyMmDd(dateISO: string, days: number): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateISO)) return "";
  const [y, m, d] = dateISO.split("-").map((x) => Number(x));
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  const yy = dt.getUTCFullYear();
  const mm = String(dt.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(dt.getUTCDate()).padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
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

async function postCreateBatch(payload: {
  displayTimeZone: string;
  search: Record<string, unknown>;
  includedScheduleKeys: string[];
  flights: Array<{
    scheduleKey: string;
    airline: string;
    flightNumber: string;
    origin: string;
    destination: string;
    scheduledDepartISO?: string;
    scheduledArriveISO?: string;
  }>;
  funderAddress: string;
}): Promise<
  | { ok: true; batchId: string }
  | { ok: false; error: string; details?: unknown }
> {
  const res = await fetch("/api/batches/create", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });

  const json = (await res.json()) as
    | { ok: true; batchId: string }
    | { ok: false; error: string; details?: unknown };

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
  const router = useRouter();
  const { address } = useAccount();

  const [displayTimeZone, setDisplayTimeZone] = useState("UTC");

  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [batchRows, setBatchRows] = useState<BatchRow[]>([]);
  const [lastSearchPayload, setLastSearchPayload] = useState<any | null>(null);

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
      const dateStart = toYyyyMmDd(payloadV1.dateStart);
      let dateEnd = toYyyyMmDd(payloadV1.dateEnd);

      if (!dateEnd && dateStart) {
        dateEnd = addDaysYyyyMmDd(dateStart, 1);
      }

      if (!dateStart || !dateEnd) {
        setBatchRows([]);
        setError("Invalid dateStart/dateEnd (must be YYYY-MM-DD).");
        return;
      }

      const airlines = Array.isArray(payloadV1.carriers)
        ? payloadV1.carriers
        : null;

      const payload = {
        origin: origin ? normalize(origin) : null,
        destination: destination ? normalize(destination) : null,
        dateStart,
        dateEnd,
        airlines: airlines && airlines.length ? airlines.map(normalize) : null,
        limit: Math.max(1, Math.min(1000, payloadV1.limit ?? 500)),
      };

      setLastSearchPayload(payload);

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
            scheduledArriveISO,

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

  async function onCreateBatch(selected: BatchRow[]) {
    if (selected.length === 0) return;

    if (!lastSearchPayload) {
      setError("Run a search first (missing search payload).");
      return;
    }

    if (!address) {
      setError("Connect wallet to create a batch.");
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const payload = {
        displayTimeZone,
        search: lastSearchPayload as Record<string, unknown>,
        includedScheduleKeys: selected.map((r) => r.scheduleKey),
        flights: selected.map((r) => ({
          scheduleKey: r.scheduleKey,
          airline: r.airline,
          flightNumber: r.flightNumber,
          origin: r.origin,
          destination: r.destination,
          scheduledDepartISO: r.scheduledDepartISO,
          scheduledArriveISO: r.scheduledArriveISO,
        })),
        funderAddress: address,
      };

      const json = await postCreateBatch(payload);

      if (!json.ok) {
        setError(json.error);
        return;
      }

      router.push(`/fund/${encodeURIComponent(json.batchId)}`);
    } catch (e: any) {
      setError(e?.message ?? "Create batch failed");
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
              <h1 className="text-2xl font-semibold tracking-tight text-zinc-950 dark:text-zinc-50">
                Batch Builder
              </h1>

              <p className="text-sm leading-6 text-zinc-600 dark:text-zinc-400">
                Filter flights, review the selection, then create a batch for
                funding and monitoring.
              </p>
            </div>

            <button
              onClick={() => router.push("/")}
              className="inline-flex h-9 items-center justify-center rounded-full border border-zinc-200 bg-white px-4 text-xs font-medium text-zinc-900 transition hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-50 dark:hover:bg-black"
            >
              Back
            </button>
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
              onCreateBatch={onCreateBatch}
            />
          </div>
        </div>
      </main>
    </div>
  );
}
