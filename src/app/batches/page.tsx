// calibra/src/app/batches/page.tsx
"use client";

import React, { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

type BatchRow = {
  id: string;
  display_time_zone: string | null;
  flight_count: number | null;
  status: string | null;
  created_at: string | null;
};

type Resp =
  | { ok: true; batches: BatchRow[] }
  | { ok: false; error: string; details?: unknown };

function fmtDate(s?: string | null) {
  if (!s) return "—";
  const d = new Date(s);
  const ms = d.getTime();
  if (!Number.isFinite(ms)) return "—";
  return d.toLocaleString();
}

export default function BatchesPage() {
  const router = useRouter();

  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [batches, setBatches] = useState<BatchRow[]>([]);

  async function load() {
    setIsLoading(true);
    setError(null);

    try {
      const res = await fetch("/api/batches/list-active?limit=100", {
        method: "GET",
        cache: "no-store",
      });

      const json = (await res.json()) as Resp;

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
      setIsLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  return (
    <div className="flex min-h-screen items-center justify-center bg-zinc-50 font-sans dark:bg-black">
      <main className="w-full max-w-3xl px-6 py-12">
        <div className="rounded-2xl bg-white p-8 shadow-sm dark:bg-zinc-950">
          <div className="flex items-start justify-between gap-6">
            <div className="flex flex-col gap-2">
              <h1 className="text-2xl font-semibold tracking-tight text-zinc-950 dark:text-zinc-50">
                Batches
              </h1>
              <div className="text-sm text-zinc-600 dark:text-zinc-400">
                All created batches (most recent first).
              </div>
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={() => router.push("/")}
                className="inline-flex h-9 items-center justify-center rounded-full border border-zinc-200 bg-white px-4 text-xs font-medium text-zinc-900 transition hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-50 dark:hover:bg-black"
              >
                Back
              </button>

              <button
                onClick={load}
                disabled={isLoading}
                className="inline-flex h-9 items-center justify-center rounded-full border border-zinc-200 bg-white px-4 text-xs font-medium text-zinc-900 transition hover:bg-zinc-50 disabled:opacity-60 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-50 dark:hover:bg-black"
              >
                {isLoading ? "Loading…" : "Refresh"}
              </button>
            </div>
          </div>

          {error ? (
            <div className="mt-6 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-200">
              <div className="font-medium">Error</div>
              <div className="mt-1">{error}</div>
            </div>
          ) : null}

          <div className="mt-6 rounded-2xl border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-950">
            {isLoading ? (
              <div className="text-sm text-zinc-600 dark:text-zinc-400">
                Loading…
              </div>
            ) : batches.length === 0 ? (
              <div className="text-sm text-zinc-600 dark:text-zinc-400">
                No batches found.
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
                      onClick={() =>
                        router.push(`/batch/${encodeURIComponent(b.id)}`)
                      }
                      className="inline-flex h-8 items-center justify-center rounded-lg bg-emerald-600 px-3 text-xs font-medium text-white transition hover:bg-emerald-500"
                    >
                      Open
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
