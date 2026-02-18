// calibra/src/app/submit/[batchId]/components/PredictionsTable.tsx
"use client";

import React, { useMemo, useRef, useState } from "react";

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

  const fileRef = useRef<HTMLInputElement | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [fileOk, setFileOk] = useState<string | null>(null);

  const scheduleKeySet = useMemo(
    () => new Set(flights.map((f) => (f.schedule_key ?? "").trim())),
    [flights],
  );

  const columnSet = useMemo(() => new Set(columns), [columns]);

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

  async function onPickFile(e: React.ChangeEvent<HTMLInputElement>) {
    setFileError(null);
    setFileOk(null);

    const file = e.target.files?.[0] ?? null;
    if (!file) return;

    try {
      const text = await file.text();
      const { rows, error } = parseCsv(text);
      if (error) {
        setFileError(error);
        return;
      }

      const first = rows[0] ?? {};
      const keyCol =
        ["schedule_key", "scheduleKey", "key"].find((c) => c in first) ?? null;

      if (!keyCol) {
        setFileError('CSV must include a "schedule_key" column.');
        return;
      }

      const csvCols = Object.keys(first);
      const probCols = csvCols.filter(
        (c) => c !== keyCol && columnSet.has(c.trim()),
      );

      if (probCols.length === 0) {
        setFileError(
          "CSV must include threshold columns matching your table header labels.",
        );
        return;
      }

      let appliedCells = 0;
      let appliedRows = 0;
      let skippedUnknown = 0;
      let skippedInvalid = 0;

      setPredByScheduleKey((prev) => {
        const next = { ...prev };

        for (const r of rows) {
          const key = (r[keyCol] ?? "").trim();
          if (!key) continue;

          if (!scheduleKeySet.has(key)) {
            skippedUnknown += 1;
            continue;
          }

          const existing = next[key] ? { ...next[key] } : {};
          let changedThisRow = 0;

          for (const col of probCols) {
            const label = col.trim();
            const raw = (r[col] ?? "").trim();
            if (!raw) continue;

            const x = parseNumberMaybe(raw);
            if (x === null) {
              skippedInvalid += 1;
              continue;
            }

            existing[label] = String(clampPct(x));
            appliedCells += 1;
            changedThisRow += 1;
          }

          if (changedThisRow > 0) {
            next[key] = existing;
            appliedRows += 1;
          }
        }

        return next;
      });

      setFileOk(
        `Applied ${appliedRows} row${appliedRows === 1 ? "" : "s"} (${appliedCells} cells)${
          skippedUnknown || skippedInvalid
            ? ` (skipped ${skippedUnknown} unknown, ${skippedInvalid} invalid)`
            : ""
        }.`,
      );
    } catch (err: any) {
      setFileError(err?.message ?? "Failed to read file");
    } finally {
      if (fileRef.current) fileRef.current.value = "";
    }
  }

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

          <input
            ref={fileRef}
            type="file"
            accept=".csv,text/csv"
            onChange={onPickFile}
            className="hidden"
          />

          <button
            onClick={() => fileRef.current?.click()}
            disabled={isLoading || flights.length === 0}
            className="inline-flex h-9 items-center justify-center rounded-xl border border-zinc-200 bg-white px-4 text-sm font-medium text-zinc-900 transition hover:bg-zinc-50 disabled:opacity-60 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-50 dark:hover:bg-black"
          >
            Upload CSV
          </button>

          <button
            onClick={onSubmit}
            disabled={isLoading || flights.length === 0 || isSubmitting}
            className="inline-flex h-9 items-center justify-center rounded-xl bg-indigo-600 px-5 text-sm font-medium text-white transition hover:bg-indigo-500 disabled:opacity-60"
          >
            {isSubmitting ? "Submitting…" : "Submit Predictions"}
          </button>
        </div>
      </div>

      {fileError ? (
        <div className="mt-4 rounded-xl border border-red-200 bg-red-50 p-3 text-xs text-red-700 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-200">
          {fileError}
        </div>
      ) : null}

      {fileOk ? (
        <div className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-800 dark:border-emerald-900/50 dark:bg-emerald-950/30 dark:text-emerald-200">
          {fileOk}
        </div>
      ) : null}

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

      <div className="mt-3 text-xs text-zinc-500 dark:text-zinc-400">
        Upload CSV with columns: <span className="font-mono">schedule_key</span>{" "}
        + the exact threshold header labels shown in the table (values are
        0–100).
      </div>
    </div>
  );
}
