// calibra/src/app/batch/[batchId]/page.tsx
"use client";

import React, { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import BatchFlightsTable, {
  type BatchFlightRow,
  type BatchPredictionRow,
} from "./components/BatchFlightsTable";

type BatchGetResponse =
  | {
      ok: true;
      batch: {
        id: string;
        display_time_zone: string;
        flight_count: number;
        status: string;
        created_at: string;
        prediction_window_start_at?: string | null;
        prediction_window_end_at?: string | null;
      };
      flights: BatchFlightRow[];
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

  probabilities?: Record<string, number> | null;
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

function fmtIsoInTimeZone(iso: string | null | undefined, timeZone: string) {
  if (!iso) return "—";
  const d = new Date(iso);
  const ms = d.getTime();
  if (!Number.isFinite(ms)) return "—";
  try {
    return new Intl.DateTimeFormat(undefined, {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    }).format(d);
  } catch {
    return d.toLocaleString();
  }
}

function clampNonNeg(ms: number) {
  return ms < 0 ? 0 : ms;
}

function fmtCountdown(ms: number) {
  const t = Math.floor(clampNonNeg(ms) / 1000);
  const hh = Math.floor(t / 3600);
  const mm = Math.floor((t % 3600) / 60);
  const ss = t % 60;
  const pad = (x: number) => String(x).padStart(2, "0");
  return `${pad(hh)}:${pad(mm)}:${pad(ss)}`;
}

export default function BatchPage() {
  const router = useRouter();
  const params = useParams<{ batchId: string }>();
  const batchId = (params?.batchId ?? "").toString();

  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [batch, setBatch] = useState<BatchInfo | null>(null);
  const [flights, setFlights] = useState<BatchFlightRow[]>([]);

  const [predLoading, setPredLoading] = useState(false);
  const [predError, setPredError] = useState<string | null>(null);
  const [predictions, setPredictions] = useState<PredictionRow[]>([]);

  const tz = useMemo(() => {
    const v = (batch?.display_time_zone ?? "UTC").toString();
    return v || "UTC";
  }, [batch]);

  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNowMs(Date.now()), 250);
    return () => window.clearInterval(id);
  }, []);

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
          `/api/batches/get-enriched?batchId=${encodeURIComponent(batchId)}`,
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

  const predictionRows = useMemo(() => {
    return predictions.map((p) => ({
      schedule_key: p.schedule_key,
      outcome: p.outcome,
      confidence: p.confidence,
      created_at: p.created_at,
      probabilities: p.probabilities ?? null,
    })) satisfies BatchPredictionRow[];
  }, [predictions]);

  const predictionColumns = useMemo(() => {
    const s = new Set<string>();
    for (const p of predictions) {
      const probs = p.probabilities;
      if (!probs || typeof probs !== "object") continue;
      for (const k of Object.keys(probs)) {
        const key = k.trim();
        if (key) s.add(key);
      }
    }
    return Array.from(s);
  }, [predictions]);

  const windowStartIso = batch?.prediction_window_start_at ?? null;
  const windowEndIso = batch?.prediction_window_end_at ?? null;

  const windowState = useMemo(() => {
    const startMs = windowStartIso ? new Date(windowStartIso).getTime() : NaN;
    const endMs = windowEndIso ? new Date(windowEndIso).getTime() : NaN;

    const startOk = Number.isFinite(startMs);
    const endOk = Number.isFinite(endMs);

    if (!startOk || !endOk) {
      return {
        label: "Not Available",
        badgeClass:
          "border-zinc-200 bg-white text-zinc-700 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-200",
        countdownLabel: null as string | null,
        countdownValue: null as string | null,
      };
    }

    if (nowMs < startMs) {
      return {
        label: "Not Started",
        badgeClass:
          "border-zinc-200 bg-white text-zinc-700 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-200",
        countdownLabel: "Starts In",
        countdownValue: fmtCountdown(startMs - nowMs),
      };
    }

    if (nowMs >= startMs && nowMs < endMs) {
      return {
        label: "Open",
        badgeClass:
          "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900/50 dark:bg-emerald-950/30 dark:text-emerald-200",
        countdownLabel: "Closes In",
        countdownValue: fmtCountdown(endMs - nowMs),
      };
    }

    return {
      label: "Closed",
      badgeClass:
        "border-red-200 bg-red-50 text-red-800 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-emerald-200",
      countdownLabel: "Closed",
      countdownValue: "00:00:00",
    };
  }, [nowMs, windowStartIso, windowEndIso]);

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

              <button
                onClick={loadPredictions}
                disabled={predLoading}
                className="inline-flex h-9 items-center justify-center rounded-full border border-zinc-200 bg-white px-4 text-xs font-medium text-zinc-900 transition hover:bg-zinc-50 disabled:opacity-60 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-50 dark:hover:bg-black"
              >
                {predLoading ? "Loading…" : "Refresh Predictions"}
              </button>
            </div>
          </div>

          {error ? (
            <div className="mt-6 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-200">
              <div className="font-medium">Error</div>
              <div className="mt-1">{error}</div>
            </div>
          ) : null}

          {predError ? (
            <div className="mt-6 rounded-xl border border-zinc-200 bg-white p-4 text-sm text-zinc-700 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-200">
              {predError}
            </div>
          ) : null}

          <div className="mt-6 grid gap-4 sm:grid-cols-4">
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

            <div className="rounded-xl border border-zinc-200 p-4 dark:border-zinc-800">
              <div className="flex items-center justify-between gap-3">
                <div className="text-xs text-zinc-500 dark:text-zinc-400">
                  Prediction Window
                </div>
                <div
                  className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium ${windowState.badgeClass}`}
                >
                  {windowState.label}
                </div>
              </div>

              <div className="mt-2 flex flex-col gap-1">
                <div className="text-[11px] text-zinc-500 dark:text-zinc-400">
                  Start:{" "}
                  <span className="font-mono text-zinc-700 dark:text-zinc-200">
                    {fmtIsoInTimeZone(windowStartIso, tz)}
                  </span>
                </div>
                <div className="text-[11px] text-zinc-500 dark:text-zinc-400">
                  End:{" "}
                  <span className="font-mono text-zinc-700 dark:text-zinc-200">
                    {fmtIsoInTimeZone(windowEndIso, tz)}
                  </span>
                </div>

                {windowState.countdownLabel && windowState.countdownValue ? (
                  <div className="mt-2 flex items-center justify-between">
                    <div className="text-xs text-zinc-600 dark:text-zinc-300">
                      {windowState.countdownLabel}
                    </div>
                    <div className="font-mono text-sm font-semibold text-zinc-900 dark:text-zinc-50">
                      {windowState.countdownValue}
                    </div>
                  </div>
                ) : null}
              </div>
            </div>
          </div>

          <div className="mt-8 rounded-2xl border border-zinc-200 p-5 dark:border-zinc-800">
            <div className="flex items-center justify-between gap-3">
              <div className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">
                Flights + Predictions
              </div>

              <div className="text-xs text-zinc-500 dark:text-zinc-400">
                Created:{" "}
                <span className="font-mono">
                  {fmtIsoLocal(batch?.created_at ?? null)}
                </span>
              </div>
            </div>

            <BatchFlightsTable
              flights={flights}
              predictions={predictionRows}
              isLoading={isLoading}
              displayTimeZone={tz}
              predictionColumns={predictionColumns}
            />
          </div>
        </div>
      </main>
    </div>
  );
}
