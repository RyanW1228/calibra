"use client";

import React from "react";

type BatchFlight = {
  schedule_key: string;
  airline: string;
  flight_number: string;
  origin: string;
  destination: string;
  scheduled_depart_iso: string | null;
  scheduled_arrive_iso: string | null;
};

function fmtLocal(iso: string | null | undefined, tz: string) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  try {
    return new Intl.DateTimeFormat(undefined, {
      timeZone: tz,
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    }).format(d);
  } catch {
    return d.toISOString();
  }
}

type Props = {
  flights: BatchFlight[];
  isLoading: boolean;
  tz: string;
};

export default function FlightsTable({ flights, isLoading, tz }: Props) {
  return (
    <div className="mt-8 overflow-hidden rounded-2xl border border-zinc-200 dark:border-zinc-800">
      <div className="flex items-center justify-between border-b border-zinc-200 bg-zinc-50 px-5 py-3 text-xs text-zinc-600 dark:border-zinc-800 dark:bg-black dark:text-zinc-400">
        <div className="flex items-center gap-2">
          <div className="font-medium">Flights</div>
          <span className="inline-flex items-center rounded-full border border-zinc-200 bg-white px-2 py-0.5 text-[11px] font-medium text-zinc-700 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-200">
            {tz}
          </span>
        </div>

        <div>{isLoading ? "Loading…" : `${flights.length}`}</div>
      </div>

      <div className="overflow-auto">
        <table className="min-w-[1000px] text-left text-sm">
          <thead className="bg-white text-xs text-zinc-600 dark:bg-zinc-950 dark:text-zinc-400">
            <tr>
              <th className="px-5 py-3 font-medium whitespace-nowrap">
                Flight
              </th>
              <th className="px-5 py-3 font-medium whitespace-nowrap">Route</th>
              <th className="px-5 py-3 font-medium whitespace-nowrap">
                Scheduled Departure
              </th>
              <th className="px-5 py-3 font-medium whitespace-nowrap">
                Scheduled Arrival
              </th>
              <th className="px-5 py-3 font-medium whitespace-nowrap">
                Schedule Key
              </th>
            </tr>
          </thead>
          <tbody className="bg-white text-zinc-900 dark:bg-zinc-950 dark:text-zinc-50">
            {isLoading ? (
              <tr>
                <td
                  colSpan={5}
                  className="px-5 py-6 text-zinc-500 dark:text-zinc-400"
                >
                  Loading…
                </td>
              </tr>
            ) : flights.length === 0 ? (
              <tr>
                <td
                  colSpan={5}
                  className="px-5 py-6 text-zinc-500 dark:text-zinc-400"
                >
                  No flights found for this batch.
                </td>
              </tr>
            ) : (
              flights.map((f) => (
                <tr
                  key={f.schedule_key}
                  className="border-t border-zinc-100 dark:border-zinc-900"
                >
                  <td className="px-5 py-3 font-medium">
                    {f.airline} {f.flight_number}
                  </td>
                  <td className="px-5 py-3">
                    <span className="font-mono text-xs">{f.origin}</span>
                    <span className="mx-2 text-zinc-400">→</span>
                    <span className="font-mono text-xs">{f.destination}</span>
                  </td>
                  <td className="px-5 py-3">
                    {fmtLocal(f.scheduled_depart_iso, tz)}
                  </td>
                  <td className="px-5 py-3">
                    {fmtLocal(f.scheduled_arrive_iso, tz)}
                  </td>
                  <td className="px-5 py-3 font-mono text-xs">
                    {f.schedule_key}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
