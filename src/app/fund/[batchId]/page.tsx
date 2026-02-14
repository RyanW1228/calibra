// app/fund/[batchId]/page.tsx
"use client";

import React, { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";

type BatchFlight = {
  schedule_key: string;
  airline: string;
  flight_number: string;
  origin: string;
  destination: string;
  scheduled_depart_iso: string | null;
  scheduled_arrive_iso: string | null;
};

type BatchGetResponse =
  | {
      ok: true;
      batch: {
        id: string;
        display_time_zone: string;
        flight_count: number;
        status: string;
        created_at: string;
      };
      flights: BatchFlight[];
    }
  | { ok: false; error: string; details?: unknown };

type BatchInfo = Extract<BatchGetResponse, { ok: true }>["batch"];

function fmtLocal(iso: string | null | undefined, tz: string) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  try {
    return new Intl.DateTimeFormat(undefined, {
      timeZone: tz,
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    }).format(d);
  } catch {
    return d.toISOString();
  }
}

export default function FundBatchPage() {
  const router = useRouter();
  const params = useParams<{ batchId: string }>();
  const batchId = (params?.batchId ?? "").toString();

  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [batch, setBatch] = useState<BatchInfo | null>(null);

  const [flights, setFlights] = useState<BatchFlight[]>([]);

  const [amountUsdc, setAmountUsdc] = useState("");

  useEffect(() => {
    let alive = true;

    async function run() {
      if (!batchId) {
        setError("Missing batchId");
        setIsLoading(false);
        return;
      }

      setIsLoading(true);
      setError(null);

      try {
        const res = await fetch(
          `/api/batches/get?batchId=${encodeURIComponent(batchId)}`,
          {
            method: "GET",
            cache: "no-store",
          },
        );

        const json = (await res.json()) as BatchGetResponse;

        if (!res.ok || !json.ok) {
          setError(json.ok ? "Request failed" : json.error);
          setIsLoading(false);
          return;
        }

        if (!alive) return;

        setBatch(json.batch);
        setFlights(Array.isArray(json.flights) ? json.flights : []);
      } catch (e: any) {
        if (!alive) return;
        setError(e?.message ?? "Failed to load batch");
      } finally {
        if (!alive) return;
        setIsLoading(false);
      }
    }

    run();
    return () => {
      alive = false;
    };
  }, [batchId]);

  const tz = useMemo(() => {
    const v = (batch?.display_time_zone ?? "UTC").toString();
    return v || "UTC";
  }, [batch]);

  const canContinue = useMemo(() => {
    const s = amountUsdc.trim();
    if (!s) return false;
    const n = Number(s);
    return Number.isFinite(n) && n > 0;
  }, [amountUsdc]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-zinc-50 font-sans dark:bg-black">
      <main className="w-full max-w-5xl px-6 py-12">
        <div className="rounded-2xl bg-white p-8 shadow-sm dark:bg-zinc-950">
          <div className="flex items-start justify-between gap-6">
            <div className="flex flex-col gap-2">
              <h1 className="text-2xl font-semibold tracking-tight text-zinc-950 dark:text-zinc-50">
                Fund Batch
              </h1>
              <div className="text-sm text-zinc-600 dark:text-zinc-400">
                Batch ID: <span className="font-mono">{batchId}</span>
              </div>
            </div>

            <button
              onClick={() => router.push("/")}
              className="inline-flex h-9 items-center justify-center rounded-full border border-zinc-200 bg-white px-4 text-xs font-medium text-zinc-900 transition hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-50 dark:hover:bg-black"
            >
              Back
            </button>
          </div>

          {error ? (
            <div className="mt-6 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-200">
              <div className="font-medium">Error</div>
              <div className="mt-1">{error}</div>
            </div>
          ) : null}

          <div className="mt-6 grid gap-4 sm:grid-cols-3">
            <div className="rounded-xl border border-zinc-200 p-4 dark:border-zinc-800">
              <div className="text-xs text-zinc-500 dark:text-zinc-400">
                Status
              </div>
              <div className="mt-1 text-sm font-medium text-zinc-900 dark:text-zinc-50">
                {batch?.status ?? (isLoading ? "Loading…" : "—")}
              </div>
            </div>
            <div className="rounded-xl border border-zinc-200 p-4 dark:border-zinc-800">
              <div className="text-xs text-zinc-500 dark:text-zinc-400">
                Flight Count
              </div>
              <div className="mt-1 text-sm font-medium text-zinc-900 dark:text-zinc-50">
                {typeof batch?.flight_count === "number"
                  ? batch.flight_count
                  : isLoading
                    ? "Loading…"
                    : "—"}
              </div>
            </div>
            <div className="rounded-xl border border-zinc-200 p-4 dark:border-zinc-800">
              <div className="text-xs text-zinc-500 dark:text-zinc-400">
                Display Time Zone
              </div>
              <div className="mt-1 text-sm font-medium text-zinc-900 dark:text-zinc-50">
                {tz}
              </div>
            </div>
          </div>

          <div className="mt-8 rounded-2xl border border-zinc-200 p-5 dark:border-zinc-800">
            <div className="flex flex-col gap-2">
              <div className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">
                Funding Amount
              </div>
              <div className="text-xs text-zinc-500 dark:text-zinc-400">
                For now this is off-chain (stored in Supabase later). On-chain
                funding comes next.
              </div>

              <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-center">
                <input
                  value={amountUsdc}
                  onChange={(e) => setAmountUsdc(e.target.value)}
                  inputMode="decimal"
                  placeholder="USDC amount (e.g. 250)"
                  className="h-10 w-full rounded-xl border border-zinc-200 bg-white px-4 text-sm text-zinc-900 outline-none focus:border-zinc-400 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-50 dark:focus:border-zinc-600"
                />

                <button
                  disabled={!canContinue || isLoading}
                  className="inline-flex h-10 items-center justify-center rounded-xl bg-emerald-600 px-5 text-sm font-medium text-white transition hover:bg-emerald-500 disabled:opacity-60"
                >
                  Continue
                </button>
              </div>
            </div>
          </div>

          <div className="mt-8 overflow-hidden rounded-2xl border border-zinc-200 dark:border-zinc-800">
            <div className="flex items-center justify-between border-b border-zinc-200 bg-zinc-50 px-5 py-3 text-xs text-zinc-600 dark:border-zinc-800 dark:bg-black dark:text-zinc-400">
              <div className="font-medium">Flights</div>
              <div>{isLoading ? "Loading…" : `${flights.length}`}</div>
            </div>

            <div className="overflow-auto">
              <table className="min-w-[1000px] text-left text-sm">
                <thead className="bg-white text-xs text-zinc-600 dark:bg-zinc-950 dark:text-zinc-400">
                  <tr>
                    <th className="px-5 py-3 font-medium whitespace-nowrap">
                      Flight
                    </th>
                    <th className="px-5 py-3 font-medium whitespace-nowrap">
                      Route
                    </th>
                    <th className="px-5 py-3 font-medium whitespace-nowrap">
                      Sched Dep
                    </th>
                    <th className="px-5 py-3 font-medium whitespace-nowrap">
                      Sched Arr
                    </th>
                    <th className="px-5 py-3 font-medium whitespace-nowrap">
                      Schedule Key
                    </th>
                  </tr>
                </thead>
                <tbody className="bg-white text-zinc-900 dark:bg-zinc-950 dark:text-zinc-50">
                  {isLoading ? (
                    <tr>
                      <td
                        colSpan={5}
                        className="px-5 py-6 text-zinc-500 dark:text-zinc-400"
                      >
                        Loading…
                      </td>
                    </tr>
                  ) : flights.length === 0 ? (
                    <tr>
                      <td
                        colSpan={5}
                        className="px-5 py-6 text-zinc-500 dark:text-zinc-400"
                      >
                        No flights found for this batch.
                      </td>
                    </tr>
                  ) : (
                    flights.map((f) => (
                      <tr
                        key={f.schedule_key}
                        className="border-t border-zinc-100 dark:border-zinc-900"
                      >
                        <td className="px-5 py-3 font-medium">
                          {f.airline} {f.flight_number}
                        </td>
                        <td className="px-5 py-3">
                          <span className="font-mono text-xs">{f.origin}</span>
                          <span className="mx-2 text-zinc-400">→</span>
                          <span className="font-mono text-xs">
                            {f.destination}
                          </span>
                        </td>
                        <td className="px-5 py-3">
                          {fmtLocal(f.scheduled_depart_iso, tz)}
                        </td>
                        <td className="px-5 py-3">
                          {fmtLocal(f.scheduled_arrive_iso, tz)}
                        </td>
                        <td className="px-5 py-3 font-mono text-xs">
                          {f.schedule_key}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
