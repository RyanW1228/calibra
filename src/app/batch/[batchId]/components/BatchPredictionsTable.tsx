// calibra/src/app/batch/[batchId]/components/BatchPredictionsTable.tsx
"use client";

import React, { useMemo } from "react";
import type { BatchFlightRow, BatchPredictionRow } from "./BatchFlightsTable";

type Props = {
  flights: BatchFlightRow[];
  predictions: BatchPredictionRow[];
  isLoading: boolean;
  thresholdsMinutes: number[] | null | undefined;
};

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

  // Accept either 0–1 (fraction) or 0–100 (percent)
  const percent = v <= 1 ? v * 100 : v;
  const p = Math.max(0, Math.min(100, percent));

  return `${p.toFixed(1)}%`;
}

function buildPartitionLabels(thresholdsMinutes: number[] | null | undefined) {
  const raw = Array.isArray(thresholdsMinutes) ? thresholdsMinutes : [];
  const cleaned = raw
    .map((x) =>
      typeof x === "number" && Number.isFinite(x) ? Math.floor(x) : NaN,
    )
    .filter((x) => Number.isFinite(x) && x >= 0);

  const t = Array.from(new Set(cleaned)).sort((a, b) => a - b);

  const labels: string[] = [];
  if (t.length === 0) {
    labels.push("Cancelled");
    return labels;
  }

  labels.push(`<=${t[0]} min`);

  for (let i = 1; i < t.length; i += 1) {
    labels.push(`>${t[i - 1]} and <=${t[i]} min`);
  }

  labels.push(`>${t[t.length - 1]} min`);
  labels.push("Cancelled");
  return labels;
}

function pickProb(
  probs: Record<string, number> | null | undefined,
  label: string,
) {
  if (!probs || typeof probs !== "object") return null;

  const candidates = [
    label,
    label.trim(),
    label.replace(/\s+min$/i, "").trim(),
    label.replace(/\s+/g, " ").trim(),
    label.replace(/\s+/g, "").trim(),
  ];

  // Also tolerate Cancelled spelling
  if (label === "Cancelled") {
    candidates.push("Canceled", "CANCELLED", "CANCELED");
  }

  for (const k of candidates) {
    if (Object.prototype.hasOwnProperty.call(probs, k)) {
      const v = (probs as any)[k];
      return typeof v === "number" && Number.isFinite(v) ? v : null;
    }
  }

  return null;
}

export default function BatchPredictionsTable({
  flights,
  predictions,
  isLoading,
  thresholdsMinutes,
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

  const columns = useMemo(() => {
    return buildPartitionLabels(thresholdsMinutes);
  }, [thresholdsMinutes]);

  const colCount = 1 + columns.length;

  return (
    <div className="mt-6 overflow-auto rounded-xl border border-zinc-200 dark:border-zinc-800">
      <table className="min-w-[900px] text-left text-sm">
        <thead className="sticky top-0 z-10 bg-zinc-50 text-xs text-zinc-600 dark:bg-black dark:text-zinc-400">
          <tr>
            <th className="px-3 py-2 font-medium whitespace-nowrap">
              Schedule Key
            </th>
            {columns.map((label) => (
              <th
                key={label}
                className="px-3 py-2 font-medium whitespace-nowrap text-right"
                title={label}
              >
                {label}
              </th>
            ))}
          </tr>
        </thead>

        <tbody className="bg-white text-zinc-900 dark:bg-zinc-950 dark:text-zinc-50">
          {isLoading ? (
            <tr>
              <td
                colSpan={colCount}
                className="px-3 py-6 text-zinc-500 dark:text-zinc-400"
              >
                Loading…
              </td>
            </tr>
          ) : flights.length === 0 ? (
            <tr>
              <td
                colSpan={colCount}
                className="px-3 py-6 text-zinc-500 dark:text-zinc-400"
              >
                No flights found.
              </td>
            </tr>
          ) : (
            flights.map((f) => {
              const key = (f.schedule_key ?? "").trim();
              const p = key ? predictionByScheduleKey.get(key) : undefined;

              return (
                <tr
                  key={f.schedule_key}
                  className="border-t border-zinc-100 dark:border-zinc-900"
                >
                  <td className="px-3 py-2 font-mono text-xs">{key || "—"}</td>

                  {columns.map((label) => {
                    const v = pickProb(p?.probabilities ?? null, label);
                    return (
                      <td
                        key={label}
                        className="px-3 py-2 text-right font-mono text-xs"
                      >
                        {pctOrDash(v)}
                      </td>
                    );
                  })}
                </tr>
              );
            })
          )}
        </tbody>
      </table>
    </div>
  );
}
