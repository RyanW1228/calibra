// app/components/FlightFilters.tsx
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

  // Optional: let parent own TZ; if omitted, this component owns TZ internally.
  displayTimeZone?: string;
  onDisplayTimeZoneChange?: (tz: string) => void;

  // Optional defaults
  defaultOrigin?: string;
  defaultDestination?: string;
  defaultCarriersCsv?: string; // "UA,DL"
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
  { label: "New York (America/New_York)", value: "America/New_York" },
  { label: "Denver (America/Denver)", value: "America/Denver" },
  { label: "Los Angeles (America/Los_Angeles)", value: "America/Los_Angeles" },
  { label: "London (Europe/London)", value: "Europe/London" },
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

  // TZ: either controlled by parent or internal
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

  // Schedule mode fields
  const [dateStart, setDateStart] = useState(todayISO());
  const [dateEnd, setDateEnd] = useState(addDaysISO(todayISO(), 1)); // exclusive

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

  const [limitText, setLimitText] = useState<string>(
    String(defaultLimit ?? 50),
  );

  const [enrichEnabled, setEnrichEnabled] = useState(false);
  const [enrichMaxText, setEnrichMaxText] = useState<string>("25");

  // Lookup mode fields
  const [faFlightIdsText, setFaFlightIdsText] = useState("");
  const [scheduleKeysText, setScheduleKeysText] = useState("");

  // Keep internal TZ in sync if parent starts controlling later
  useEffect(() => {
    if (displayTimeZoneProp !== undefined) return;
    // no-op (uncontrolled)
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

      limit: clampInt(Number(limitText), 1, 200),

      enrich: enrichEnabled
        ? { enabled: true, max: clampInt(Number(enrichMaxText), 1, 200) }
        : { enabled: false },
    };

    // Basic validation for HH:MM only if enabled
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
      enrich: enrichEnabled
        ? { enabled: true, max: clampInt(Number(enrichMaxText), 1, 200) }
        : { enabled: false },
    };
  }

  function submit() {
    if (mode === "schedule") {
      const built = buildSchedulePayload();
      if ("error" in built) {
        // Keep it simple: parent can show error too later; for now use alert
        // (We can wire a nicer inline error once this component is integrated.)
        window.alert(built.error);
        return;
      }
      onSearch(built);
      return;
    }

    const p = buildLookupPayload();
    onSearch(p);
  }

  return (
    <div className="rounded-2xl border border-zinc-200 p-5 dark:border-zinc-800">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">
            Filters
          </h2>
          <div className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
            Now ({displayTimeZone}):{" "}
            <span className="font-mono">{nowLabel}</span>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-2 text-xs text-zinc-500 dark:text-zinc-400">
            <span>Display TZ</span>
            <select
              value={displayTimeZone}
              onChange={(e) => setTimeZone(e.target.value)}
              className="h-9 rounded-xl border border-zinc-200 bg-white px-3 text-xs text-zinc-900 outline-none focus:border-zinc-400 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-50"
            >
              {TIMEZONE_OPTIONS.map((tz) => (
                <option key={tz.value} value={tz.value}>
                  {tz.label}
                </option>
              ))}
            </select>
          </label>

          <div className="h-6 w-px bg-zinc-200 dark:bg-zinc-800" />

          <div className="inline-flex rounded-xl border border-zinc-200 bg-white p-1 dark:border-zinc-800 dark:bg-zinc-950">
            <button
              type="button"
              onClick={() => setMode("schedule")}
              className={`h-8 rounded-lg px-3 text-xs font-medium ${
                mode === "schedule"
                  ? "bg-zinc-900 text-white dark:bg-zinc-50 dark:text-zinc-900"
                  : "text-zinc-700 hover:bg-zinc-50 dark:text-zinc-300 dark:hover:bg-black"
              }`}
            >
              Schedule Search
            </button>
            <button
              type="button"
              onClick={() => setMode("lookup")}
              className={`h-8 rounded-lg px-3 text-xs font-medium ${
                mode === "lookup"
                  ? "bg-zinc-900 text-white dark:bg-zinc-50 dark:text-zinc-900"
                  : "text-zinc-700 hover:bg-zinc-50 dark:text-zinc-300 dark:hover:bg-black"
              }`}
            >
              Lookup IDs / Keys
            </button>
          </div>
        </div>
      </div>

      {mode === "schedule" ? (
        <>
          <div className="mt-5 grid grid-cols-1 gap-4 md:grid-cols-6">
            <div className="md:col-span-2">
              <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-400">
                Origins (comma-separated)
              </label>
              <input
                value={originsCsv}
                onChange={(e) => setOriginsCsv(e.target.value)}
                placeholder="DEN, SFO"
                className="mt-1 w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900 outline-none focus:border-zinc-400 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-50"
              />
              <div className="mt-1 text-[11px] text-zinc-500 dark:text-zinc-400">
                Leave blank for wildcard.
              </div>
            </div>

            <div className="md:col-span-2">
              <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-400">
                Destinations (comma-separated)
              </label>
              <input
                value={destinationsCsv}
                onChange={(e) => setDestinationsCsv(e.target.value)}
                placeholder="JFK, LAX"
                className="mt-1 w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900 outline-none focus:border-zinc-400 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-50"
              />
              <div className="mt-1 text-[11px] text-zinc-500 dark:text-zinc-400">
                Leave blank for wildcard.
              </div>
            </div>

            <div className="md:col-span-2">
              <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-400">
                Carriers (comma-separated)
              </label>
              <input
                value={carriersCsv}
                onChange={(e) => setCarriersCsv(e.target.value)}
                placeholder="UA, DL, AA"
                className="mt-1 w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900 outline-none focus:border-zinc-400 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-50"
              />
              <div className="mt-1 text-[11px] text-zinc-500 dark:text-zinc-400">
                Leave blank for all carriers.
              </div>
            </div>
          </div>

          <div className="mt-5 grid grid-cols-1 gap-4 md:grid-cols-6">
            <div className="md:col-span-2">
              <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-400">
                Date Start
              </label>
              <input
                type="date"
                value={dateStart}
                onChange={(e) => setDateStart(e.target.value)}
                className="mt-1 w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900 outline-none focus:border-zinc-400 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-50"
              />
            </div>

            <div className="md:col-span-2">
              <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-400">
                Date End (exclusive)
              </label>
              <input
                type="date"
                value={dateEnd}
                onChange={(e) => setDateEnd(e.target.value)}
                className="mt-1 w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900 outline-none focus:border-zinc-400 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-50"
              />
            </div>

            <div className="md:col-span-2">
              <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-400">
                Horizon Presets
              </label>
              <div className="mt-1 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => setHorizon(2)}
                  className="h-10 rounded-xl border border-zinc-200 bg-white px-3 text-xs font-medium text-zinc-900 hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-50 dark:hover:bg-black"
                >
                  Next 2 days
                </button>
                <button
                  type="button"
                  onClick={() => setHorizon(7)}
                  className="h-10 rounded-xl border border-zinc-200 bg-white px-3 text-xs font-medium text-zinc-900 hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-50 dark:hover:bg-black"
                >
                  Next 7 days
                </button>
                <button
                  type="button"
                  onClick={() => setHorizon(30)}
                  className="h-10 rounded-xl border border-zinc-200 bg-white px-3 text-xs font-medium text-zinc-900 hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-50 dark:hover:bg-black"
                >
                  Next 30 days
                </button>
              </div>
              <div className="mt-1 text-[11px] text-zinc-500 dark:text-zinc-400">
                Sets dateStart=today and dateEnd=today+N (exclusive).
              </div>
            </div>
          </div>

          <details className="mt-5 rounded-2xl border border-zinc-200 p-4 dark:border-zinc-800">
            <summary className="cursor-pointer select-none text-sm font-semibold text-zinc-900 dark:text-zinc-50">
              Advanced Filters
            </summary>

            <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-6">
              <div className="md:col-span-3">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-medium text-zinc-600 dark:text-zinc-400">
                    Departure Time Window ({displayTimeZone})
                  </label>
                  <label className="flex items-center gap-2 text-xs text-zinc-500 dark:text-zinc-400">
                    <input
                      type="checkbox"
                      checked={departWindowEnabled}
                      onChange={(e) => setDepartWindowEnabled(e.target.checked)}
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
                    className="w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900 outline-none focus:border-zinc-400 disabled:opacity-60 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-50"
                  />
                  <input
                    value={departEndHHMM}
                    onChange={(e) => setDepartEndHHMM(e.target.value)}
                    disabled={!departWindowEnabled}
                    placeholder="HH:MM"
                    className="w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900 outline-none focus:border-zinc-400 disabled:opacity-60 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-50"
                  />
                </div>

                <div className="mt-1 text-[11px] text-zinc-500 dark:text-zinc-400">
                  Uses display timezone. Supports overnight windows later
                  (backend).
                </div>
              </div>

              <div className="md:col-span-3">
                <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-400">
                  Days of Week (optional)
                </label>
                <div className="mt-2 flex flex-wrap gap-2">
                  {DOW.map((d) => {
                    const on = daysOfWeek.includes(d.value);
                    return (
                      <button
                        key={d.value}
                        type="button"
                        onClick={() => toggleDow(d.value)}
                        className={`h-9 rounded-xl px-3 text-xs font-medium ${
                          on
                            ? "bg-zinc-900 text-white dark:bg-zinc-50 dark:text-zinc-900"
                            : "border border-zinc-200 bg-white text-zinc-900 hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-50 dark:hover:bg-black"
                        }`}
                      >
                        {d.label}
                      </button>
                    );
                  })}
                </div>
                <div className="mt-1 text-[11px] text-zinc-500 dark:text-zinc-400">
                  Interpreted in display timezone.
                </div>
              </div>
            </div>

            <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-6">
              <div className="md:col-span-2">
                <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-400">
                  Identity / Codeshares
                </label>
                <div className="mt-2 flex flex-col gap-2 text-xs text-zinc-600 dark:text-zinc-400">
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
                    Include codeshares (marketing duplicates)
                  </label>
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={operatingOnly}
                      onChange={(e) => setOperatingOnly(e.target.checked)}
                    />
                    Prefer operating flight identity
                  </label>
                </div>
                <div className="mt-1 text-[11px] text-zinc-500 dark:text-zinc-400">
                  Your backend currently avoids codeshares and prefers operating
                  ident.
                </div>
              </div>

              <div className="md:col-span-2">
                <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-400">
                  Dedupe Mode
                </label>
                <select
                  value={dedupeMode}
                  onChange={(e) =>
                    setDedupeMode(
                      e.target.value as "operating" | "marketing" | "none",
                    )
                  }
                  className="mt-2 h-10 w-full rounded-xl border border-zinc-200 bg-white px-3 text-sm text-zinc-900 outline-none focus:border-zinc-400 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-50"
                >
                  <option value="operating">Operating (recommended)</option>
                  <option value="marketing">Marketing (codeshare-heavy)</option>
                  <option value="none">None</option>
                </select>
              </div>

              <div className="md:col-span-2">
                <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-400">
                  Sort
                </label>
                <div className="mt-2 grid grid-cols-2 gap-2">
                  <select
                    value={sortBy}
                    onChange={(e) =>
                      setSortBy(e.target.value as "schedDep" | "schedArr")
                    }
                    className="h-10 w-full rounded-xl border border-zinc-200 bg-white px-3 text-sm text-zinc-900 outline-none focus:border-zinc-400 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-50"
                  >
                    <option value="schedDep">Sched Dep</option>
                    <option value="schedArr">Sched Arr</option>
                  </select>
                  <select
                    value={sortOrder}
                    onChange={(e) =>
                      setSortOrder(e.target.value as "asc" | "desc")
                    }
                    className="h-10 w-full rounded-xl border border-zinc-200 bg-white px-3 text-sm text-zinc-900 outline-none focus:border-zinc-400 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-50"
                  >
                    <option value="asc">Asc</option>
                    <option value="desc">Desc</option>
                  </select>
                </div>
              </div>
            </div>

            <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-6">
              <div className="md:col-span-2">
                <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-400">
                  Limit
                </label>
                <input
                  type="number"
                  min={1}
                  max={200}
                  value={limitText}
                  onChange={(e) => setLimitText(e.target.value)}
                  onBlur={() =>
                    setLimitText(String(clampInt(Number(limitText), 1, 200)))
                  }
                  className="mt-2 w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900 outline-none focus:border-zinc-400 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-50"
                />
              </div>

              <div className="md:col-span-4">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-medium text-zinc-600 dark:text-zinc-400">
                    Enrichment (live status/delays when ID exists)
                  </label>
                  <label className="flex items-center gap-2 text-xs text-zinc-500 dark:text-zinc-400">
                    <input
                      type="checkbox"
                      checked={enrichEnabled}
                      onChange={(e) => setEnrichEnabled(e.target.checked)}
                    />
                    Enable
                  </label>
                </div>

                <div className="mt-2 grid grid-cols-2 gap-2">
                  <input
                    type="number"
                    min={1}
                    max={200}
                    value={enrichMaxText}
                    onChange={(e) => setEnrichMaxText(e.target.value)}
                    onBlur={() =>
                      setEnrichMaxText(
                        String(clampInt(Number(enrichMaxText), 1, 200)),
                      )
                    }
                    disabled={!enrichEnabled}
                    className="w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900 outline-none focus:border-zinc-400 disabled:opacity-60 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-50"
                  />

                  <div className="flex items-center text-[11px] text-zinc-500 dark:text-zinc-400">
                    Max rows to enrich (cost control)
                  </div>
                </div>
              </div>
            </div>
          </details>
        </>
      ) : (
        <>
          <div className="mt-5 grid grid-cols-1 gap-4 md:grid-cols-2">
            <div>
              <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-400">
                fa_flight_id list (one per line)
              </label>
              <textarea
                value={faFlightIdsText}
                onChange={(e) => setFaFlightIdsText(e.target.value)}
                placeholder="FA12345-...\nFA67890-..."
                rows={8}
                className="mt-1 w-full rounded-2xl border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900 outline-none focus:border-zinc-400 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-50"
              />
              <div className="mt-1 text-[11px] text-zinc-500 dark:text-zinc-400">
                Works best near-term (when IDs exist).
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-400">
                scheduleKey list (one per line)
              </label>
              <textarea
                value={scheduleKeysText}
                onChange={(e) => setScheduleKeysText(e.target.value)}
                placeholder="SCHED|UA|123|DEN|JFK|2026-03-01T09:35|America/Denver"
                rows={8}
                className="mt-1 w-full rounded-2xl border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900 outline-none focus:border-zinc-400 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-50"
              />
              <div className="mt-1 text-[11px] text-zinc-500 dark:text-zinc-400">
                Deterministic keys for 2–30 days out (you define the format).
              </div>
            </div>
          </div>

          <div className="mt-4 rounded-2xl border border-zinc-200 p-4 dark:border-zinc-800">
            <div className="flex items-center justify-between">
              <label className="text-xs font-medium text-zinc-600 dark:text-zinc-400">
                Enrichment (optional)
              </label>
              <label className="flex items-center gap-2 text-xs text-zinc-500 dark:text-zinc-400">
                <input
                  type="checkbox"
                  checked={enrichEnabled}
                  onChange={(e) => setEnrichEnabled(e.target.checked)}
                />
                Enable
              </label>
            </div>

            <div className="mt-2 grid grid-cols-2 gap-2">
              <input
                type="number"
                min={1}
                max={200}
                value={enrichMaxText}
                onChange={(e) => setEnrichMaxText(e.target.value)}
                onBlur={() =>
                  setEnrichMaxText(
                    String(clampInt(Number(enrichMaxText), 1, 200)),
                  )
                }
                disabled={!enrichEnabled}
                className="w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900 outline-none focus:border-zinc-400 disabled:opacity-60 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-50"
              />

              <div className="flex items-center text-[11px] text-zinc-500 dark:text-zinc-400">
                Max rows to enrich
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
          className="inline-flex h-11 items-center justify-center rounded-full bg-zinc-900 px-5 text-sm font-medium text-white transition hover:bg-zinc-800 disabled:opacity-60 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-white"
        >
          {isLoading ? "Searching…" : "Search"}
        </button>

        <div className="text-xs text-zinc-500 dark:text-zinc-400">
          Mode: <span className="font-mono">{mode}</span>
        </div>
      </div>
    </div>
  );
}
