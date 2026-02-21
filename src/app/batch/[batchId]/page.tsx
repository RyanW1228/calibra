// calibra/src/app/batch/[batchId]/page.tsx
"use client";

import React, { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  useAccount,
  useBalance,
  useChainId,
  useConnect,
  useDisconnect,
  useReadContract,
  useSignMessage,
  useSwitchChain,
} from "wagmi";
import { formatUnits, type Address, type Hex } from "viem";
import { ADI_TESTNET_CHAIN_ID, batchIdToHash } from "@/lib/calibraOnchain";
import BatchFlightsTable, {
  type BatchFlightRow,
  type BatchPredictionRow,
} from "./components/BatchFlightsTable";

import BatchPredictionsTable from "./components/BatchPredictionsTable";

type BatchGetResponse =
  | {
      ok: true;
      batch: {
        id: string;
        display_time_zone: string;
        flight_count: number;
        status: string;
        created_at: string;
        thresholds_minutes?: number[] | null;
        prediction_window_start_at?: string | null;
        prediction_window_end_at?: string | null;

        bounty_usdc?: number | null;
        bonded_model_count?: number | null;

        bounty_amount?: number | null;
        bounty_amount_usdc?: number | null;
        bounty_amount_base_units?: string | number | null;
        bond_paid_count?: number | null;
        models_joined_count?: number | null;
        competitor_count?: number | null;
      };
      flights: BatchFlightRow[];
    }
  | { ok: false; error: string; details?: unknown };

type BatchInfo = Extract<BatchGetResponse, { ok: true }>["batch"];

type PredictionRow = {
  id: string;
  schedule_key: string;
  model: string | null;
  outcome: string | null;
  confidence: number | null;
  created_at: string | null;

  probabilities?: Record<string, number> | null;
};

type PredictionsResponse =
  | { ok: true; predictions: PredictionRow[] }
  | { ok: false; error: string; details?: unknown };

type RefreshFlightsResponse =
  | {
      ok: true;
      batch_id: string;
      schedules_updated?: number;
      flights_attempted?: number;
      flights_updated?: number;
      flights_failed?: number;
    }
  | { ok: false; error: string; retry_after_ms?: number; details?: unknown };

function fmtIsoLocal(s: string | null) {
  if (!s) return "—";
  const d = new Date(s);
  const ms = d.getTime();
  if (!Number.isFinite(ms)) return "—";
  return d.toLocaleString();
}

function fmtIsoInTimeZone(iso: string | null | undefined, timeZone: string) {
  if (!iso) return "—";
  const d = new Date(iso);
  const ms = d.getTime();
  if (!Number.isFinite(ms)) return "—";
  try {
    return new Intl.DateTimeFormat(undefined, {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    }).format(d);
  } catch {
    return d.toLocaleString();
  }
}

function clampNonNeg(ms: number) {
  return ms < 0 ? 0 : ms;
}

function fmtCountdown(ms: number) {
  const t = Math.floor(clampNonNeg(ms) / 1000);
  const hh = Math.floor(t / 3600);
  const mm = Math.floor((t % 3600) / 60);
  const ss = t % 60;
  const pad = (x: number) => String(x).padStart(2, "0");
  return `${pad(hh)}:${pad(mm)}:${pad(ss)}`;
}

const UPDATE_COOLDOWN_MS = 30_000;

type AggregationMode = "avg_latest" | "time_weighted_latest";

// Controls how aggressively recency is favored for time-weighted mode.
// Half-life = time for a submission's weight to halve.
const TIME_WEIGHT_HALF_LIFE_MIN = 30;

function clamp01(x: number) {
  if (!Number.isFinite(x)) return 0;
  if (x < 0) return 0;
  if (x > 1) return 1;
  return x;
}

function weightFromCreatedAt(createdAtIso: string | null, nowMs: number) {
  if (!createdAtIso) return 1;
  const t = new Date(createdAtIso).getTime();
  if (!Number.isFinite(t)) return 1;

  const ageMs = Math.max(0, nowMs - t);
  const halfLifeMs = TIME_WEIGHT_HALF_LIFE_MIN * 60_000;
  if (halfLifeMs <= 0) return 1;

  // 0.5^(age/halfLife)
  return Math.pow(0.5, ageMs / halfLifeMs);
}

function aggregateLatestPerModel(
  latestRows: BatchPredictionRow[],
  mode: AggregationMode,
  nowMs: number,
) {
  // latestRows is already "latest per provider per schedule" (via keepLatestPerProvider)
  const bySchedule = new Map<string, BatchPredictionRow[]>();
  for (const r of latestRows) {
    const scheduleKey = (r.schedule_key ?? "").toString();
    if (!scheduleKey) continue;
    if (!r.probabilities || typeof r.probabilities !== "object") continue;

    const arr = bySchedule.get(scheduleKey) ?? [];
    arr.push(r);
    bySchedule.set(scheduleKey, arr);
  }

  const out: BatchPredictionRow[] = [];

  for (const [scheduleKey, rows] of bySchedule.entries()) {
    if (rows.length === 0) continue;

    const keys = new Set<string>();
    for (const r of rows) {
      const p = r.probabilities ?? null;
      if (!p) continue;
      for (const k of Object.keys(p)) keys.add(k);
    }

    const sums: Record<string, number> = {};
    let denom = 0;

    for (const r of rows) {
      const p = r.probabilities ?? null;
      if (!p) continue;

      const w =
        mode === "time_weighted_latest"
          ? weightFromCreatedAt(r.created_at ?? null, nowMs)
          : 1;

      if (!Number.isFinite(w) || w <= 0) continue;

      denom += w;

      for (const k of keys) {
        const vRaw = (p as any)[k];
        const v = clamp01(typeof vRaw === "number" ? vRaw : NaN);
        sums[k] = (sums[k] ?? 0) + v * w;
      }
    }

    if (denom <= 0) continue;

    const aggregated: Record<string, number> = {};
    for (const k of keys) aggregated[k] = (sums[k] ?? 0) / denom;

    out.push({
      schedule_key: scheduleKey,
      provider_address: null,

      outcome: null,
      confidence: null,
      created_at: new Date(nowMs).toISOString(),
      probabilities: aggregated,
    });
  }

  return out;
}

const ERC20_ABI = [
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "decimals",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint8" }],
  },
  {
    type: "function",
    name: "symbol",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "string" }],
  },
] as const;

const MOCK_USDC = "0x0033354Bc028fE794AE810b6D921E47389723dEd" as Address;

function fmtFixed(n: number, decimals: number) {
  if (!Number.isFinite(n)) return "—";
  return n.toFixed(decimals);
}

function fmtMoney(n: number | null | undefined, symbol: string) {
  if (typeof n !== "number" || !Number.isFinite(n)) return "—";
  const v = Math.round(n * 100) / 100;
  return `${symbol}${v.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function pickCompetitorCount(batch: BatchInfo | null) {
  return null;
}

function pickBountyAmountUsd(batch: BatchInfo | null) {
  if (!batch) return null;
  const candidates = [
    batch.bounty_usdc,
    batch.bounty_amount_usdc,
    batch.bounty_amount,
  ];
  for (const x of candidates) {
    if (typeof x === "number" && Number.isFinite(x) && x >= 0) return x;
  }
  return null;
}

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

function lastUpdateKey(batchId: string) {
  return `calibra:batch_flights_last_update_ms:${batchId}`;
}

function readLastUpdateMs(batchId: string) {
  try {
    const raw = window.localStorage.getItem(lastUpdateKey(batchId));
    if (!raw) return null;
    const n = Number(raw);
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}

function writeLastUpdateMs(batchId: string, ms: number) {
  try {
    window.localStorage.setItem(lastUpdateKey(batchId), String(ms));
  } catch {}
}

function pickLatestRow(
  a: BatchPredictionRow | undefined,
  b: BatchPredictionRow,
) {
  if (!a) return b;

  const aMs = a.created_at ? new Date(a.created_at).getTime() : -1;
  const bMs = b.created_at ? new Date(b.created_at).getTime() : -1;

  if (!Number.isFinite(aMs) && !Number.isFinite(bMs)) return a;
  if (!Number.isFinite(aMs)) return b;
  if (!Number.isFinite(bMs)) return a;

  return bMs >= aMs ? b : a;
}

function keepLatestPerProvider(rows: BatchPredictionRow[]) {
  const bySchedule = new Map<string, Map<string, BatchPredictionRow>>();

  for (const r of rows) {
    const scheduleKey = (r.schedule_key ?? "").toString();
    if (!scheduleKey) continue;

    const provider = (r.provider_address ?? "").toString().toLowerCase();
    if (!provider) continue;

    let inner = bySchedule.get(scheduleKey);
    if (!inner) {
      inner = new Map<string, BatchPredictionRow>();
      bySchedule.set(scheduleKey, inner);
    }

    const prev = inner.get(provider);
    inner.set(provider, pickLatestRow(prev, r));
  }

  const out: BatchPredictionRow[] = [];
  for (const inner of bySchedule.values()) {
    for (const v of inner.values()) out.push(v);
  }
  return out;
}

export default function BatchPage() {
  const router = useRouter();
  const params = useParams<{ batchId: string }>();
  const batchId = (params?.batchId ?? "").toString();

  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [batch, setBatch] = useState<BatchInfo | null>(null);
  const [flights, setFlights] = useState<BatchFlightRow[]>([]);

  const [predLoading, setPredLoading] = useState(false);
  const [predError, setPredError] = useState<string | null>(null);
  const [predictions, setPredictions] = useState<PredictionRow[]>([]);
  const { address, isConnected } = useAccount();
  const chainId = useChainId();

  const addr = useMemo(() => {
    if (!address) return undefined;
    if (!address.startsWith("0x")) return undefined;
    return address as Address;
  }, [address]);

  const { data: usdcSymbol } = useReadContract({
    address: MOCK_USDC,
    abi: ERC20_ABI,
    functionName: "symbol",
    query: { enabled: true },
  });

  const { data: usdcDecimalsRaw } = useReadContract({
    address: MOCK_USDC,
    abi: ERC20_ABI,
    functionName: "decimals",
    query: { enabled: true },
  });

  const usdcDecimals = useMemo(() => {
    const n = Number(usdcDecimalsRaw ?? 6);
    return Number.isFinite(n) ? n : 6;
  }, [usdcDecimalsRaw]);

  const { data: usdcBalRaw } = useReadContract({
    address: MOCK_USDC,
    abi: ERC20_ABI,
    functionName: "balanceOf",
    args: addr ? [addr] : undefined,
    query: { enabled: !!addr },
  });

  const { data: adiBal } = useBalance({
    address: addr,
    query: { enabled: !!addr },
  });

  const usdcFormatted = useMemo(() => {
    if (typeof usdcBalRaw !== "bigint") return "—";
    const n = Number(formatUnits(usdcBalRaw, usdcDecimals));
    return fmtFixed(n, 2);
  }, [usdcBalRaw, usdcDecimals]);

  const adiFormatted = useMemo(() => {
    if (!adiBal) return "—";
    const n = Number(formatUnits(adiBal.value, adiBal.decimals));
    return fmtFixed(n, 4);
  }, [adiBal]);

  const { connectAsync, connectors } = useConnect();
  const { disconnect } = useDisconnect();
  const { signMessageAsync } = useSignMessage();
  const { switchChainAsync } = useSwitchChain();

  const [funderSubsLoading, setFunderSubsLoading] = useState(false);
  const [funderSubsError, setFunderSubsError] = useState<string | null>(null);
  const [funderSubsRows, setFunderSubsRows] = useState<
    {
      providerAddress: string;
      createdAt: string | null;
      predictions: {
        schedule_key: string;
        probabilities: Record<string, number>;
      }[];
    }[]
  >([]);

  const [updateLoading, setUpdateLoading] = useState(false);
  const [updateError, setUpdateError] = useState<string | null>(null);
  const [lastUpdateMs, setLastUpdateMs] = useState<number | null>(null);
  const [lastSubsRefreshMs, setLastSubsRefreshMs] = useState<number | null>(
    null,
  );

  const tz = useMemo(() => {
    const v = (batch?.display_time_zone ?? "UTC").toString();
    return v || "UTC";
  }, [batch]);

  const bountyUsd = useMemo(() => pickBountyAmountUsd(batch), [batch]);
  const bountyText = useMemo(() => {
    const sym = typeof usdcSymbol === "string" ? usdcSymbol : "USDC";
    const prefix = sym.toUpperCase() === "USDC" ? "$" : "";
    if (prefix) return fmtMoney(bountyUsd, "$");
    if (typeof bountyUsd !== "number" || !Number.isFinite(bountyUsd))
      return "—";
    return `${bountyUsd.toLocaleString(undefined, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })} ${sym}`;
  }, [bountyUsd, usdcSymbol]);

  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNowMs(Date.now()), 250);
    return () => window.clearInterval(id);
  }, []);

  const [aggregationMode, setAggregationMode] =
    useState<AggregationMode>("avg_latest");

  useEffect(() => {
    if (!batchId) return;
    const saved = readLastUpdateMs(batchId);
    if (typeof saved === "number") setLastUpdateMs(saved);
  }, [batchId]);

  async function loadBatchEnriched(alive?: { current: boolean }) {
    if (!batchId) {
      setError("Missing batchId");
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const res = await fetch(
        `/api/batches/get-enriched?batchId=${encodeURIComponent(batchId)}`,
        { method: "GET", cache: "no-store" },
      );

      const json = (await res.json()) as BatchGetResponse;

      if (!res.ok || !json.ok) {
        if (alive && !alive.current) return;
        setBatch(null);
        setFlights([]);
        setError(json.ok ? "Request failed" : json.error);
        return;
      }

      if (alive && !alive.current) return;
      setBatch(json.batch);
      setFlights(Array.isArray(json.flights) ? json.flights : []);
    } catch (e: any) {
      if (alive && !alive.current) return;
      setBatch(null);
      setFlights([]);
      setError(e?.message ?? "Failed to load batch");
    } finally {
      if (alive && !alive.current) return;
      setIsLoading(false);
    }
  }

  useEffect(() => {
    const alive = { current: true };
    loadBatchEnriched(alive);
    return () => {
      alive.current = false;
    };
  }, [batchId]);

  async function loadPredictions() {
    if (!batchId) return;

    setPredLoading(true);
    setPredError(null);

    try {
      const res = await fetch(
        `/api/predictions/list?batchId=${encodeURIComponent(batchId)}`,
        { method: "GET", cache: "no-store" },
      );

      if (res.status === 404) {
        setPredictions([]);
        return;
      }

      const json = (await res.json()) as PredictionsResponse;

      if (!res.ok || !json.ok) {
        setPredictions([]);
        setPredError(json.ok ? "Request failed" : json.error);
        return;
      }

      setPredictions(Array.isArray(json.predictions) ? json.predictions : []);
    } catch (e: any) {
      setPredictions([]);
      setPredError(e?.message ?? "Failed to load predictions");
    } finally {
      setPredLoading(false);
    }
  }

  function buildAuthMessage(
    addressLower: string,
    nonce: string,
    expiresAtIso: string,
  ) {
    return (
      `Calibra login\n` +
      `Address: ${addressLower}\n` +
      `Nonce: ${nonce}\n` +
      `Expires: ${expiresAtIso}`
    );
  }

  async function safeJson(res: Response) {
    try {
      return await res.json();
    } catch {
      return null;
    }
  }

  async function ensureWalletReady() {
    if (!isConnected) {
      const connector = connectors[0];
      if (!connector) throw new Error("No wallet connector available");
      await connectAsync({ connector });
    }

    if (chainId !== ADI_TESTNET_CHAIN_ID) {
      await switchChainAsync({ chainId: ADI_TESTNET_CHAIN_ID });
    }
  }

  async function loadFunderSubmissions() {
    setFunderSubsError(null);
    setFunderSubsRows([]);

    if (!batchId) {
      setFunderSubsError("Missing batchId");
      return;
    }

    try {
      setFunderSubsLoading(true);

      await ensureWalletReady();

      const addr = (address ?? "").toString().toLowerCase();
      if (!addr) throw new Error("Wallet not connected");

      const nonceRes = await fetch(
        `/api/auth/nonce?address=${encodeURIComponent(addr)}`,
        { method: "GET", cache: "no-store" },
      );
      const nonceJson = (await safeJson(nonceRes)) as any;

      if (!nonceRes.ok || !nonceJson?.ok) {
        throw new Error((nonceJson?.error ?? "Failed to get nonce").toString());
      }

      const nonce = (nonceJson?.nonce ?? "").toString();
      const expiresAtIso = (nonceJson?.expires_at ?? "").toString();
      const message = buildAuthMessage(addr, nonce, expiresAtIso);

      const signature = (await signMessageAsync({ message })) as Hex;

      const batchIdHash = batchIdToHash(batchId) as Hex;

      const listRes = await fetch("/api/submissions/list-for-funder", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          address: addr,
          signature,
          batchIdHash,
        }),
      });

      const listJson = (await safeJson(listRes)) as any;

      if (!listRes.ok || !listJson?.ok) {
        throw new Error(
          (listJson?.error ?? "Failed to load submissions").toString(),
        );
      }

      const rowsRaw = Array.isArray(listJson?.submissions)
        ? listJson.submissions
        : [];

      const normalized = rowsRaw
        .map((x: any) => {
          const createdAt = (x?.submission?.createdAt ??
            x?.submission?.created_at ??
            null) as string | null;

          const providerAddress =
            (
              x?.submission?.providerAddress ??
              x?.submission?.provider_address ??
              ""
            )?.toString() ?? "";

          const preds =
            x?.payload?.predictions && Array.isArray(x.payload.predictions)
              ? x.payload.predictions
              : [];

          const cleanedPreds = preds
            .map((p: any) => ({
              schedule_key: (p?.schedule_key ?? "").toString(),
              probabilities:
                p?.probabilities && typeof p.probabilities === "object"
                  ? (p.probabilities as Record<string, number>)
                  : {},
            }))
            .filter(
              (p: any) =>
                p.schedule_key && Object.keys(p.probabilities).length > 0,
            );

          return {
            providerAddress: providerAddress.toLowerCase(),
            createdAt,
            predictions: cleanedPreds,
          };
        })
        .filter((r: any) => r.providerAddress && r.predictions.length > 0);

      setFunderSubsRows(normalized);
      setLastSubsRefreshMs(Date.now());
    } catch (e: any) {
      setFunderSubsError(
        e?.shortMessage ?? e?.message ?? "Failed to load submissions",
      );
    } finally {
      setFunderSubsLoading(false);
    }
  }

  useEffect(() => {
    loadPredictions();
  }, [batchId]);

  async function handleUpdate() {
    if (!batchId) return;

    setUpdateError(null);

    const last = lastUpdateMs ?? readLastUpdateMs(batchId);
    const nextAllowedAt =
      typeof last === "number" ? last + UPDATE_COOLDOWN_MS : 0;

    if (nowMs < nextAllowedAt) {
      const waitMs = nextAllowedAt - nowMs;
      setUpdateError(
        `Please wait ${Math.ceil(waitMs / 1000)}s before updating again.`,
      );
      return;
    }

    setUpdateLoading(true);

    try {
      const res = await fetch(
        `/api/batches/refresh-flights?batchId=${encodeURIComponent(batchId)}`,
        { method: "POST" },
      );

      const json = (await res
        .json()
        .catch(() => null)) as RefreshFlightsResponse | null;

      if (!res.ok || !json || json.ok === false) {
        const msg =
          json && typeof (json as any).error === "string"
            ? (json as any).error
            : "Update failed";

        const retryMs =
          json && typeof (json as any).retry_after_ms === "number"
            ? Math.max(0, Math.ceil((json as any).retry_after_ms))
            : null;

        if (res.status === 429 && retryMs !== null) {
          const t = Date.now();
          const serverLast = t - (UPDATE_COOLDOWN_MS - retryMs);
          setLastUpdateMs(serverLast);
          writeLastUpdateMs(batchId, serverLast);
          setUpdateError(
            `Please wait ${Math.ceil(retryMs / 1000)}s before updating again.`,
          );
          return;
        }

        throw new Error(msg);
      }

      const t = Date.now();
      setLastUpdateMs(t);
      writeLastUpdateMs(batchId, t);

      await Promise.all([loadBatchEnriched(), loadPredictions()]);
    } catch (e: any) {
      setUpdateError(e?.message ?? "Update failed");
    } finally {
      setUpdateLoading(false);
    }
  }

  const predictionRows = useMemo(() => {
    const rows: BatchPredictionRow[] = [];

    for (const p of predictions) {
      rows.push({
        schedule_key: p.schedule_key,
        provider_address: p.model ? p.model.toLowerCase() : null,
        outcome: p.outcome,
        confidence: p.confidence,
        created_at: p.created_at,
        probabilities: p.probabilities ?? null,
      });
    }

    for (const sub of funderSubsRows) {
      for (const p of sub.predictions) {
        rows.push({
          schedule_key: p.schedule_key,
          provider_address: sub.providerAddress,
          outcome: null,
          confidence: null,
          created_at: sub.createdAt ?? null,
          probabilities: p.probabilities ?? null,
        });
      }
    }

    return keepLatestPerProvider(rows);
  }, [predictions, funderSubsRows]);

  const aggregatedPredictionRows = useMemo(() => {
    return aggregateLatestPerModel(predictionRows, aggregationMode, nowMs);
  }, [predictionRows, aggregationMode, nowMs]);

  const predictionColumns = useMemo(() => {
    return buildThresholdColumns(batch?.thresholds_minutes ?? null);
  }, [batch?.thresholds_minutes]);

  const windowStartIso = batch?.prediction_window_start_at ?? null;
  const windowEndIso = batch?.prediction_window_end_at ?? null;

  const windowState = useMemo(() => {
    const startMs = windowStartIso ? new Date(windowStartIso).getTime() : NaN;
    const endMs = windowEndIso ? new Date(windowEndIso).getTime() : NaN;

    const startOk = Number.isFinite(startMs);
    const endOk = Number.isFinite(endMs);

    if (!startOk || !endOk) {
      return {
        label: "Not Available",
        badgeClass:
          "border-zinc-200 bg-white text-zinc-700 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-200",
        countdownLabel: null as string | null,
        countdownValue: null as string | null,
      };
    }

    if (nowMs < startMs) {
      return {
        label: "Not Started",
        badgeClass:
          "border-zinc-200 bg-white text-zinc-700 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-200",
        countdownLabel: "Starts In",
        countdownValue: fmtCountdown(startMs - nowMs),
      };
    }

    if (nowMs >= startMs && nowMs < endMs) {
      return {
        label: "Open",
        badgeClass:
          "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900/50 dark:bg-emerald-950/30 dark:text-emerald-200",
        countdownLabel: "Closes In",
        countdownValue: fmtCountdown(endMs - nowMs),
      };
    }

    return {
      label: "Closed",
      badgeClass:
        "border-red-200 bg-red-50 text-red-800 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-emerald-200",
      countdownLabel: "Closed",
      countdownValue: "00:00:00",
    };
  }, [nowMs, windowStartIso, windowEndIso]);

  const nextAllowedMs =
    typeof lastUpdateMs === "number" ? lastUpdateMs + UPDATE_COOLDOWN_MS : 0;

  const updateDisabled =
    isLoading || predLoading || updateLoading || nowMs < nextAllowedMs;

  const updateMetaText =
    typeof lastUpdateMs === "number"
      ? nowMs < nextAllowedMs
        ? `Next update in ${Math.ceil((nextAllowedMs - nowMs) / 1000)}s`
        : `Last update: ${fmtIsoLocal(new Date(lastUpdateMs).toISOString())}`
      : " ";

  return (
    <div className="flex min-h-screen items-center justify-center bg-zinc-50 font-sans dark:bg-black">
      <main className="w-full max-w-6xl px-6 py-12">
        <div className="rounded-2xl bg-white p-8 shadow-sm dark:bg-zinc-950">
          <div className="flex items-start justify-between gap-6">
            <div className="flex flex-col gap-2">
              <h1 className="text-2xl font-semibold tracking-tight text-zinc-950 dark:text-zinc-50">
                Batch
              </h1>
              <div className="text-sm text-zinc-600 dark:text-zinc-400">
                Batch ID: <span className="font-mono">{batchId}</span>
              </div>
            </div>

            <div className="flex items-center gap-3">
              {isConnected && addr ? (
                <div className="flex flex-col items-end gap-1">
                  <div className="text-[11px] text-zinc-500 dark:text-zinc-400">
                    <span className="font-mono">
                      {addr.slice(0, 6)}…{addr.slice(-4)}
                    </span>
                  </div>

                  <div className="text-[11px] text-zinc-500 dark:text-zinc-400">
                    ADI: {adiFormatted}
                  </div>

                  <div className="text-[11px] text-zinc-500 dark:text-zinc-400">
                    USDC: {usdcFormatted}{" "}
                    {typeof usdcSymbol === "string" ? usdcSymbol : ""}
                  </div>
                </div>
              ) : null}

              <button
                onClick={() => router.push("/")}
                className="inline-flex h-9 items-center justify-center rounded-full border border-zinc-200 bg-white px-4 text-xs font-medium text-zinc-900 transition hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-50 dark:hover:bg-black"
              >
                Back
              </button>
            </div>
          </div>

          {error ? (
            <div className="mt-6 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-200">
              <div className="font-medium">Error</div>
              <div className="mt-1">{error}</div>
            </div>
          ) : null}

          {predError ? (
            <div className="mt-6 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-200">
              <div className="font-medium">Predictions</div>
              <div className="mt-1">{predError}</div>
            </div>
          ) : null}

          {funderSubsError ? (
            <div className="mt-6 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-200">
              {funderSubsError}
            </div>
          ) : null}

          {updateError ? (
            <div className="mt-6 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-200">
              {updateError}
            </div>
          ) : null}

          <div className="mt-6 rounded-xl border border-zinc-200 p-4 dark:border-zinc-800">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div className="flex flex-col gap-2">
                <div className="flex items-center gap-2">
                  <div className="text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
                    Prediction Window
                  </div>
                  <div
                    className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium ${windowState.badgeClass}`}
                  >
                    {windowState.label}
                  </div>
                </div>

                <div className="flex flex-col gap-1">
                  <div className="text-[11px] text-zinc-500 dark:text-zinc-400">
                    Start:{" "}
                    <span className="font-mono text-zinc-700 dark:text-zinc-200">
                      {fmtIsoInTimeZone(windowStartIso, tz)}
                    </span>
                  </div>
                  <div className="text-[11px] text-zinc-500 dark:text-zinc-400">
                    End:{" "}
                    <span className="font-mono text-zinc-700 dark:text-zinc-200">
                      {fmtIsoInTimeZone(windowEndIso, tz)}
                    </span>
                  </div>

                  <div className="mt-1 flex flex-wrap items-center gap-x-6 gap-y-1 text-[11px] text-zinc-500 dark:text-zinc-400">
                    <div>
                      Bounty:{" "}
                      <span className="font-mono text-zinc-700 dark:text-zinc-200">
                        {bountyText}
                      </span>
                    </div>
                  </div>
                </div>
              </div>

              <div className="flex flex-col gap-2 sm:items-end">
                <div className="text-[11px] text-zinc-500 dark:text-zinc-400">
                  Time Zone:{" "}
                  <span className="font-mono text-zinc-700 dark:text-zinc-200">
                    {tz}
                  </span>
                </div>

                <div className="text-[11px] text-zinc-500 dark:text-zinc-400">
                  Current Time:{" "}
                  <span className="font-mono font-semibold text-zinc-900 dark:text-zinc-50">
                    {fmtIsoInTimeZone(new Date(nowMs).toISOString(), tz)}
                  </span>
                </div>

                {windowState.countdownLabel && windowState.countdownValue ? (
                  <div className="mt-1 flex items-center gap-2 sm:justify-end">
                    <div className="text-xs text-zinc-600 dark:text-zinc-300">
                      {windowState.countdownLabel}
                    </div>
                    <div className="font-mono text-sm font-semibold text-zinc-900 dark:text-zinc-50">
                      {windowState.countdownValue}
                    </div>
                  </div>
                ) : null}
              </div>
            </div>
          </div>

          <div className="mt-8 rounded-2xl border border-zinc-200 p-5 dark:border-zinc-800">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex flex-col gap-1">
                <div className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">
                  Flights
                </div>
              </div>

              <div className="flex items-center gap-2 sm:justify-end">
                <div className="text-xs text-zinc-500 dark:text-zinc-400">
                  Created:{" "}
                  <span className="font-mono">
                    {fmtIsoLocal(batch?.created_at ?? null)}
                  </span>
                </div>
              </div>
            </div>

            <BatchFlightsTable
              flights={flights}
              predictions={predictionRows}
              isLoading={isLoading}
              displayTimeZone={tz}
              onUpdate={handleUpdate}
              updateDisabled={updateDisabled}
              updateLabel={updateLoading ? "Updating…" : "Update Flights"}
              updateMetaText={updateMetaText}
            />

            <div className="mt-10">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex flex-col gap-1">
                  <div className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">
                    Predictions
                  </div>
                </div>

                <div className="flex items-center gap-2 sm:justify-end">
                  <div className="text-[11px] text-zinc-500 dark:text-zinc-400">
                    Aggregate:
                  </div>

                  <select
                    value={aggregationMode}
                    onChange={(e) =>
                      setAggregationMode(e.target.value as AggregationMode)
                    }
                    className="h-9 rounded-full border border-zinc-200 bg-white px-3 text-xs font-medium text-zinc-900 transition hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-50 dark:hover:bg-black"
                  >
                    <option value="avg_latest">
                      Average of latest submissions
                    </option>
                    <option value="time_weighted_latest">
                      Time-weighted average of latest submissions
                    </option>
                  </select>
                </div>
              </div>

              <BatchPredictionsTable
                flights={flights}
                predictions={[...aggregatedPredictionRows, ...predictionRows]}
                isLoading={isLoading || predLoading}
                thresholdsMinutes={batch?.thresholds_minutes ?? null}
                onRefresh={loadFunderSubmissions}
                refreshDisabled={funderSubsLoading}
                refreshLabel={
                  funderSubsLoading
                    ? "Loading…"
                    : isConnected
                      ? "Refresh Submissions"
                      : "Connect + Load Submissions"
                }
                refreshMetaText={
                  typeof lastSubsRefreshMs === "number"
                    ? `Last refresh: ${fmtIsoLocal(new Date(lastSubsRefreshMs).toISOString())}`
                    : " "
                }
              />
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
