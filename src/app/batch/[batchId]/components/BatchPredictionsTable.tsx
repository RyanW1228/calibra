// calibra/src/app/batch/[batchId]/components/BatchPredictionsTable.tsx
"use client";

import React, { useMemo, useState } from "react";
import type { BatchFlightRow, BatchPredictionRow } from "./BatchFlightsTable";

type Props = {
  flights: BatchFlightRow[];
  predictions: BatchPredictionRow[];
  isLoading: boolean;
  thresholdsMinutes: number[] | null | undefined;

  refreshMetaText?: string;
  refreshDisabled?: boolean;
  refreshLabel?: string;
  onRefresh?: () => void;
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
  const p = Math.max(0, Math.min(100, v));
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

function fmtIso(s: string | null | undefined) {
  if (!s) return "—";
  const d = new Date(s);
  const ms = d.getTime();
  if (!Number.isFinite(ms)) return "—";
  return d.toLocaleString();
}

function rowProviderAddress(p: BatchPredictionRow) {
  const anyP = p as any;
  const v = (anyP?.providerAddress ??
    anyP?.provider_address ??
    anyP?.provider ??
    null) as string | null;
  return typeof v === "string" && v.trim() ? v.trim().toLowerCase() : "—";
}

function rowOutcome(p: BatchPredictionRow) {
  const anyP = p as any;
  const v = anyP?.outcome as unknown;
  return typeof v === "string" && v.trim() ? v.trim() : "—";
}

function rowConfidence(p: BatchPredictionRow) {
  const anyP = p as any;
  const v = anyP?.confidence as unknown;
  if (typeof v !== "number" || !Number.isFinite(v)) return "—";
  const clamped = Math.max(0, Math.min(1, v));
  return clamped.toFixed(4);
}

function sortNewestFirst(a: BatchPredictionRow, b: BatchPredictionRow) {
  const aMs = a.created_at ? new Date(a.created_at).getTime() : -1;
  const bMs = b.created_at ? new Date(b.created_at).getTime() : -1;
  if (!Number.isFinite(aMs) && !Number.isFinite(bMs)) return 0;
  if (!Number.isFinite(aMs)) return 1;
  if (!Number.isFinite(bMs)) return -1;
  return bMs - aMs;
}

export default function BatchPredictionsTable({
  flights,
  predictions,
  isLoading,
  thresholdsMinutes,
  refreshMetaText,
  refreshDisabled,
  refreshLabel,
  onRefresh,
}: Props) {
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  const predictionsByScheduleKey = useMemo(() => {
    const m = new Map<string, BatchPredictionRow[]>();
    for (const p of predictions) {
      const key = (p.schedule_key ?? "").trim();
      if (!key) continue;
      const arr = m.get(key) ?? [];
      arr.push(p);
      m.set(key, arr);
    }

    for (const [k, arr] of m.entries()) {
      m.set(k, [...arr].sort(sortNewestFirst));
    }

    return m;
  }, [predictions]);

  const latestByScheduleKey = useMemo(() => {
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

  const showRefresh = typeof onRefresh === "function";

  const flightKeys = useMemo(() => {
    return flights.map((f) => (f.schedule_key ?? "").trim()).filter((k) => !!k);
  }, [flights]);

  function toggleKey(key: string) {
    setExpanded((prev) => ({ ...prev, [key]: !prev[key] }));
  }

  function expandAll() {
    const next: Record<string, boolean> = {};
    for (const k of flightKeys) next[k] = true;
    setExpanded(next);
  }

  function collapseAll() {
    setExpanded({});
  }

  return (
    <div className="mt-6 overflow-hidden rounded-xl border border-zinc-200 dark:border-zinc-800">
      {showRefresh ? (
        <div className="flex items-center justify-between gap-3 border-b border-zinc-200 bg-white px-3 py-2 dark:border-zinc-800 dark:bg-zinc-950">
          <div className="text-xs text-zinc-600 dark:text-zinc-400">
            {refreshMetaText ? refreshMetaText : " "}
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={expandAll}
              disabled={isLoading || flightKeys.length === 0}
              className="inline-flex h-8 items-center justify-center rounded-full border border-zinc-200 bg-white px-3 text-xs font-medium text-zinc-900 transition hover:bg-zinc-50 disabled:opacity-60 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-50 dark:hover:bg-black"
            >
              Expand All
            </button>

            <button
              onClick={collapseAll}
              disabled={isLoading || flightKeys.length === 0}
              className="inline-flex h-8 items-center justify-center rounded-full border border-zinc-200 bg-white px-3 text-xs font-medium text-zinc-900 transition hover:bg-zinc-50 disabled:opacity-60 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-50 dark:hover:bg-black"
            >
              Collapse All
            </button>

            <button
              onClick={onRefresh}
              disabled={!!refreshDisabled}
              className="inline-flex h-8 items-center justify-center rounded-full border border-zinc-200 bg-white px-3 text-xs font-medium text-zinc-900 transition hover:bg-zinc-50 disabled:opacity-60 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-50 dark:hover:bg-black"
            >
              {refreshLabel ?? "Refresh Submissions"}
            </button>
          </div>
        </div>
      ) : null}

      <div className="overflow-auto">
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
              flights.flatMap((f) => {
                const key = (f.schedule_key ?? "").trim();
                const p = key ? latestByScheduleKey.get(key) : undefined;
                const isOpen = !!(key && expanded[key]);

                const summaryRow = (
                  <tr
                    key={`row:${f.schedule_key}`}
                    className="border-t border-zinc-100 dark:border-zinc-900"
                  >
                    <td className="px-3 py-2 font-mono text-xs">
                      {key ? (
                        <button
                          type="button"
                          onClick={() => toggleKey(key)}
                          className="group inline-flex items-center gap-2 text-left"
                          title={
                            isOpen
                              ? "Collapse submissions"
                              : "Expand submissions"
                          }
                        >
                          <span className="inline-flex h-4 w-4 items-center justify-center text-[11px] text-zinc-500 dark:text-zinc-400">
                            {isOpen ? "▾" : "▸"}
                          </span>
                          <span className="text-zinc-900 dark:text-zinc-50 group-hover:underline">
                            {key}
                          </span>
                        </button>
                      ) : (
                        "—"
                      )}
                    </td>

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

                if (!key || !isOpen) return [summaryRow];

                const subs = predictionsByScheduleKey.get(key) ?? [];

                const detailRow = (
                  <tr key={`detail:${f.schedule_key}`}>
                    <td
                      colSpan={colCount}
                      className="px-3 pb-3 pt-2 text-xs text-zinc-700 dark:text-zinc-200"
                    >
                      <div className="rounded-xl border border-zinc-200 bg-zinc-50 p-3 dark:border-zinc-800 dark:bg-black">
                        <div className="flex items-center justify-between">
                          <div className="text-[11px] font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
                            Submissions
                          </div>
                          <div className="text-[11px] text-zinc-500 dark:text-zinc-400">
                            {subs.length} total
                          </div>
                        </div>

                        {subs.length === 0 ? (
                          <div className="mt-2 text-zinc-500 dark:text-zinc-400">
                            No submissions found for this flight.
                          </div>
                        ) : (
                          <div className="mt-2 overflow-auto">
                            <table className="min-w-[900px] text-left text-xs">
                              <thead className="text-[11px] text-zinc-600 dark:text-zinc-400">
                                <tr>
                                  <th className="py-1 pr-3 font-medium whitespace-nowrap">
                                    Provider
                                  </th>
                                  <th className="py-1 pr-3 font-medium whitespace-nowrap">
                                    Submitted At
                                  </th>
                                  <th className="py-1 pr-3 font-medium whitespace-nowrap">
                                    Outcome
                                  </th>
                                  <th className="py-1 pr-3 font-medium whitespace-nowrap">
                                    Confidence
                                  </th>
                                  {columns.map((label) => (
                                    <th
                                      key={`sub:${label}`}
                                      className="py-1 pr-3 font-medium whitespace-nowrap text-right"
                                      title={label}
                                    >
                                      {label}
                                    </th>
                                  ))}
                                </tr>
                              </thead>

                              <tbody className="font-mono text-[11px] text-zinc-900 dark:text-zinc-50">
                                {subs.map((sp, idx) => (
                                  <tr
                                    key={`${key}:${idx}`}
                                    className="border-t border-zinc-200/60 dark:border-zinc-800/60"
                                  >
                                    <td className="py-1 pr-3 whitespace-nowrap">
                                      {rowProviderAddress(sp)}
                                    </td>
                                    <td className="py-1 pr-3 whitespace-nowrap">
                                      {fmtIso(sp.created_at)}
                                    </td>
                                    <td className="py-1 pr-3 whitespace-nowrap">
                                      {rowOutcome(sp)}
                                    </td>
                                    <td className="py-1 pr-3 whitespace-nowrap">
                                      {rowConfidence(sp)}
                                    </td>
                                    {columns.map((label) => {
                                      const v = pickProb(
                                        sp?.probabilities ?? null,
                                        label,
                                      );
                                      return (
                                        <td
                                          key={`${idx}:${label}`}
                                          className="py-1 pr-3 text-right whitespace-nowrap"
                                        >
                                          {pctOrDash(v)}
                                        </td>
                                      );
                                    })}
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        )}
                      </div>
                    </td>
                  </tr>
                );

                return [summaryRow, detailRow];
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
