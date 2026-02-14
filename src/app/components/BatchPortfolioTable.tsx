// app/components/BatchPortfolioTable.tsx
"use client";

import React, { useMemo } from "react";

export type BatchRow = {
  scheduleKey: string; // NEW: primary identity (required)
  airline: string;
  flightNumber: string;
  origin: string;
  destination: string;

  scheduledDepartISO?: string;
  actualDepartISO?: string;
  scheduledArriveISO?: string;

  // NEW: expected arrival (ETA). For flights not yet arrived, this is what you show.
  expectedArriveISO?: string;

  actualArriveISO?: string;

  departureDelayMin?: number;

  // Optional: if you already compute arrival delay elsewhere, keep this.
  arrivalDelayMin?: number;

  status: string;
  included: boolean;

  // OPTIONAL: keep around for debugging / enrichment, but do not key off it.
  faFlightId?: string;
};

function formatTime(iso: string | undefined, timeZone: string) {
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

function diffMinutes(aISO?: string, bISO?: string) {
  if (!aISO || !bISO) return undefined;
  const a = new Date(aISO).getTime();
  const b = new Date(bISO).getTime();
  if (Number.isNaN(a) || Number.isNaN(b)) return undefined;
  return Math.round((a - b) / 60000);
}

function addMinutesISO(iso?: string, minutes?: number) {
  if (!iso || minutes === undefined) return undefined;
  const ms = new Date(iso).getTime();
  if (Number.isNaN(ms)) return undefined;
  return new Date(ms + minutes * 60000).toISOString();
}

function fmtMin(n?: number) {
  if (n === undefined) return "—";
  const sign = n > 0 ? "+" : "";
  return `${sign}${n}m`;
}

function rowKey(x: BatchRow) {
  // NEW: always key on scheduleKey
  return `sk:${x.scheduleKey}`;
}

export default function BatchPortfolioTable({
  rows,
  setRows,
  isLoading,
  error,
  displayTimeZone,
  onCreateBatch,
}: {
  rows: BatchRow[];
  setRows: React.Dispatch<React.SetStateAction<BatchRow[]>>;
  isLoading: boolean;
  error: string | null;
  displayTimeZone: string;
  onCreateBatch: (selected: BatchRow[]) => void;
}) {
  const includedCount = useMemo(
    () => rows.reduce((acc, r) => acc + (r.included ? 1 : 0), 0),
    [rows],
  );

  const selectedRows = useMemo(() => rows.filter((r) => r.included), [rows]);

  function toggleIncluded(key: string) {
    setRows((prev) =>
      prev.map((r) =>
        rowKey(r) === key ? { ...r, included: !r.included } : r,
      ),
    );
  }

  function setAll(nextIncluded: boolean) {
    setRows((prev) => prev.map((r) => ({ ...r, included: nextIncluded })));
  }

  return (
    <div className="rounded-2xl border border-zinc-200 p-5 dark:border-zinc-800">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">
            Batch / Portfolio
          </h2>
          <div className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
            Included: {includedCount} / {rows.length}
            <span className="mx-2 text-zinc-300 dark:text-zinc-700">•</span>
            TZ: <span className="font-mono">{displayTimeZone}</span>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => setAll(true)}
            className="inline-flex h-9 items-center justify-center rounded-full bg-zinc-900 px-4 text-xs font-medium text-white transition hover:bg-zinc-800 disabled:opacity-60 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-white"
            disabled={rows.length === 0}
          >
            Select All
          </button>
          <button
            onClick={() => setAll(false)}
            className="inline-flex h-9 items-center justify-center rounded-full border border-zinc-200 bg-white px-4 text-xs font-medium text-zinc-900 transition hover:bg-zinc-50 disabled:opacity-60 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-50 dark:hover:bg-black"
            disabled={rows.length === 0}
          >
            Deselect All
          </button>
          <button
            onClick={() => onCreateBatch(selectedRows)}
            className="inline-flex h-9 items-center justify-center rounded-full bg-emerald-600 px-4 text-xs font-medium text-white transition hover:bg-emerald-500 disabled:opacity-60"
            disabled={isLoading || selectedRows.length === 0}
          >
            Create Batch ({selectedRows.length})
          </button>
        </div>
      </div>

      {error ? (
        <div className="mt-4 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-200">
          <div className="font-medium">Error</div>
          <div className="mt-1">{error}</div>
        </div>
      ) : null}

      <div className="mt-4 overflow-auto rounded-xl border border-zinc-200 dark:border-zinc-800">
        <table className="min-w-[1700px] text-left text-sm">
          <thead className="sticky top-0 z-10 bg-zinc-50 text-xs text-zinc-600 dark:bg-black dark:text-zinc-400">
            <tr>
              <th className="w-10 px-3 py-2 font-medium whitespace-nowrap">
                ✓
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
            ) : rows.length === 0 ? (
              <tr>
                <td
                  colSpan={13}
                  className="px-3 py-6 text-zinc-500 dark:text-zinc-400"
                >
                  No batch yet. Run a search.
                </td>
              </tr>
            ) : (
              rows.map((r) => {
                const k = rowKey(r);

                const depDeltaMin =
                  r.actualDepartISO && r.scheduledDepartISO
                    ? diffMinutes(r.actualDepartISO, r.scheduledDepartISO)
                    : undefined;

                const hasArrived = Boolean(r.actualArriveISO);
                const hasEta = Boolean(r.expectedArriveISO);

                const actArrDeltaMin = hasArrived
                  ? (r.arrivalDelayMin ??
                    (r.actualArriveISO && r.scheduledArriveISO
                      ? diffMinutes(r.actualArriveISO, r.scheduledArriveISO)
                      : undefined))
                  : undefined;

                const expArrDeltaMin = hasArrived
                  ? actArrDeltaMin
                  : (r.arrivalDelayMin ??
                    (hasEta && r.expectedArriveISO && r.scheduledArriveISO
                      ? diffMinutes(r.expectedArriveISO, r.scheduledArriveISO)
                      : undefined));

                const expArrISO = hasArrived
                  ? r.actualArriveISO
                  : (addMinutesISO(r.scheduledArriveISO, expArrDeltaMin) ??
                    r.scheduledArriveISO);

                return (
                  <tr
                    key={k}
                    className="border-t border-zinc-100 dark:border-zinc-900"
                  >
                    <td className="px-3 py-2">
                      <input
                        type="checkbox"
                        checked={r.included}
                        onChange={() => toggleIncluded(k)}
                        className="h-4 w-4"
                      />
                    </td>

                    <td className="px-3 py-2 font-medium">{r.airline}</td>
                    <td className="px-3 py-2">{r.flightNumber}</td>

                    <td className="px-3 py-2">
                      <span className="font-mono text-xs">{r.origin}</span>
                      <span className="mx-2 text-zinc-400">→</span>
                      <span className="font-mono text-xs">{r.destination}</span>
                    </td>

                    <td className="px-3 py-2">
                      {formatTime(r.scheduledDepartISO, displayTimeZone)}
                    </td>
                    <td className="px-3 py-2">
                      {formatTime(r.actualDepartISO, displayTimeZone)}
                    </td>
                    <td className="px-3 py-2 font-mono text-xs">
                      {fmtMin(depDeltaMin)}
                    </td>

                    <td className="px-3 py-2">
                      {formatTime(r.scheduledArriveISO, displayTimeZone)}
                    </td>

                    <td className="px-3 py-2">
                      {formatTime(expArrISO, displayTimeZone)}
                    </td>
                    <td className="px-3 py-2 font-mono text-xs">
                      {fmtMin(expArrDeltaMin)}
                    </td>

                    <td className="px-3 py-2">
                      {formatTime(r.actualArriveISO, displayTimeZone)}
                    </td>
                    <td className="px-3 py-2 font-mono text-xs">
                      {fmtMin(actArrDeltaMin)}
                    </td>

                    <td className="px-3 py-2">{r.status}</td>
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
