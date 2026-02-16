// calibra/src/app/fund/[batchId]/components/BatchParamsCard.tsx
"use client";

import React, { useMemo } from "react";

type OutcomeThreshold = {
  id: string;
  minutes: number;
};

type Props = {
  windowStartLocal: string;
  setWindowStartLocal: (v: string) => void;
  windowEndLocal: string;
  setWindowEndLocal: (v: string) => void;

  endWhenAllLanded: boolean;
  setEndWhenAllLanded: (v: boolean) => void;

  thresholds: OutcomeThreshold[];
  setThresholds: (v: OutcomeThreshold[]) => void;

  maxThresholds?: number;
};

function fmtMinutes(m: number) {
  if (!Number.isFinite(m) || m <= 0) return "";
  if (m % 60 === 0) return `${m / 60}h`;
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  const r = m % 60;
  return `${h}h ${r}m`;
}

function outcomeLabelsFromThresholds(raw: OutcomeThreshold[]) {
  const mins = raw
    .map((t) => t.minutes)
    .filter((m) => Number.isFinite(m) && m > 0)
    .sort((a, b) => a - b);

  const uniq: number[] = [];
  for (const m of mins) {
    if (uniq.length === 0 || uniq[uniq.length - 1] !== m) uniq.push(m);
  }

  const labels: string[] = [];
  if (uniq.length === 0) {
    labels.push("Arrives (any delay)");
  } else {
    labels.push(`Arrival ≤ ${fmtMinutes(uniq[0])}`);
    for (let i = 1; i < uniq.length; i++) {
      labels.push(`${fmtMinutes(uniq[i - 1])} – ${fmtMinutes(uniq[i])}`);
    }
    labels.push(`Arrival > ${fmtMinutes(uniq[uniq.length - 1])}`);
  }
  labels.push("Flight does not arrive");
  return labels;
}

function toDatetimeLocalFromUnixSeconds(u: number) {
  const d = new Date(u * 1000);
  const local = new Date(d.getTime() - d.getTimezoneOffset() * 60 * 1000)
    .toISOString()
    .slice(0, 16);
  return local;
}

export default function BatchParamsCard({
  windowStartLocal,
  setWindowStartLocal,
  windowEndLocal,
  setWindowEndLocal,
  endWhenAllLanded,
  setEndWhenAllLanded,
  thresholds,
  setThresholds,
  maxThresholds = 5,
}: Props) {
  const disableManualEnd = endWhenAllLanded;

  const labels = useMemo(
    () => outcomeLabelsFromThresholds(thresholds),
    [thresholds],
  );

  const addThreshold = () => {
    if (thresholds.length >= maxThresholds) return;
    const id = `t_${Math.random().toString(36).slice(2)}_${Date.now()}`;
    setThresholds([...thresholds, { id, minutes: 60 }]);
  };

  const removeThreshold = (id: string) => {
    setThresholds(thresholds.filter((t) => t.id !== id));
  };

  const setThresholdMinutes = (id: string, minutes: number) => {
    const clean = Number.isFinite(minutes)
      ? Math.max(1, Math.floor(minutes))
      : 1;
    setThresholds(
      thresholds.map((t) => (t.id === id ? { ...t, minutes: clean } : t)),
    );
  };

  const startNow = () => {
    const nowU = Math.floor(Date.now() / 1000);
    setWindowStartLocal(toDatetimeLocalFromUnixSeconds(nowU));
  };

  const startInOneHour = () => {
    const u = Math.floor(Date.now() / 1000) + 60 * 60;
    setWindowStartLocal(toDatetimeLocalFromUnixSeconds(u));
  };

  return (
    <div className="mt-8 rounded-2xl border border-zinc-200 p-5 dark:border-zinc-800">
      <div className="flex flex-col gap-2">
        <div className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">
          Batch Parameters
        </div>

        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <div className="flex flex-col gap-2">
            <div className="text-xs text-zinc-500 dark:text-zinc-400">
              Prediction Window Start
            </div>
            <input
              value={windowStartLocal}
              onChange={(e) => setWindowStartLocal(e.target.value)}
              type="datetime-local"
              className="h-10 w-full rounded-xl border border-zinc-200 bg-white px-4 text-sm text-zinc-900 outline-none focus:border-zinc-400 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-50 dark:focus:border-zinc-600"
            />

            <label className="mt-1 flex items-center gap-2 text-sm text-zinc-900 dark:text-zinc-50">
              <input
                type="checkbox"
                checked={false}
                onChange={(e) => {
                  if (e.target.checked) startNow();
                }}
              />
              Start immediately
            </label>

            <label className="mt-1 flex items-center gap-2 text-sm text-zinc-900 dark:text-zinc-50">
              <input
                type="checkbox"
                checked={false}
                onChange={(e) => {
                  if (e.target.checked) startInOneHour();
                }}
              />
              Start in one hour
            </label>

            <div className="text-xs text-zinc-500 dark:text-zinc-400">
              Tip: these set the start time once; you can still edit the field
              manually after.
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <div className="text-xs text-zinc-500 dark:text-zinc-400">
              Prediction Window End
            </div>
            <input
              value={windowEndLocal}
              onChange={(e) => setWindowEndLocal(e.target.value)}
              type="datetime-local"
              disabled={disableManualEnd}
              className={[
                "h-10 w-full rounded-xl border px-4 text-sm outline-none",
                disableManualEnd
                  ? "cursor-not-allowed border-zinc-200 bg-zinc-100 text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400"
                  : "border-zinc-200 bg-white text-zinc-900 focus:border-zinc-400 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-50 dark:focus:border-zinc-600",
              ].join(" ")}
            />
            <label className="mt-1 flex items-center gap-2 text-sm text-zinc-900 dark:text-zinc-50">
              <input
                type="checkbox"
                checked={endWhenAllLanded}
                onChange={(e) => setEndWhenAllLanded(e.target.checked)}
              />
              End when all flights are landed
            </label>
            {endWhenAllLanded ? (
              <div className="text-xs text-zinc-500 dark:text-zinc-400">
                End time will be determined automatically once the final flight
                in the batch is landed (or cancelled).
              </div>
            ) : null}
          </div>
        </div>

        <div className="mt-4 flex flex-col gap-2">
          <div className="text-xs text-zinc-500 dark:text-zinc-400">
            Outcomes (partition)
          </div>

          <div className="mt-1 flex flex-col gap-2">
            <div className="text-sm text-zinc-900 dark:text-zinc-50">
              Delay thresholds
            </div>

            <div className="flex flex-col gap-2">
              {thresholds.map((t, idx) => (
                <div key={t.id} className="flex items-center gap-2">
                  <div className="w-6 text-right text-xs text-zinc-500 dark:text-zinc-400">
                    {idx + 1}.
                  </div>

                  <input
                    value={String(t.minutes)}
                    onChange={(e) =>
                      setThresholdMinutes(t.id, Number(e.target.value))
                    }
                    type="number"
                    min={1}
                    className="h-10 w-28 rounded-xl border border-zinc-200 bg-white px-3 text-sm text-zinc-900 outline-none focus:border-zinc-400 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-50 dark:focus:border-zinc-600"
                  />

                  <div className="text-xs text-zinc-500 dark:text-zinc-400">
                    minutes ({fmtMinutes(t.minutes)})
                  </div>

                  <button
                    type="button"
                    onClick={() => removeThreshold(t.id)}
                    className="ml-auto rounded-xl border border-zinc-200 px-3 py-2 text-sm text-zinc-900 hover:bg-zinc-50 dark:border-zinc-800 dark:text-zinc-50 dark:hover:bg-zinc-900"
                  >
                    Remove
                  </button>
                </div>
              ))}

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={addThreshold}
                  disabled={thresholds.length >= maxThresholds}
                  className={[
                    "rounded-xl border px-3 py-2 text-sm",
                    thresholds.length >= maxThresholds
                      ? "cursor-not-allowed border-zinc-200 bg-zinc-100 text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400"
                      : "border-zinc-200 text-zinc-900 hover:bg-zinc-50 dark:border-zinc-800 dark:text-zinc-50 dark:hover:bg-zinc-900",
                  ].join(" ")}
                >
                  Add threshold
                </button>

                <div className="text-xs text-zinc-500 dark:text-zinc-400">
                  Up to {maxThresholds}
                </div>
              </div>
            </div>

            <div className="mt-3 rounded-xl border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-950">
              <div className="text-xs font-semibold text-zinc-900 dark:text-zinc-50">
                Partition preview
              </div>
              <div className="mt-2 flex flex-col gap-1">
                {labels.map((l) => (
                  <div
                    key={l}
                    className="text-sm text-zinc-700 dark:text-zinc-200"
                  >
                    • {l}
                  </div>
                ))}
              </div>
            </div>

            <div className="text-xs text-zinc-500 dark:text-zinc-400">
              Note: thresholds are sorted automatically and duplicates are
              ignored for the preview.
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
