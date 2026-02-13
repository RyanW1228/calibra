//app/components/FlightBatchTable.tsx
"use client";

import React from "react";

export type FlightBatchItem = {
  airline: string;
  flightNumber: string;
  origin: string;
  destination: string;
  departLocalISO?: string;
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

export default function FlightBatchTable({
  items,
  isLoading,
  error,
  maxHeightClassName = "max-h-[520px]",
}: {
  items: FlightBatchItem[];
  isLoading: boolean;
  error: string | null;
  maxHeightClassName?: string;
}) {
  return (
    <div className="rounded-2xl border border-zinc-200 p-5 dark:border-zinc-800">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">
          Batch ({items.length})
        </h2>
        <span className="text-xs text-zinc-500 dark:text-zinc-400">
          Table View
        </span>
      </div>

      {error ? (
        <div className="mt-4 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-200">
          <div className="font-medium">Error</div>
          <div className="mt-1">{error}</div>
        </div>
      ) : null}

      <div
        className={[
          "mt-4 overflow-auto rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950",
          maxHeightClassName,
        ].join(" ")}
      >
        <table className="min-w-full text-left text-sm">
          <thead className="sticky top-0 z-10 bg-zinc-50 text-xs text-zinc-600 dark:bg-black dark:text-zinc-400">
            <tr>
              <th className="px-3 py-2 font-medium">Airline</th>
              <th className="px-3 py-2 font-medium">Flight</th>
              <th className="px-3 py-2 font-medium">Route</th>
              <th className="px-3 py-2 font-medium">Departs</th>
            </tr>
          </thead>

          <tbody className="text-zinc-900 dark:text-zinc-50">
            {isLoading ? (
              <tr>
                <td
                  className="px-3 py-6 text-zinc-500 dark:text-zinc-400"
                  colSpan={4}
                >
                  Loading…
                </td>
              </tr>
            ) : items.length === 0 ? (
              <tr>
                <td
                  className="px-3 py-6 text-zinc-500 dark:text-zinc-400"
                  colSpan={4}
                >
                  No flights in batch yet. Run a search.
                </td>
              </tr>
            ) : (
              items.map((x, idx) => (
                <tr
                  key={`${x.airline}-${x.flightNumber}-${x.origin}-${x.destination}-${idx}`}
                  className="border-t border-zinc-100 dark:border-zinc-900"
                >
                  <td className="px-3 py-2 font-medium">{x.airline}</td>
                  <td className="px-3 py-2">{x.flightNumber}</td>
                  <td className="px-3 py-2">
                    <span className="font-mono text-xs">{x.origin}</span>
                    <span className="mx-2 text-zinc-400">→</span>
                    <span className="font-mono text-xs">{x.destination}</span>
                  </td>
                  <td className="px-3 py-2">{formatTime(x.departLocalISO)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div className="mt-3 text-xs text-zinc-500 dark:text-zinc-400">
        Showing the normalized batch (only flights with airline + flight number
        + route).
      </div>
    </div>
  );
}
