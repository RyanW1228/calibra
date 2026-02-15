// calibra/src/app/fund/[batchId]/components/BatchParamsCard.tsx
"use client";

import React from "react";

type Props = {
  windowStartLocal: string;
  setWindowStartLocal: (v: string) => void;
  windowEndLocal: string;
  setWindowEndLocal: (v: string) => void;

  wantArriveLe60: boolean;
  setWantArriveLe60: (v: boolean) => void;
  wantArriveGt60: boolean;
  setWantArriveGt60: (v: boolean) => void;
  wantCancelled: boolean;
  setWantCancelled: (v: boolean) => void;
};

export default function BatchParamsCard({
  windowStartLocal,
  setWindowStartLocal,
  windowEndLocal,
  setWindowEndLocal,
  wantArriveLe60,
  setWantArriveLe60,
  wantArriveGt60,
  setWantArriveGt60,
  wantCancelled,
  setWantCancelled,
}: Props) {
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
          </div>

          <div className="flex flex-col gap-2">
            <div className="text-xs text-zinc-500 dark:text-zinc-400">
              Prediction Window End
            </div>
            <input
              value={windowEndLocal}
              onChange={(e) => setWindowEndLocal(e.target.value)}
              type="datetime-local"
              className="h-10 w-full rounded-xl border border-zinc-200 bg-white px-4 text-sm text-zinc-900 outline-none focus:border-zinc-400 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-50 dark:focus:border-zinc-600"
            />
          </div>
        </div>

        <div className="mt-4 flex flex-col gap-2">
          <div className="text-xs text-zinc-500 dark:text-zinc-400">
            Outcomes (partition)
          </div>

          <label className="flex items-center gap-2 text-sm text-zinc-900 dark:text-zinc-50">
            <input
              type="checkbox"
              checked={wantArriveLe60}
              onChange={(e) => setWantArriveLe60(e.target.checked)}
            />
            Arrival ≤ 60m from scheduled
          </label>

          <label className="flex items-center gap-2 text-sm text-zinc-900 dark:text-zinc-50">
            <input
              type="checkbox"
              checked={wantArriveGt60}
              onChange={(e) => setWantArriveGt60(e.target.checked)}
            />
            Arrival &gt; 60m from scheduled
          </label>

          <label className="flex items-center gap-2 text-sm text-zinc-900 dark:text-zinc-50">
            <input
              type="checkbox"
              checked={wantCancelled}
              onChange={(e) => setWantCancelled(e.target.checked)}
            />
            Cancelled
          </label>
        </div>
      </div>
    </div>
  );
}
