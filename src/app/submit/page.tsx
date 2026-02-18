// calibra/src/app/submit/page.tsx
"use client";

import React, { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

type ActiveBatchRow = {
  id: string;
  display_time_zone: string | null;
  flight_count: number | null;
  status: string | null;
  created_at: string | null;
};

type ListActiveBatchesResponse =
  | { ok: true; batches: ActiveBatchRow[] }
  | { ok: false; error: string; details?: unknown };

function fmtDate(s?: string | null) {
  if (!s) return "—";
  const d = new Date(s);
  const ms = d.getTime();
  if (!Number.isFinite(ms)) return "—";
  return d.toLocaleString();
}

export default function SubmitHomePage() {
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [batches, setBatches] = useState<ActiveBatchRow[]>([]);

  async function loadBatches() {
    setLoading(true);
    setError(null);

    try {
      const res = await fetch("/api/batches/list-active?limit=50", {
        method: "GET",
        cache: "no-store",
      });

      const json = (await res.json()) as ListActiveBatchesResponse;

      if (!res.ok || !json.ok) {
        setBatches([]);
        setError(json.ok ? "Request failed" : json.error);
        return;
      }

      setBatches(Array.isArray(json.batches) ? json.batches : []);
    } catch (e: any) {
      setBatches([]);
      setError(e?.message ?? "Failed to load batches");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadBatches();
  }, []);

  function openBatch(batchId: string) {
    router.push(`/submit/${encodeURIComponent(batchId)}`);
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-zinc-50 font-sans dark:bg-black">
      <main className="w-full max-w-3xl px-6 py-12">
        <div className="rounded-2xl bg-white p-8 shadow-sm dark:bg-zinc-950">
          <div className="flex items-start justify-between">
            <div className="flex flex-col gap-2">
              <h1 className="text-2xl font-semibold tracking-tight text-zinc-950 dark:text-zinc-50">
                Model Submission
              </h1>
              <div className="text-sm text-zinc-600 dark:text-zinc-400">
                Select a batch to submit predictions.
              </div>
            </div>

            <button
              onClick={() => router.push("/")}
              className="inline-flex h-9 items-center justify-center rounded-full border border-zinc-200 bg-white px-4 text-xs font-medium text-zinc-900 transition hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-50 dark:hover:bg-black"
            >
              Back
            </button>
          </div>

          <div className="mt-6 flex items-center justify-between">
            <div className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">
              Active batches
            </div>

            <button
              onClick={loadBatches}
              disabled={loading}
              className="inline-flex h-8 items-center justify-center rounded-full border border-zinc-200 bg-white px-3 text-xs font-medium text-zinc-900 transition hover:bg-zinc-50 disabled:opacity-60 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-50 dark:hover:bg-black"
            >
              {loading ? "Loading…" : "Refresh"}
            </button>
          </div>

          {error ? (
            <div className="mt-4 rounded-xl border border-red-200 bg-red-50 p-3 text-xs text-red-700 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-200">
              {error}
            </div>
          ) : null}

          <div className="mt-4 rounded-2xl border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-950">
            {loading ? (
              <div className="text-sm text-zinc-600 dark:text-zinc-400">
                Loading…
              </div>
            ) : batches.length === 0 ? (
              <div className="text-sm text-zinc-600 dark:text-zinc-400">
                No active batches available.
              </div>
            ) : (
              <div className="flex flex-col gap-2">
                {batches.map((b) => (
                  <div
                    key={b.id}
                    className="flex items-center justify-between rounded-lg border border-zinc-200 px-3 py-2 dark:border-zinc-800"
                  >
                    <div className="flex flex-col">
                      <div className="text-sm font-medium text-zinc-900 dark:text-zinc-50">
                        {b.id}
                      </div>
                      <div className="text-[11px] text-zinc-500 dark:text-zinc-400">
                        {b.status ?? "—"} • {b.flight_count ?? 0} flights •{" "}
                        {fmtDate(b.created_at)}
                      </div>
                    </div>

                    <button
                      onClick={() => openBatch(b.id)}
                      className="inline-flex h-8 items-center justify-center rounded-lg bg-indigo-600 px-3 text-xs font-medium text-white transition hover:bg-indigo-500"
                    >
                      Predict
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
