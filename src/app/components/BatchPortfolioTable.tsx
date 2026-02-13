// app/components/BatchPortfolioTable.tsx
"use client";

import React, { useMemo } from "react";

export type BatchRow = {
  id?: string; // fa_flight_id (optional but preferred)
  airline: string;
  flightNumber: string;
  origin: string;
  destination: string;

  scheduledDepartISO?: string;
  actualDepartISO?: string;
  scheduledArriveISO?: string;
  actualArriveISO?: string;

  departureDelayMin?: number;
  arrivalDelayMin?: number;

  status: string;
  included: boolean;
};

function formatTime(iso?: string) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function diffMinutes(aISO?: string, bISO?: string) {
  if (!aISO || !bISO) return undefined;
  const a = new Date(aISO).getTime();
  const b = new Date(bISO).getTime();
  if (Number.isNaN(a) || Number.isNaN(b)) return undefined;
  return Math.round((a - b) / 60000);
}

function fmtMin(n?: number) {
  if (n === undefined) return "—";
  const sign = n > 0 ? "+" : "";
  return `${sign}${n}m`;
}

function rowKey(x: BatchRow) {
  // Prefer stable ID if present.
  if (x.id) return `id:${x.id}`;
  return [
    x.airline,
    x.flightNumber,
    x.origin,
    x.destination,
    x.scheduledDepartISO ?? "",
  ].join("|");
}

export default function BatchPortfolioTable({
  rows,
  setRows,
  isLoading,
  error,
}: {
  rows: BatchRow[];
  setRows: React.Dispatch<React.SetStateAction<BatchRow[]>>;
  isLoading: boolean;
  error: string | null;
}) {
  const includedCount = useMemo(
    () => rows.reduce((acc, r) => acc + (r.included ? 1 : 0), 0),
    [rows],
  );

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
        </div>
      </div>

      {error ? (
        <div className="mt-4 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-200">
          <div className="font-medium">Error</div>
          <div className="mt-1">{error}</div>
        </div>
      ) : null}

      <div className="mt-4 overflow-auto rounded-xl border border-zinc-200 dark:border-zinc-800">
        <table className="min-w-full text-left text-sm">
          <thead className="sticky top-0 z-10 bg-zinc-50 text-xs text-zinc-600 dark:bg-black dark:text-zinc-400">
            <tr>
              <th className="w-10 px-3 py-2 font-medium">✓</th>
              <th className="px-3 py-2 font-medium">Airline</th>
              <th className="px-3 py-2 font-medium">Flight</th>
              <th className="px-3 py-2 font-medium">Route</th>

              <th className="px-3 py-2 font-medium">Sched Dep</th>
              <th className="px-3 py-2 font-medium">Act Dep</th>
              <th className="px-3 py-2 font-medium">Dep Δ</th>

              <th className="px-3 py-2 font-medium">Sched Arr</th>
              <th className="px-3 py-2 font-medium">Act Arr</th>
              <th className="px-3 py-2 font-medium">Arr Delay</th>

              <th className="px-3 py-2 font-medium">Status</th>
            </tr>
          </thead>

          <tbody className="bg-white text-zinc-900 dark:bg-zinc-950 dark:text-zinc-50">
            {isLoading ? (
              <tr>
                <td
                  colSpan={11}
                  className="px-3 py-6 text-zinc-500 dark:text-zinc-400"
                >
                  Loading…
                </td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td
                  colSpan={11}
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

                const arrDelayMin =
                  r.arrivalDelayMin ??
                  (r.actualArriveISO && r.scheduledArriveISO
                    ? diffMinutes(r.actualArriveISO, r.scheduledArriveISO)
                    : undefined);

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
                      {formatTime(r.scheduledDepartISO)}
                    </td>
                    <td className="px-3 py-2">
                      {formatTime(r.actualDepartISO)}
                    </td>
                    <td className="px-3 py-2 font-mono text-xs">
                      {fmtMin(depDeltaMin)}
                    </td>

                    <td className="px-3 py-2">
                      {formatTime(r.scheduledArriveISO)}
                    </td>
                    <td className="px-3 py-2">
                      {formatTime(r.actualArriveISO)}
                    </td>
                    <td className="px-3 py-2 font-mono text-xs">
                      {fmtMin(arrDelayMin)}
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
