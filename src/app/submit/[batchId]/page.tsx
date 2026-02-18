// calibra/src/app/submit/[batchId]/page.tsx
"use client";

import React, { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import PredictionsTable from "./components/PredictionsTable";

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
        thresholds_minutes?: number[] | null;
      };
      flights: BatchFlight[];
    }
  | { ok: false; error: string; details?: unknown };

type BatchInfo = Extract<BatchGetResponse, { ok: true }>["batch"];

export default function SubmitBatchPage() {
  const router = useRouter();
  const params = useParams<{ batchId: string }>();
  const batchId = (params?.batchId ?? "").toString();

  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [batch, setBatch] = useState<BatchInfo | null>(null);
  const [flights, setFlights] = useState<BatchFlight[]>([]);

  const [predByScheduleKey, setPredByScheduleKey] = useState<
    Record<string, Record<string, string>>
  >({});

  const [uiError, setUiError] = useState<string | null>(null);
  const [uiOk, setUiOk] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

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
          `/api/batches/get-enriched?batchId=${encodeURIComponent(batchId)}`,
          { method: "GET", cache: "no-store" },
        );

        const json = (await res.json()) as BatchGetResponse;

        if (!res.ok || !json.ok) {
          setError(json.ok ? "Request failed" : json.error);
          setIsLoading(false);
          return;
        }

        if (!alive) return;

        setBatch(json.batch);

        const fs = Array.isArray(json.flights) ? json.flights : [];
        setFlights(fs);

        setPredByScheduleKey((prev) => {
          const next: Record<string, Record<string, string>> = { ...prev };
          for (const f of fs) {
            const key = (f.schedule_key ?? "").trim();
            if (!key) continue;
            if (!next[key]) next[key] = {};
          }
          return next;
        });
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

  async function onSubmit() {
    setUiError(null);
    setUiOk(null);

    if (flights.length === 0) {
      setUiError("No flights to predict for this batch");
      return;
    }

    const payload: {
      schedule_key: string;
      probabilities: Record<string, number>;
    }[] = [];

    for (const f of flights) {
      const key = (f.schedule_key ?? "").trim();
      if (!key) continue;

      const row = predByScheduleKey[key] ?? {};
      const probs: Record<string, number> = {};

      for (const [label, raw0] of Object.entries(row)) {
        const raw = (raw0 ?? "").trim();
        if (!raw) continue;

        const x = Number(raw);
        if (!Number.isFinite(x) || x < 0 || x > 100) {
          setUiError(`Invalid probability for ${key} (${label}). Use 0–100.`);
          return;
        }

        probs[label] = Math.round(x * 100) / 100;
      }

      if (Object.keys(probs).length === 0) continue;

      payload.push({
        schedule_key: key,
        probabilities: probs,
      });
    }

    if (payload.length === 0) {
      setUiError("Enter at least one prediction to submit");
      return;
    }

    try {
      setIsSubmitting(true);

      setUiOk(
        `Ready to submit ${payload.length} prediction${
          payload.length === 1 ? "" : "s"
        }. Next step: wire this to Canton.`,
      );
    } catch (e: any) {
      setUiError(e?.message ?? "Submit failed");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-zinc-50 font-sans dark:bg-black">
      <main className="w-full max-w-5xl px-6 py-12">
        <div className="rounded-2xl bg-white p-8 shadow-sm dark:bg-zinc-950">
          <div className="flex items-start justify-between gap-6">
            <div className="flex flex-col gap-2">
              <h1 className="text-2xl font-semibold tracking-tight text-zinc-950 dark:text-zinc-50">
                Submit Predictions
              </h1>
              <div className="text-sm text-zinc-600 dark:text-zinc-400">
                Batch ID: <span className="font-mono">{batchId}</span>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={() => router.push("/submit")}
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

          {uiError ? (
            <div className="mt-6 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-200">
              <div className="font-medium">Submission Error</div>
              <div className="mt-1 break-words">{uiError}</div>
            </div>
          ) : null}

          {uiOk ? (
            <div className="mt-6 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800 dark:border-emerald-900/50 dark:bg-emerald-950/30 dark:text-emerald-200">
              <div className="font-medium">Ready</div>
              <div className="mt-1 break-words">{uiOk}</div>
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

          <PredictionsTable
            flights={flights}
            isLoading={isLoading}
            thresholdsMinutes={batch?.thresholds_minutes ?? null}
            predByScheduleKey={predByScheduleKey}
            setPredByScheduleKey={setPredByScheduleKey}
            onSubmit={onSubmit}
            isSubmitting={isSubmitting}
          />
        </div>
      </main>
    </div>
  );
}
