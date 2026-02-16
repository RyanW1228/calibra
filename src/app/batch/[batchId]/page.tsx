// calibra/src/app/batch/[batchId]/page.tsx
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

type PredictionRow = {
  id: string;
  schedule_key: string;
  model: string | null;
  outcome: string | null;
  confidence: number | null;
  created_at: string | null;
};

type PredictionsResponse =
  | { ok: true; predictions: PredictionRow[] }
  | { ok: false; error: string; details?: unknown };

function fmtIsoLocal(s: string | null) {
  if (!s) return "—";
  const d = new Date(s);
  const ms = d.getTime();
  if (!Number.isFinite(ms)) return "—";
  return d.toLocaleString();
}

export default function BatchPage() {
  const router = useRouter();
  const params = useParams<{ batchId: string }>();
  const batchId = (params?.batchId ?? "").toString();

  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [batch, setBatch] = useState<BatchInfo | null>(null);
  const [flights, setFlights] = useState<BatchFlight[]>([]);

  const [predLoading, setPredLoading] = useState(false);
  const [predError, setPredError] = useState<string | null>(null);
  const [predictions, setPredictions] = useState<PredictionRow[]>([]);

  const tz = useMemo(() => {
    const v = (batch?.display_time_zone ?? "UTC").toString();
    return v || "UTC";
  }, [batch]);

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
          { method: "GET", cache: "no-store" },
        );

        const json = (await res.json()) as BatchGetResponse;

        if (!res.ok || !json.ok) {
          if (!alive) return;
          setBatch(null);
          setFlights([]);
          setError(json.ok ? "Request failed" : json.error);
          return;
        }

        if (!alive) return;
        setBatch(json.batch);
        setFlights(Array.isArray(json.flights) ? json.flights : []);
      } catch (e: any) {
        if (!alive) return;
        setBatch(null);
        setFlights([]);
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

  async function loadPredictions() {
    if (!batchId) return;

    setPredLoading(true);
    setPredError(null);

    try {
      const res = await fetch(
        `/api/predictions/list?batchId=${encodeURIComponent(batchId)}`,
        { method: "GET", cache: "no-store" },
      );

      if (res.status === 404) {
        setPredictions([]);
        setPredError("Predictions are not wired yet.");
        return;
      }

      const json = (await res.json()) as PredictionsResponse;

      if (!res.ok || !json.ok) {
        setPredictions([]);
        setPredError(json.ok ? "Request failed" : json.error);
        return;
      }

      setPredictions(Array.isArray(json.predictions) ? json.predictions : []);
    } catch (e: any) {
      setPredictions([]);
      setPredError(e?.message ?? "Failed to load predictions");
    } finally {
      setPredLoading(false);
    }
  }

  useEffect(() => {
    loadPredictions();
  }, [batchId]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-zinc-50 font-sans dark:bg-black">
      <main className="w-full max-w-6xl px-6 py-12">
        <div className="rounded-2xl bg-white p-8 shadow-sm dark:bg-zinc-950">
          <div className="flex items-start justify-between gap-6">
            <div className="flex flex-col gap-2">
              <h1 className="text-2xl font-semibold tracking-tight text-zinc-950 dark:text-zinc-50">
                Batch
              </h1>
              <div className="text-sm text-zinc-600 dark:text-zinc-400">
                Batch ID: <span className="font-mono">{batchId}</span>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={() => router.push("/batches")}
                className="inline-flex h-9 items-center justify-center rounded-full border border-zinc-200 bg-white px-4 text-xs font-medium text-zinc-900 transition hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-50 dark:hover:bg-black"
              >
                Back
              </button>
            </div>
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
            <div className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">
              Flights
            </div>

            <div className="mt-4 overflow-x-auto rounded-xl border border-zinc-200 dark:border-zinc-800">
              <table className="min-w-full text-left text-sm">
                <thead className="bg-zinc-50 text-xs text-zinc-500 dark:bg-zinc-900 dark:text-zinc-400">
                  <tr>
                    <th className="px-4 py-3">Flight</th>
                    <th className="px-4 py-3">Route</th>
                    <th className="px-4 py-3">Scheduled Depart</th>
                    <th className="px-4 py-3">Scheduled Arrive</th>
                    <th className="px-4 py-3">Schedule Key</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
                  {isLoading ? (
                    <tr>
                      <td
                        className="px-4 py-4 text-zinc-600 dark:text-zinc-300"
                        colSpan={5}
                      >
                        Loading…
                      </td>
                    </tr>
                  ) : flights.length === 0 ? (
                    <tr>
                      <td
                        className="px-4 py-4 text-zinc-600 dark:text-zinc-300"
                        colSpan={5}
                      >
                        No flights found.
                      </td>
                    </tr>
                  ) : (
                    flights.map((f) => (
                      <tr key={f.schedule_key}>
                        <td className="px-4 py-3 text-zinc-900 dark:text-zinc-50">
                          {f.airline} {f.flight_number}
                        </td>
                        <td className="px-4 py-3 text-zinc-700 dark:text-zinc-200">
                          {f.origin} → {f.destination}
                        </td>
                        <td className="px-4 py-3 text-zinc-700 dark:text-zinc-200">
                          {fmtIsoLocal(f.scheduled_depart_iso)}
                        </td>
                        <td className="px-4 py-3 text-zinc-700 dark:text-zinc-200">
                          {fmtIsoLocal(f.scheduled_arrive_iso)}
                        </td>
                        <td className="px-4 py-3 font-mono text-xs text-zinc-600 dark:text-zinc-300">
                          {f.schedule_key}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>

          <div className="mt-8 rounded-2xl border border-zinc-200 p-5 dark:border-zinc-800">
            <div className="flex items-center justify-between gap-3">
              <div className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">
                Predictions
              </div>

              <button
                onClick={loadPredictions}
                disabled={predLoading}
                className="inline-flex h-8 items-center justify-center rounded-lg border border-zinc-200 bg-white px-3 text-xs font-medium text-zinc-900 transition hover:bg-zinc-50 disabled:opacity-60 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-50 dark:hover:bg-black"
              >
                {predLoading ? "Loading…" : "Refresh"}
              </button>
            </div>

            {predError ? (
              <div className="mt-4 rounded-xl border border-zinc-200 bg-white p-4 text-sm text-zinc-700 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-200">
                {predError}
              </div>
            ) : null}

            <div className="mt-4 overflow-x-auto rounded-xl border border-zinc-200 dark:border-zinc-800">
              <table className="min-w-full text-left text-sm">
                <thead className="bg-zinc-50 text-xs text-zinc-500 dark:bg-zinc-900 dark:text-zinc-400">
                  <tr>
                    <th className="px-4 py-3">Schedule Key</th>
                    <th className="px-4 py-3">Model</th>
                    <th className="px-4 py-3">Outcome</th>
                    <th className="px-4 py-3">Confidence</th>
                    <th className="px-4 py-3">Created</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
                  {predLoading ? (
                    <tr>
                      <td
                        className="px-4 py-4 text-zinc-600 dark:text-zinc-300"
                        colSpan={5}
                      >
                        Loading…
                      </td>
                    </tr>
                  ) : predictions.length === 0 ? (
                    <tr>
                      <td
                        className="px-4 py-4 text-zinc-600 dark:text-zinc-300"
                        colSpan={5}
                      >
                        No predictions yet.
                      </td>
                    </tr>
                  ) : (
                    predictions.map((p) => (
                      <tr key={p.id}>
                        <td className="px-4 py-3 font-mono text-xs text-zinc-600 dark:text-zinc-300">
                          {p.schedule_key}
                        </td>
                        <td className="px-4 py-3 text-zinc-700 dark:text-zinc-200">
                          {p.model ?? "—"}
                        </td>
                        <td className="px-4 py-3 text-zinc-700 dark:text-zinc-200">
                          {p.outcome ?? "—"}
                        </td>
                        <td className="px-4 py-3 text-zinc-700 dark:text-zinc-200">
                          {typeof p.confidence === "number"
                            ? p.confidence.toFixed(3)
                            : "—"}
                        </td>
                        <td className="px-4 py-3 text-zinc-700 dark:text-zinc-200">
                          {fmtIsoLocal(p.created_at)}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>

            <div className="mt-3 text-xs text-zinc-500 dark:text-zinc-400">
              This page loads predictions from{" "}
              <span className="font-mono">/api/predictions/list</span>.
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
