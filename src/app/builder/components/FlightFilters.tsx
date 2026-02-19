"use client";

import React, { useEffect, useMemo, useState } from "react";

export type TimeWindowHHMM = { start: string; end: string };

export type ScheduleSearchPayloadV1 = {
  mode: "schedule";
  dateStart: string; // YYYY-MM-DD
  dateEnd: string; // YYYY-MM-DD (exclusive)
  displayTimeZone: string;

  origins?: string[] | null;
  destinations?: string[] | null;
  carriers?: string[] | null;

  includeRegional?: boolean;
  includeCodeshares?: boolean;
  operatingOnly?: boolean;

  departTimeWindow?: TimeWindowHHMM | null; // in displayTimeZone
  daysOfWeek?: number[] | null; // 0..6 (Sun..Sat)

  dedupeMode?: "operating" | "marketing" | "none";
  sort?: { by: "schedDep" | "schedArr"; order: "asc" | "desc" };

  limit: number;

  enrich?: { enabled: boolean; max?: number } | null;
};

export type LookupSearchPayloadV1 = {
  mode: "lookup";
  displayTimeZone: string;
  faFlightIds?: string[] | null;
  scheduleKeys?: string[] | null;
  enrich?: { enabled: boolean; max?: number } | null;
};

export type SearchPayloadV1 = ScheduleSearchPayloadV1 | LookupSearchPayloadV1;

type Props = {
  isLoading: boolean;
  onSearch: (payload: SearchPayloadV1) => void;

  displayTimeZone?: string;
  onDisplayTimeZoneChange?: (tz: string) => void;

  defaultOrigin?: string;
  defaultDestination?: string;
  defaultCarriersCsv?: string;
  defaultLimit?: number;
};

function todayISO() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function addDaysISO(dateISO: string, days: number) {
  const [y, m, d] = dateISO.split("-").map((x) => Number(x));
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  const yy = dt.getUTCFullYear();
  const mm = String(dt.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(dt.getUTCDate()).padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
}

function clampInt(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, Math.floor(n)));
}

function normalizeUpper(s: string) {
  return s.trim().toUpperCase();
}

function parseCsvCodes(s: string): string[] {
  return s
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean)
    .map(normalizeUpper);
}

function parseMultiline(s: string): string[] {
  return s
    .split(/\r?\n/)
    .map((x) => x.trim())
    .filter(Boolean);
}

function isValidHHMM(s: string) {
  const m = s.match(/^(\d{2}):(\d{2})$/);
  if (!m) return false;
  const hh = Number(m[1]);
  const mm = Number(m[2]);
  return hh >= 0 && hh <= 23 && mm >= 0 && mm <= 59;
}

function useNowTick(refreshMs: number) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), refreshMs);
    return () => window.clearInterval(id);
  }, [refreshMs]);
  return now;
}

function formatClock(now: Date, timeZone: string) {
  try {
    return new Intl.DateTimeFormat(undefined, {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    }).format(now);
  } catch {
    return now.toISOString();
  }
}

const TIMEZONE_OPTIONS: Array<{ label: string; value: string }> = [
  { label: "UTC", value: "UTC" },
  { label: "New York", value: "America/New_York" },
  { label: "Denver", value: "America/Denver" },
  { label: "Los Angeles", value: "America/Los_Angeles" },
  { label: "London", value: "Europe/London" },
];

const DOW: Array<{ label: string; value: number }> = [
  { label: "Sun", value: 0 },
  { label: "Mon", value: 1 },
  { label: "Tue", value: 2 },
  { label: "Wed", value: 3 },
  { label: "Thu", value: 4 },
  { label: "Fri", value: 5 },
  { label: "Sat", value: 6 },
];

export default function FlightFilters(props: Props) {
  const {
    isLoading,
    onSearch,
    displayTimeZone: displayTimeZoneProp,
    onDisplayTimeZoneChange,
    defaultOrigin,
    defaultDestination,
    defaultCarriersCsv,
    defaultLimit,
  } = props;

  const [mode, setMode] = useState<"schedule" | "lookup">("schedule");

  const [displayTimeZoneLocal, setDisplayTimeZoneLocal] = useState(
    displayTimeZoneProp ?? "UTC",
  );
  const displayTimeZone =
    displayTimeZoneProp !== undefined
      ? displayTimeZoneProp
      : displayTimeZoneLocal;

  const now = useNowTick(1000);
  const nowLabel = useMemo(
    () => formatClock(now, displayTimeZone),
    [now, displayTimeZone],
  );

  const [dateStart, setDateStart] = useState(todayISO());
  const [dateEnd, setDateEnd] = useState(addDaysISO(todayISO(), 1));

  const [originsCsv, setOriginsCsv] = useState(defaultOrigin ?? "");
  const [destinationsCsv, setDestinationsCsv] = useState(
    defaultDestination ?? "",
  );
  const [carriersCsv, setCarriersCsv] = useState(defaultCarriersCsv ?? "");

  const [departWindowEnabled, setDepartWindowEnabled] = useState(false);
  const [departStartHHMM, setDepartStartHHMM] = useState("00:00");
  const [departEndHHMM, setDepartEndHHMM] = useState("23:59");

  const [daysOfWeek, setDaysOfWeek] = useState<number[]>([]);

  const [includeRegional, setIncludeRegional] = useState(true);
  const [includeCodeshares, setIncludeCodeshares] = useState(false);
  const [operatingOnly, setOperatingOnly] = useState(true);

  const [dedupeMode, setDedupeMode] = useState<
    "operating" | "marketing" | "none"
  >("operating");

  const [sortBy, setSortBy] = useState<"schedDep" | "schedArr">("schedDep");
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("asc");

  const [faFlightIdsText, setFaFlightIdsText] = useState("");
  const [scheduleKeysText, setScheduleKeysText] = useState("");

  useEffect(() => {
    if (displayTimeZoneProp !== undefined) return;
  }, [displayTimeZoneProp]);

  function setTimeZone(next: string) {
    if (onDisplayTimeZoneChange) onDisplayTimeZoneChange(next);
    if (displayTimeZoneProp === undefined) setDisplayTimeZoneLocal(next);
  }

  function toggleDow(v: number) {
    setDaysOfWeek((prev) => {
      const has = prev.includes(v);
      if (has) return prev.filter((x) => x !== v);
      return [...prev, v].sort((a, b) => a - b);
    });
  }

  function setHorizon(days: number) {
    const start = todayISO();
    setDateStart(start);
    setDateEnd(addDaysISO(start, clampInt(days, 1, 30)));
  }

  function buildSchedulePayload(): ScheduleSearchPayloadV1 | { error: string } {
    const start = dateStart.trim();
    const end = dateEnd.trim();

    if (!/^\d{4}-\d{2}-\d{2}$/.test(start))
      return { error: "dateStart must be YYYY-MM-DD" };
    if (!/^\d{4}-\d{2}-\d{2}$/.test(end))
      return { error: "dateEnd must be YYYY-MM-DD" };

    const origins = parseCsvCodes(originsCsv);
    const destinations = parseCsvCodes(destinationsCsv);
    const carriers = parseCsvCodes(carriersCsv);

    const payload: ScheduleSearchPayloadV1 = {
      mode: "schedule",
      dateStart: start,
      dateEnd: end,
      displayTimeZone,

      origins: origins.length ? origins : null,
      destinations: destinations.length ? destinations : null,
      carriers: carriers.length ? carriers : null,

      includeRegional,
      includeCodeshares,
      operatingOnly,

      departTimeWindow: departWindowEnabled
        ? { start: departStartHHMM, end: departEndHHMM }
        : null,

      daysOfWeek: daysOfWeek.length ? daysOfWeek : null,

      dedupeMode,
      sort: { by: sortBy, order: sortOrder },

      limit: clampInt(Number(defaultLimit ?? 50), 1, 200),
      enrich: { enabled: false },
    };

    if (departWindowEnabled) {
      if (!isValidHHMM(departStartHHMM) || !isValidHHMM(departEndHHMM)) {
        return { error: "Depart time window must be HH:MM (00:00–23:59)" };
      }
    }

    return payload;
  }

  function buildLookupPayload(): LookupSearchPayloadV1 {
    const faFlightIds = parseMultiline(faFlightIdsText);
    const scheduleKeys = parseMultiline(scheduleKeysText);

    return {
      mode: "lookup",
      displayTimeZone,
      faFlightIds: faFlightIds.length ? faFlightIds : null,
      scheduleKeys: scheduleKeys.length ? scheduleKeys : null,
      enrich: { enabled: false },
    };
  }

  function submit() {
    if (mode === "schedule") {
      const built = buildSchedulePayload();
      if ("error" in built) {
        window.alert(built.error);
        return;
      }
      onSearch(built);
      return;
    }

    const p = buildLookupPayload();
    onSearch(p);
  }

  const inputClass =
    "mt-1 w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900 outline-none focus:border-zinc-400 focus:ring-2 focus:ring-zinc-200 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-50 dark:focus:border-zinc-600 dark:focus:ring-zinc-900";
  const labelClass =
    "block text-xs font-medium text-zinc-700 dark:text-zinc-300";
  const helpClass = "mt-1 text-[11px] text-zinc-500 dark:text-zinc-400";
  const chipOn =
    "bg-zinc-900 text-white shadow-sm dark:bg-zinc-50 dark:text-zinc-900";
  const chipOff =
    "border border-zinc-200 bg-white text-zinc-900 hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-50 dark:hover:bg-black";

  return (
    <section className="rounded-2xl border border-zinc-200 bg-white shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
      <header className="flex flex-col gap-3 border-b border-zinc-200 px-5 py-4 dark:border-zinc-800 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-sm font-semibold text-zinc-950 dark:text-zinc-50">
              Flight Filters
            </h2>
            <span className="inline-flex items-center rounded-full border border-zinc-200 bg-zinc-50 px-2 py-0.5 text-[11px] font-medium text-zinc-700 dark:border-zinc-800 dark:bg-black dark:text-zinc-200">
              {displayTimeZone}
            </span>
          </div>
          <div className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
            Current time: <span className="font-mono">{nowLabel}</span>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-2 text-xs font-medium text-zinc-700 dark:text-zinc-300">
            <span className="whitespace-nowrap">Display TZ</span>
            <select
              value={displayTimeZone}
              onChange={(e) => setTimeZone(e.target.value)}
              className="h-10 rounded-xl border border-zinc-200 bg-white px-3 text-xs text-zinc-900 outline-none focus:border-zinc-400 focus:ring-2 focus:ring-zinc-200 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-50 dark:focus:border-zinc-600 dark:focus:ring-zinc-900"
            >
              {TIMEZONE_OPTIONS.map((tz) => (
                <option key={tz.value} value={tz.value}>
                  {tz.label}
                </option>
              ))}
            </select>
          </label>

          <div className="h-6 w-px bg-zinc-200 dark:bg-zinc-800" />

          <div className="inline-flex rounded-xl border border-zinc-200 bg-zinc-50 p-1 dark:border-zinc-800 dark:bg-black">
            <button
              type="button"
              onClick={() => setMode("schedule")}
              className={`h-8 rounded-lg px-3 text-xs font-semibold transition ${
                mode === "schedule"
                  ? chipOn
                  : "text-zinc-700 dark:text-zinc-300"
              }`}
            >
              Schedule
            </button>
            <button
              type="button"
              onClick={() => setMode("lookup")}
              className={`h-8 rounded-lg px-3 text-xs font-semibold transition ${
                mode === "lookup" ? chipOn : "text-zinc-700 dark:text-zinc-300"
              }`}
            >
              Lookup
            </button>
          </div>
        </div>
      </header>

      <div className="px-5 py-5">
        {mode === "schedule" ? (
          <>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-6">
              <div className="md:col-span-2">
                <label className={labelClass}>Origins</label>
                <input
                  value={originsCsv}
                  onChange={(e) => setOriginsCsv(e.target.value)}
                  placeholder="DEN, SFO"
                  className={inputClass}
                />
                <div className={helpClass}>Comma-separated IATA codes.</div>
              </div>

              <div className="md:col-span-2">
                <label className={labelClass}>Destinations</label>
                <input
                  value={destinationsCsv}
                  onChange={(e) => setDestinationsCsv(e.target.value)}
                  placeholder="JFK, LAX"
                  className={inputClass}
                />
                <div className={helpClass}>Comma-separated IATA codes.</div>
              </div>

              <div className="md:col-span-2">
                <label className={labelClass}>Carriers</label>
                <input
                  value={carriersCsv}
                  onChange={(e) => setCarriersCsv(e.target.value)}
                  placeholder="UA, DL, AA"
                  className={inputClass}
                />
                <div className={helpClass}>Leave blank for all.</div>
              </div>
            </div>

            <div className="mt-5 grid grid-cols-1 gap-4 md:grid-cols-6">
              <div className="md:col-span-2">
                <label className={labelClass}>Date Start</label>
                <input
                  type="date"
                  value={dateStart}
                  onChange={(e) => setDateStart(e.target.value)}
                  className={inputClass}
                />
              </div>

              <div className="md:col-span-2">
                <label className={labelClass}>Date End</label>
                <input
                  type="date"
                  value={dateEnd}
                  onChange={(e) => setDateEnd(e.target.value)}
                  className={inputClass}
                />
              </div>

              <div className="md:col-span-2">
                <label className={labelClass}>Horizon</label>
                <div className="mt-1 flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => setHorizon(2)}
                    className={`h-10 rounded-xl px-3 text-xs font-semibold transition ${chipOff}`}
                  >
                    2d
                  </button>
                  <button
                    type="button"
                    onClick={() => setHorizon(7)}
                    className={`h-10 rounded-xl px-3 text-xs font-semibold transition ${chipOff}`}
                  >
                    7d
                  </button>
                  <button
                    type="button"
                    onClick={() => setHorizon(30)}
                    className={`h-10 rounded-xl px-3 text-xs font-semibold transition ${chipOff}`}
                  >
                    30d
                  </button>
                </div>
              </div>
            </div>

            <details className="mt-5 rounded-2xl border border-zinc-200 bg-zinc-50 p-4 dark:border-zinc-800 dark:bg-black">
              <summary className="cursor-pointer select-none text-sm font-semibold text-zinc-950 dark:text-zinc-50">
                Advanced Filters
              </summary>

              <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-6">
                <div className="md:col-span-3">
                  <div className="flex items-center justify-between">
                    <label className={labelClass}>
                      Departure Window ({displayTimeZone})
                    </label>
                    <label className="flex items-center gap-2 text-xs font-medium text-zinc-700 dark:text-zinc-300">
                      <input
                        type="checkbox"
                        checked={departWindowEnabled}
                        onChange={(e) =>
                          setDepartWindowEnabled(e.target.checked)
                        }
                      />
                      Enable
                    </label>
                  </div>

                  <div className="mt-2 grid grid-cols-2 gap-2">
                    <input
                      value={departStartHHMM}
                      onChange={(e) => setDepartStartHHMM(e.target.value)}
                      disabled={!departWindowEnabled}
                      placeholder="HH:MM"
                      className={`${inputClass} mt-0 disabled:opacity-60`}
                    />
                    <input
                      value={departEndHHMM}
                      onChange={(e) => setDepartEndHHMM(e.target.value)}
                      disabled={!departWindowEnabled}
                      placeholder="HH:MM"
                      className={`${inputClass} mt-0 disabled:opacity-60`}
                    />
                  </div>

                  <div className={helpClass}>HH:MM in display timezone.</div>
                </div>

                <div className="md:col-span-3">
                  <label className={labelClass}>Days of Week</label>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {DOW.map((d) => {
                      const on = daysOfWeek.includes(d.value);
                      return (
                        <button
                          key={d.value}
                          type="button"
                          onClick={() => toggleDow(d.value)}
                          className={`h-9 rounded-xl px-3 text-xs font-semibold transition ${
                            on ? chipOn : chipOff
                          }`}
                        >
                          {d.label}
                        </button>
                      );
                    })}
                  </div>
                  <div className={helpClass}>
                    Interpreted in display timezone.
                  </div>
                </div>
              </div>

              <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-6">
                <div className="md:col-span-2">
                  <label className={labelClass}>Identity</label>
                  <div className="mt-2 flex flex-col gap-2 text-xs font-medium text-zinc-700 dark:text-zinc-300">
                    <label className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={includeRegional}
                        onChange={(e) => setIncludeRegional(e.target.checked)}
                      />
                      Include regional
                    </label>
                    <label className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={includeCodeshares}
                        onChange={(e) => setIncludeCodeshares(e.target.checked)}
                      />
                      Include codeshares
                    </label>
                    <label className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={operatingOnly}
                        onChange={(e) => setOperatingOnly(e.target.checked)}
                      />
                      Prefer operating identity
                    </label>
                  </div>
                </div>

                <div className="md:col-span-2">
                  <label className={labelClass}>Dedupe Mode</label>
                  <select
                    value={dedupeMode}
                    onChange={(e) =>
                      setDedupeMode(
                        e.target.value as "operating" | "marketing" | "none",
                      )
                    }
                    className="mt-1 h-10 w-full rounded-xl border border-zinc-200 bg-white px-3 text-sm text-zinc-900 outline-none focus:border-zinc-400 focus:ring-2 focus:ring-zinc-200 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-50 dark:focus:border-zinc-600 dark:focus:ring-zinc-900"
                  >
                    <option value="operating">Operating</option>
                    <option value="marketing">Marketing</option>
                    <option value="none">None</option>
                  </select>
                </div>

                <div className="md:col-span-2">
                  <label className={labelClass}>Sort</label>
                  <div className="mt-1 grid grid-cols-2 gap-2">
                    <select
                      value={sortBy}
                      onChange={(e) =>
                        setSortBy(e.target.value as "schedDep" | "schedArr")
                      }
                      className="h-10 w-full rounded-xl border border-zinc-200 bg-white px-3 text-sm text-zinc-900 outline-none focus:border-zinc-400 focus:ring-2 focus:ring-zinc-200 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-50 dark:focus:border-zinc-600 dark:focus:ring-zinc-900"
                    >
                      <option value="schedDep">Scheduled Depart</option>
                      <option value="schedArr">Scheduled Arrive</option>
                    </select>
                    <select
                      value={sortOrder}
                      onChange={(e) =>
                        setSortOrder(e.target.value as "asc" | "desc")
                      }
                      className="h-10 w-full rounded-xl border border-zinc-200 bg-white px-3 text-sm text-zinc-900 outline-none focus:border-zinc-400 focus:ring-2 focus:ring-zinc-200 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-50 dark:focus:border-zinc-600 dark:focus:ring-zinc-900"
                    >
                      <option value="asc">Asc</option>
                      <option value="desc">Desc</option>
                    </select>
                  </div>
                </div>
              </div>
            </details>
          </>
        ) : (
          <>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div>
                <label className={labelClass}>fa_flight_id list</label>
                <textarea
                  value={faFlightIdsText}
                  onChange={(e) => setFaFlightIdsText(e.target.value)}
                  placeholder="FA12345-...\nFA67890-..."
                  rows={8}
                  className={`${inputClass} resize-none rounded-2xl`}
                />
                <div className={helpClass}>
                  Best near-term (when IDs exist).
                </div>
              </div>

              <div>
                <label className={labelClass}>scheduleKey list</label>
                <textarea
                  value={scheduleKeysText}
                  onChange={(e) => setScheduleKeysText(e.target.value)}
                  placeholder="SCHED|UA|123|DEN|JFK|2026-03-01T09:35|America/Denver"
                  rows={8}
                  className={`${inputClass} resize-none rounded-2xl`}
                />
                <div className={helpClass}>
                  Deterministic keys (format defined by you).
                </div>
              </div>
            </div>
          </>
        )}

        <div className="mt-5 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <button
            type="button"
            onClick={submit}
            disabled={isLoading}
            className="inline-flex h-11 items-center justify-center rounded-full bg-zinc-900 px-5 text-sm font-semibold text-white shadow-sm transition hover:bg-zinc-800 disabled:opacity-60 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-white"
          >
            {isLoading ? "Searching…" : "Search"}
          </button>

          <div className="text-xs text-zinc-500 dark:text-zinc-400">
            Mode: <span className="font-mono">{mode}</span>
          </div>
        </div>
      </div>
    </section>
  );
}
