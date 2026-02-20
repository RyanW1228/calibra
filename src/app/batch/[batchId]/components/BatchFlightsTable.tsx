// calibra/src/app/batch/[batchId]/components/BatchFlightsTable.tsx
"use client";

import React, { useMemo } from "react";

export type BatchFlightRow = {
  schedule_key: string;
  airline: string;
  flight_number: string;
  origin: string;
  destination: string;
  scheduled_depart_iso: string | null;
  scheduled_arrive_iso: string | null;

  actual_depart_iso?: string | null;
  expected_arrive_iso?: string | null;
  actual_arrive_iso?: string | null;

  status?: string | null;

  departure_delay_min?: number | null;
  arrival_delay_min?: number | null;
};

export type BatchPredictionRow = {
  schedule_key: string;

  provider_address?: string | null;

  outcome?: string | null;
  confidence?: number | null;
  created_at?: string | null;

  probabilities?: Record<string, number> | null;
};

type Props = {
  flights: BatchFlightRow[];
  predictions: BatchPredictionRow[];
  isLoading: boolean;
  displayTimeZone: string;
  fallbackStatus?: string | null;

  predictionColumns?: string[];

  onUpdate?: () => void;
  updateDisabled?: boolean;
  updateLabel?: string;
  updateMetaText?: string | null;
};

function formatTime(iso: string | null | undefined, timeZone: string) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;

  try {
    return new Intl.DateTimeFormat(undefined, {
      timeZone,
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    }).format(d);
  } catch {
    return d.toISOString();
  }
}

function diffMinutes(aISO?: string | null, bISO?: string | null) {
  if (!aISO || !bISO) return undefined;
  const a = new Date(aISO).getTime();
  const b = new Date(bISO).getTime();
  if (Number.isNaN(a) || Number.isNaN(b)) return undefined;
  return Math.round((a - b) / 60000);
}

function fmtMin(n?: number | null) {
  if (n === undefined || n === null) return "—";
  const sign = n > 0 ? "+" : "";
  return `${sign}${n}m`;
}

function pickLatestPrediction(
  a: BatchPredictionRow | undefined,
  b: BatchPredictionRow,
) {
  if (!a) return b;
  const aMs = a.created_at ? new Date(a.created_at).getTime() : -1;
  const bMs = b.created_at ? new Date(b.created_at).getTime() : -1;
  if (!Number.isFinite(aMs) && !Number.isFinite(bMs)) return a;
  if (!Number.isFinite(aMs)) return b;
  if (!Number.isFinite(bMs)) return a;
  return bMs >= aMs ? b : a;
}

function pctOrDash(v: unknown) {
  if (typeof v !== "number" || !Number.isFinite(v)) return "—";
  const p = Math.max(0, Math.min(1, v)) * 100;
  return `${p.toFixed(1)}%`;
}

export default function BatchFlightsTable({
  flights,
  predictions,
  isLoading,
  displayTimeZone,
  fallbackStatus,
  predictionColumns,
  onUpdate,
  updateDisabled,
  updateLabel,
  updateMetaText,
}: Props) {
  const predictionByScheduleKey = useMemo(() => {
    const m = new Map<string, BatchPredictionRow>();
    for (const p of predictions) {
      const key = (p.schedule_key ?? "").trim();
      if (!key) continue;
      m.set(key, pickLatestPrediction(m.get(key), p));
    }
    return m;
  }, [predictions]);

  const normalizedPredictionColumns = useMemo(() => {
    const cols = Array.isArray(predictionColumns) ? predictionColumns : [];
    return cols
      .map((c) => (typeof c === "string" ? c.trim() : ""))
      .filter((c) => c.length > 0);
  }, [predictionColumns]);

  const showUpdate = typeof onUpdate === "function";

  return (
    <div className="mt-6 overflow-hidden rounded-xl border border-zinc-200 dark:border-zinc-800">
      {showUpdate ? (
        <div className="flex items-center justify-between gap-3 border-b border-zinc-200 bg-white px-3 py-2 dark:border-zinc-800 dark:bg-zinc-950">
          <div className="text-xs text-zinc-600 dark:text-zinc-400">
            {updateMetaText ? updateMetaText : " "}
          </div>

          <button
            onClick={onUpdate}
            disabled={Boolean(updateDisabled)}
            className="inline-flex h-8 items-center justify-center rounded-full border border-zinc-200 bg-white px-3 text-xs font-medium text-zinc-900 transition hover:bg-zinc-50 disabled:opacity-60 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-50 dark:hover:bg-black"
          >
            {updateLabel ? updateLabel : "Update"}
          </button>
        </div>
      ) : null}

      <div className="overflow-auto">
        <table className="min-w-[2000px] text-left text-sm">
          <thead className="sticky top-0 z-10 bg-zinc-50 text-xs text-zinc-600 dark:bg-black dark:text-zinc-400">
            <tr>
              <th className="px-3 py-2 font-medium whitespace-nowrap">
                Schedule Key
              </th>
              <th className="px-3 py-2 font-medium whitespace-nowrap">
                Airline
              </th>
              <th className="px-3 py-2 font-medium whitespace-nowrap">
                Flight
              </th>
              <th className="px-3 py-2 font-medium whitespace-nowrap">Route</th>

              <th className="px-3 py-2 font-medium whitespace-nowrap">
                Sched Dep
              </th>
              <th className="px-3 py-2 font-medium whitespace-nowrap">
                Act Dep
              </th>
              <th className="px-3 py-2 font-medium whitespace-nowrap">Dep Δ</th>

              <th className="px-3 py-2 font-medium whitespace-nowrap">
                Sched Arr
              </th>
              <th className="px-3 py-2 font-medium whitespace-nowrap">
                Exp Arr
              </th>
              <th className="px-3 py-2 font-medium whitespace-nowrap">Exp Δ</th>

              <th className="px-3 py-2 font-medium whitespace-nowrap">
                Act Arr
              </th>
              <th className="px-3 py-2 font-medium whitespace-nowrap">Act Δ</th>

              <th className="px-3 py-2 font-medium whitespace-nowrap">
                Status
              </th>
            </tr>
          </thead>

          <tbody className="bg-white text-zinc-900 dark:bg-zinc-950 dark:text-zinc-50">
            {isLoading ? (
              <tr>
                <td
                  colSpan={13}
                  className="px-3 py-6 text-zinc-500 dark:text-zinc-400"
                >
                  Loading…
                </td>
              </tr>
            ) : flights.length === 0 ? (
              <tr>
                <td
                  colSpan={
                    normalizedPredictionColumns.length > 0
                      ? 12 + normalizedPredictionColumns.length
                      : 13
                  }
                  className="px-3 py-6 text-zinc-500 dark:text-zinc-400"
                >
                  No flights found.
                </td>
              </tr>
            ) : (
              flights.map((f) => {
                const p = predictionByScheduleKey.get(f.schedule_key);

                const depDeltaMin =
                  f.departure_delay_min ??
                  diffMinutes(f.actual_depart_iso, f.scheduled_depart_iso);

                const hasArrived = Boolean(f.actual_arrive_iso);
                const expArrISO = hasArrived
                  ? f.actual_arrive_iso
                  : (f.expected_arrive_iso ?? f.scheduled_arrive_iso);

                const actArrDeltaMin = hasArrived
                  ? (f.arrival_delay_min ??
                    diffMinutes(f.actual_arrive_iso, f.scheduled_arrive_iso))
                  : undefined;

                const expArrDeltaMin = hasArrived
                  ? actArrDeltaMin
                  : (f.arrival_delay_min ??
                    diffMinutes(expArrISO, f.scheduled_arrive_iso));

                const statusText =
                  (f.status ?? "").trim() ||
                  (fallbackStatus ?? "").trim() ||
                  "—";

                return (
                  <tr
                    key={f.schedule_key}
                    className="border-t border-zinc-100 dark:border-zinc-900"
                  >
                    <td className="px-3 py-2 font-mono text-xs">
                      {f.schedule_key}
                    </td>
                    <td className="px-3 py-2 font-medium">{f.airline}</td>
                    <td className="px-3 py-2">{f.flight_number}</td>
                    <td className="px-3 py-2">
                      <span className="font-mono text-xs">{f.origin}</span>
                      <span className="mx-2 text-zinc-400">→</span>
                      <span className="font-mono text-xs">{f.destination}</span>
                    </td>
                    <td className="px-3 py-2">
                      {formatTime(f.scheduled_depart_iso, displayTimeZone)}
                    </td>
                    <td className="px-3 py-2">
                      {formatTime(f.actual_depart_iso ?? null, displayTimeZone)}
                    </td>
                    <td className="px-3 py-2 font-mono text-xs">
                      {fmtMin(depDeltaMin)}
                    </td>
                    <td className="px-3 py-2">
                      {formatTime(f.scheduled_arrive_iso, displayTimeZone)}
                    </td>
                    <td className="px-3 py-2">
                      {formatTime(expArrISO, displayTimeZone)}
                    </td>
                    <td className="px-3 py-2 font-mono text-xs">
                      {fmtMin(expArrDeltaMin)}
                    </td>
                    <td className="px-3 py-2">
                      {formatTime(f.actual_arrive_iso ?? null, displayTimeZone)}
                    </td>
                    <td className="px-3 py-2 font-mono text-xs">
                      {fmtMin(actArrDeltaMin)}
                    </td>
                    <td className="px-3 py-2">{statusText}</td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
