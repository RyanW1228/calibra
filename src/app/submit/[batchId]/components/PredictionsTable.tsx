// calibra/src/app/submit/[batchId]/components/PredictionsTable.tsx
"use client";

import React, { useMemo } from "react";
type BatchFlight = {
  schedule_key: string;
  airline: string;
  flight_number: string;
  origin: string;
  destination: string;
  scheduled_depart_iso: string | null;
  scheduled_arrive_iso: string | null;
};

function buildThresholdColumns(thresholds: number[] | null | undefined) {
  const raw = Array.isArray(thresholds) ? thresholds : [];
  const cleaned = raw
    .map((x) =>
      typeof x === "number" && Number.isFinite(x) ? Math.floor(x) : NaN,
    )
    .filter((x) => Number.isFinite(x) && x >= 0);

  const uniqSorted = Array.from(new Set(cleaned)).sort((a, b) => a - b);

  const cols: string[] = [];
  for (let i = 0; i < uniqSorted.length; i += 1) {
    const t = uniqSorted[i];
    if (i === 0) cols.push(`<=${t} min`);
    else cols.push(`>${uniqSorted[i - 1]} and <=${t} min`);
  }

  if (uniqSorted.length > 0)
    cols.push(`>${uniqSorted[uniqSorted.length - 1]} min`);

  cols.push("Cancelled");
  return cols;
}

function parseNumberMaybe(s: string) {
  const t = s.trim();
  if (!t) return null;
  const x = Number(t);
  if (!Number.isFinite(x)) return null;
  return x;
}

function clampPct(x: number) {
  if (x < 0) return 0;
  if (x > 100) return 100;
  return x;
}

function parseCsv(text: string) {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  if (lines.length === 0)
    return { rows: [] as Record<string, string>[], error: "Empty file" };

  const header = lines[0].split(",").map((h) => h.trim());
  if (header.length < 2)
    return { rows: [], error: "CSV needs at least 2 columns" };

  const rows: Record<string, string>[] = [];

  for (let i = 1; i < lines.length; i++) {
    const parts = lines[i].split(",").map((p) => p.trim());
    const row: Record<string, string> = {};
    for (let c = 0; c < header.length; c++) {
      row[header[c]] = parts[c] ?? "";
    }
    rows.push(row);
  }

  return { rows, error: null as string | null };
}

export default function PredictionsTable(props: {
  flights: BatchFlight[];
  isLoading: boolean;
  thresholdsMinutes: number[] | null | undefined;
  predByScheduleKey: Record<string, Record<string, string>>;
  setPredByScheduleKey: React.Dispatch<
    React.SetStateAction<Record<string, Record<string, string>>>
  >;
  onSubmit: () => void;
  isSubmitting: boolean;
}) {
  const {
    flights,
    isLoading,
    thresholdsMinutes,
    predByScheduleKey,
    setPredByScheduleKey,
    onSubmit,
    isSubmitting,
  } = props;

  const columns = useMemo(
    () => buildThresholdColumns(thresholdsMinutes),
    [thresholdsMinutes],
  );

  const colCount = 1 + columns.length;

  const filledCount = useMemo(() => {
    let n = 0;

    for (const f of flights) {
      const key = (f.schedule_key ?? "").trim();
      if (!key) continue;

      const row = predByScheduleKey[key] ?? {};
      let any = false;

      for (const label of columns) {
        const raw = (row[label] ?? "").trim();
        if (!raw) continue;
        const x = Number(raw);
        if (Number.isFinite(x) && x >= 0 && x <= 100) any = true;
      }

      if (any) n += 1;
    }

    return n;
  }, [flights, predByScheduleKey, columns]);

  return (
    <div className="mt-6 rounded-2xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">
          Predictions
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="text-xs text-zinc-500 dark:text-zinc-400">
            Filled flights: <span className="font-mono">{filledCount}</span>/
            <span className="font-mono">{flights.length}</span>
          </div>

          <button
            onClick={onSubmit}
            disabled={isLoading || flights.length === 0 || isSubmitting}
            className="inline-flex h-9 items-center justify-center rounded-xl bg-indigo-600 px-5 text-sm font-medium text-white transition hover:bg-indigo-500 disabled:opacity-60"
          >
            {isSubmitting ? "Submitting…" : "Submit Predictions"}
          </button>
        </div>
      </div>

      <div className="mt-4 overflow-auto rounded-xl border border-zinc-200 dark:border-zinc-800">
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
                const row = key ? (predByScheduleKey[key] ?? {}) : {};

                return (
                  <tr
                    key={f.schedule_key}
                    className="border-t border-zinc-100 dark:border-zinc-900"
                  >
                    <td className="px-3 py-2 font-mono text-xs">
                      {key || "—"}
                    </td>

                    {columns.map((label) => (
                      <td
                        key={label}
                        className="px-3 py-2 text-right font-mono text-xs"
                      >
                        <input
                          value={row[label] ?? ""}
                          onChange={(e) => {
                            const v = e.target.value;
                            setPredByScheduleKey((prev) => {
                              const next = { ...prev };
                              const curRow = next[key] ? { ...next[key] } : {};
                              curRow[label] = v;
                              next[key] = curRow;
                              return next;
                            });
                          }}
                          inputMode="decimal"
                          placeholder="—"
                          className="h-8 w-24 rounded-lg border border-zinc-200 bg-white px-2 text-right text-xs text-zinc-900 outline-none focus:border-zinc-400 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-50 dark:focus:border-zinc-600"
                        />
                      </td>
                    ))}
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
