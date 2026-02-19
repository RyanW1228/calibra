// calibra/src/app/fund/[batchId]/components/BatchParamsCard.tsx
"use client";

import React, { useEffect, useMemo } from "react";

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
  timeZone?: string;
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
    labels.push(
      "Actual arrival time occurs at or before the scheduled arrival time.",
    );
  } else {
    labels.push(
      `Actual arrival time occurs no later than ${fmtMinutes(
        uniq[0],
      )} after the scheduled arrival time.`,
    );

    for (let i = 1; i < uniq.length; i++) {
      labels.push(
        `Actual arrival time occurs more than ${fmtMinutes(
          uniq[i - 1],
        )} and no later than ${fmtMinutes(
          uniq[i],
        )} after the scheduled arrival time.`,
      );
    }

    labels.push(
      `Actual arrival time occurs more than ${fmtMinutes(
        uniq[uniq.length - 1],
      )} after the scheduled arrival time.`,
    );
  }

  labels.push(
    "The flight does not arrive (diversion, cancellation, or missing arrival record).",
  );

  return labels;
}

function toDatetimeLocalFromUnixSeconds(u: number, tz?: string) {
  const d = new Date(u * 1000);

  if (!tz) {
    const local = new Date(d.getTime() - d.getTimezoneOffset() * 60 * 1000)
      .toISOString()
      .slice(0, 16);
    return local;
  }

  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(d);

  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";

  const year = get("year");
  const month = get("month");
  const day = get("day");
  const hour = get("hour");
  const minute = get("minute");

  if (!year || !month || !day || !hour || !minute) {
    const local = new Date(d.getTime() - d.getTimezoneOffset() * 60 * 1000)
      .toISOString()
      .slice(0, 16);
    return local;
  }

  return `${year}-${month}-${day}T${hour}:${minute}`;
}

function formatClockNow(timeZone?: string) {
  const d = new Date();
  try {
    return new Intl.DateTimeFormat(undefined, {
      timeZone: timeZone || undefined,
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    }).format(d);
  } catch {
    return d.toISOString();
  }
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
  timeZone,
}: Props) {
  const disableManualEnd = endWhenAllLanded;
  const [startImmediately, setStartImmediately] = React.useState(false);

  const userEditedStartRef = React.useRef(false);
  const userEditedEndRef = React.useRef(false);

  const rebaseDatetimeLocalToTimeZone = (value: string, tz: string) => {
    const ms = new Date(value).getTime();
    if (!Number.isFinite(ms)) return value;
    return toDatetimeLocalFromUnixSeconds(Math.floor(ms / 1000), tz);
  };

  const labels = useMemo(
    () => outcomeLabelsFromThresholds(thresholds),
    [thresholds],
  );

  const [thresholdDrafts, setThresholdDrafts] = React.useState<
    Record<string, string>
  >({});

  useEffect(() => {
    setThresholdDrafts((prev) => {
      const next: Record<string, string> = {};
      for (const t of thresholds) {
        next[t.id] = prev[t.id] ?? String(t.minutes);
      }
      return next;
    });
  }, [thresholds]);

  const addThreshold = () => {
    if (thresholds.length >= maxThresholds) return;
    const id = `t_${Math.random().toString(36).slice(2)}_${Date.now()}`;
    setThresholds([...thresholds, { id, minutes: 60 }]);
    setThresholdDrafts((prev) => ({ ...prev, [id]: "60" }));
  };

  const removeThreshold = (id: string) => {
    setThresholds(thresholds.filter((t) => t.id !== id));
    setThresholdDrafts((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
  };

  const commitThresholdMinutes = (id: string, raw: string) => {
    const trimmed = raw.trim();
    const n = trimmed === "" ? NaN : Number(trimmed);
    const clean = Number.isFinite(n) ? Math.max(1, Math.floor(n)) : 1;

    setThresholds(
      thresholds.map((t) => (t.id === id ? { ...t, minutes: clean } : t)),
    );

    setThresholdDrafts((prev) => ({ ...prev, [id]: String(clean) }));
  };

  const startNow = () => {
    userEditedStartRef.current = false;
    const nowU = Math.floor(Date.now() / 1000);
    setWindowStartLocal(toDatetimeLocalFromUnixSeconds(nowU, timeZone));
  };

  useEffect(() => {
    if (!timeZone) return;

    if (windowStartLocal && !userEditedStartRef.current) {
      const rebased = rebaseDatetimeLocalToTimeZone(windowStartLocal, timeZone);
      if (rebased !== windowStartLocal) setWindowStartLocal(rebased);
    }

    if (windowEndLocal && !userEditedEndRef.current) {
      const rebased = rebaseDatetimeLocalToTimeZone(windowEndLocal, timeZone);
      if (rebased !== windowEndLocal) setWindowEndLocal(rebased);
    }
  }, [
    timeZone,
    windowStartLocal,
    windowEndLocal,
    setWindowStartLocal,
    setWindowEndLocal,
  ]);

  const [nowText, setNowText] = React.useState(() => formatClockNow(timeZone));

  useEffect(() => {
    setNowText(formatClockNow(timeZone));
    const id = setInterval(() => {
      setNowText(formatClockNow(timeZone));
    }, 1000);
    return () => clearInterval(id);
  }, [timeZone]);

  return (
    <div className="mt-8 rounded-2xl border border-zinc-200 p-5 dark:border-zinc-800">
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <div className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">
              Batch Parameters
            </div>

            {timeZone ? (
              <span className="inline-flex items-center rounded-full border border-zinc-200 bg-zinc-50 px-2 py-0.5 text-[11px] font-medium text-zinc-700 dark:border-zinc-800 dark:bg-black dark:text-zinc-200">
                {timeZone}
              </span>
            ) : null}
          </div>
        </div>

        <div className="text-xs text-zinc-500 dark:text-zinc-400">
          Current Time: {nowText}
        </div>

        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <div className="flex flex-col gap-2">
            <div className="text-xs text-zinc-500 dark:text-zinc-400">
              Prediction Window Start
            </div>
            <input
              value={windowStartLocal}
              onChange={(e) => {
                userEditedStartRef.current = true;
                setWindowStartLocal(e.target.value);
              }}
              type="datetime-local"
              disabled={startImmediately}
              className={[
                "h-10 w-full rounded-xl border px-4 text-sm outline-none",
                startImmediately
                  ? "cursor-not-allowed border-zinc-200 bg-zinc-100 text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400"
                  : "border-zinc-200 bg-white text-zinc-900 focus:border-zinc-400 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-50 dark:focus:border-zinc-600",
              ].join(" ")}
            />

            <label className="mt-1 flex items-center gap-2 text-sm text-zinc-900 dark:text-zinc-50">
              <input
                type="checkbox"
                checked={startImmediately}
                onChange={(e) => {
                  const next = e.target.checked;
                  setStartImmediately(next);
                  if (next) startNow();
                }}
              />
              Start immediately
            </label>
          </div>

          <div className="flex flex-col gap-2">
            <div className="text-xs text-zinc-500 dark:text-zinc-400">
              Prediction Window End
            </div>
            <input
              value={windowEndLocal}
              onChange={(e) => {
                userEditedEndRef.current = true;
                setWindowEndLocal(e.target.value);
              }}
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
          <div className="mt-1 flex flex-col gap-2">
            <div className="text-sm text-zinc-900 dark:text-zinc-50">
              Delay Thresholds
            </div>

            <div className="flex flex-col gap-2">
              {thresholds.map((t, idx) => (
                <div key={t.id} className="flex items-center gap-2">
                  <div className="w-6 text-right text-xs text-zinc-500 dark:text-zinc-400">
                    {idx + 1}.
                  </div>

                  <input
                    value={thresholdDrafts[t.id] ?? String(t.minutes)}
                    onChange={(e) => {
                      const raw = e.target.value;
                      if (/^\d*$/.test(raw)) {
                        setThresholdDrafts((prev) => ({
                          ...prev,
                          [t.id]: raw,
                        }));
                      }
                    }}
                    onBlur={() =>
                      commitThresholdMinutes(
                        t.id,
                        thresholdDrafts[t.id] ?? String(t.minutes),
                      )
                    }
                    type="text"
                    inputMode="numeric"
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
                  Add Threshold
                </button>
              </div>
            </div>

            <div className="mt-3 rounded-xl border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-950">
              <div className="text-xs font-semibold text-zinc-900 dark:text-zinc-50">
                Partition Preview
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
          </div>
        </div>
      </div>
    </div>
  );
}
