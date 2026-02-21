// calibra/src/app/submit/[batchId]/page.tsx
"use client";

import React, { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import PredictionsTable from "./components/PredictionsTable";
import {
  useAccount,
  useChainId,
  useConnect,
  useDisconnect,
  usePublicClient,
  useSignMessage,
  useSwitchChain,
  useWriteContract,
} from "wagmi";
import { formatUnits, type Address, type Hex } from "viem";
import {
  ADI_TESTNET_CHAIN_ID,
  batchIdToHash,
  CALIBRA_PROTOCOL,
  CALIBRA_PROTOCOL_ABI,
  MOCK_USDC,
  USDC_ABI,
} from "@/lib/calibraOnchain";

type BatchFlight = {
  schedule_key: string;
  airline: string;
  flight_number: string;
  origin: string;
  destination: string;
  scheduled_depart_iso: string | null;
  scheduled_arrive_iso: string | null;
};

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
      };
      flights: BatchFlight[];
    }
  | { ok: false; error: string; details?: unknown };

type BatchInfo = Extract<BatchGetResponse, { ok: true }>["batch"];

type OnchainBatch = {
  exists: boolean;
  operator: Address;
  funder: Address;
  windowStart: bigint;
  windowEnd: bigint;
  revealDeadline: bigint;
  funded: boolean;
  finalized: boolean;
  joinBond: bigint;
};

type ProviderSummary = {
  joined: boolean;
  joinedAt: bigint;
  commitCount: bigint;
  revealedCount: bigint;
  lastCommitAt: bigint;
  bond: bigint;
  bondSettled: boolean;
  payout: bigint;
  payoutClaimed: boolean;
};

type Phase =
  | "loading"
  | "prewindow"
  | "commit"
  | "reveal"
  | "postreveal"
  | "finalized";

function isHex(s: string) {
  return /^0x[0-9a-fA-F]*$/.test(s);
}

function nowSecBigint() {
  return BigInt(Math.floor(Date.now() / 1000));
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

const USDC_DECIMALS = 6;

function fmtUsdc(x: bigint) {
  const s = formatUnits(x, USDC_DECIMALS);
  const [a, bRaw] = s.split(".");
  const b = (bRaw ?? "").slice(0, 2).padEnd(2, "0");
  return `$${a}.${b}`;
}

function buildAuthMessage(
  address: string,
  nonce: string,
  expiresAtIso: string,
) {
  return (
    `Calibra login\n` +
    `Address: ${address}\n` +
    `Nonce: ${nonce}\n` +
    `Expires: ${expiresAtIso}`
  );
}

function base64ToHex(b64: string): Hex {
  const bin = atob(b64);
  let hex = "0x";
  for (let i = 0; i < bin.length; i += 1) {
    const h = bin.charCodeAt(i).toString(16).padStart(2, "0");
    hex += h;
  }
  return hex as Hex;
}

async function safeJson(res: Response) {
  try {
    return await res.json();
  } catch {
    return null;
  }
}

function ErrorBanner(props: { title: string; message: string }) {
  return (
    <div className="mt-6 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-200">
      <div className="font-medium">{props.title}</div>
      <div className="mt-1 break-words">{props.message}</div>
    </div>
  );
}

function OkBanner(props: { title: string; message: string }) {
  return (
    <div className="mt-6 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800 dark:border-emerald-900/50 dark:bg-emerald-950/30 dark:text-emerald-200">
      <div className="font-medium">{props.title}</div>
      <div className="mt-1 break-words">{props.message}</div>
    </div>
  );
}

function NoteBanner(props: { title: string; message: string }) {
  return (
    <div className="mt-6 rounded-xl border border-zinc-200 bg-white p-4 text-sm text-zinc-700 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-200">
      <div className="font-medium">{props.title}</div>
      <div className="mt-1 break-words text-zinc-600 dark:text-zinc-300">
        {props.message}
      </div>
    </div>
  );
}

function SubmitHeader(props: {
  batchId: string;
  isConnected: boolean;
  onConnect: () => void;
  onDisconnect: () => void;
  onBack: () => void;
}) {
  return (
    <div className="flex items-start justify-between gap-6">
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold tracking-tight text-zinc-950 dark:text-zinc-50">
          Submit Predictions
        </h1>
        <div className="text-sm text-zinc-600 dark:text-zinc-400">
          Batch ID: <span className="font-mono">{props.batchId}</span>
        </div>
      </div>

      <div className="flex items-center gap-2">
        {props.isConnected ? (
          <button
            onClick={props.onDisconnect}
            className="inline-flex h-9 items-center justify-center rounded-full border border-zinc-200 bg-white px-4 text-xs font-medium text-zinc-900 transition hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-50 dark:hover:bg-black"
          >
            Disconnect
          </button>
        ) : (
          <button
            onClick={props.onConnect}
            className="inline-flex h-9 items-center justify-center rounded-full bg-zinc-900 px-4 text-xs font-medium text-white transition hover:bg-zinc-800 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-200"
          >
            Connect Wallet
          </button>
        )}

        <button
          onClick={props.onBack}
          className="inline-flex h-9 items-center justify-center rounded-full border border-zinc-200 bg-white px-4 text-xs font-medium text-zinc-900 transition hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-50 dark:hover:bg-black"
        >
          Back
        </button>
      </div>
    </div>
  );
}

function PredictionWindowCard(props: {
  tz: string;
  nowMs: number;
  isOnchainLoading: boolean;
  onchainBatch: OnchainBatch | null;
  bountyBaseUnits: bigint | null;
  derivedBondBaseUnits: bigint | null;
}) {
  const windowState = useMemo(() => {
    const b = props.onchainBatch;

    if (!b?.exists) {
      return {
        label: props.isOnchainLoading ? "Loading…" : "Not Available",
        badgeClass:
          "border-zinc-200 bg-white text-zinc-700 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-200",
        countdownLabel: null as string | null,
        countdownValue: null as string | null,
        startIso: null as string | null,
        endIso: null as string | null,
      };
    }

    const startMs = Number(b.windowStart) * 1000;
    const endMs = Number(b.windowEnd) * 1000;

    const startOk = Number.isFinite(startMs);
    const endOk = Number.isFinite(endMs);

    if (!startOk || !endOk) {
      return {
        label: "Not Available",
        badgeClass:
          "border-zinc-200 bg-white text-zinc-700 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-200",
        countdownLabel: null,
        countdownValue: null,
        startIso: null,
        endIso: null,
      };
    }

    const startIso = new Date(startMs).toISOString();
    const endIso = new Date(endMs).toISOString();

    if (props.nowMs < startMs) {
      return {
        label: "Not Started",
        badgeClass:
          "border-zinc-200 bg-white text-zinc-700 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-200",
        countdownLabel: "Starts In",
        countdownValue: fmtCountdown(startMs - props.nowMs),
        startIso,
        endIso,
      };
    }

    if (props.nowMs >= startMs && props.nowMs < endMs) {
      return {
        label: "Open",
        badgeClass:
          "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900/50 dark:bg-emerald-950/30 dark:text-emerald-200",
        countdownLabel: "Closes In",
        countdownValue: fmtCountdown(endMs - props.nowMs),
        startIso,
        endIso,
      };
    }

    return {
      label: "Closed",
      badgeClass:
        "border-red-200 bg-red-50 text-red-800 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-emerald-200",
      countdownLabel: "Closed",
      countdownValue: "00:00:00",
      startIso,
      endIso,
    };
  }, [props.onchainBatch, props.isOnchainLoading, props.nowMs]);

  return (
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
                {fmtIsoInTimeZone(windowState.startIso, props.tz)}
              </span>
            </div>
            <div className="text-[11px] text-zinc-500 dark:text-zinc-400">
              End:{" "}
              <span className="font-mono text-zinc-700 dark:text-zinc-200">
                {fmtIsoInTimeZone(windowState.endIso, props.tz)}
              </span>
            </div>

            <div className="mt-1 flex flex-wrap items-center gap-x-6 gap-y-1 text-[11px] text-zinc-500 dark:text-zinc-400">
              <div>
                Bounty:{" "}
                <span className="font-mono text-zinc-700 dark:text-zinc-200">
                  {props.bountyBaseUnits === null
                    ? "—"
                    : fmtUsdc(props.bountyBaseUnits)}
                </span>
              </div>

              <div>
                Bond:{" "}
                <span className="font-mono text-zinc-700 dark:text-zinc-200">
                  {props.derivedBondBaseUnits === null
                    ? "—"
                    : fmtUsdc(props.derivedBondBaseUnits)}
                </span>
              </div>
            </div>
          </div>
        </div>

        <div className="flex flex-col gap-2 sm:items-end">
          <div className="text-[11px] text-zinc-500 dark:text-zinc-400">
            Time Zone:{" "}
            <span className="font-mono text-zinc-700 dark:text-zinc-200">
              {props.tz}
            </span>
          </div>

          <div className="text-[11px] text-zinc-500 dark:text-zinc-400">
            Current Time:{" "}
            <span className="font-mono font-semibold text-zinc-900 dark:text-zinc-50">
              {fmtIsoInTimeZone(new Date(props.nowMs).toISOString(), props.tz)}
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
  );
}

function ActionBar(props: {
  isSubmitting: boolean;
  canJoin: boolean;
  onJoin: () => void;
  isJoined: boolean;
}) {
  return (
    <div className="mt-4 flex flex-wrap items-center gap-2">
      <button
        onClick={props.onJoin}
        disabled={props.isJoined || !props.canJoin || props.isSubmitting}
        className={
          props.isJoined
            ? "inline-flex h-9 items-center justify-center rounded-xl border border-zinc-200 bg-white px-4 text-sm font-medium text-zinc-900 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-50"
            : "inline-flex h-9 items-center justify-center rounded-xl bg-zinc-900 px-4 text-sm font-medium text-white transition hover:bg-zinc-800 disabled:opacity-60 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-200"
        }
      >
        {props.isSubmitting ? "Working…" : props.isJoined ? "Joined" : "Join"}
      </button>
    </div>
  );
}

function ClaimableAuditCard(props: {
  batchId: string;
  isOnchainLoading: boolean;
  onchainBatch: OnchainBatch | null;
  provider: ProviderSummary | null;
  onOpenAudit: () => void;
}) {
  const p = props.provider;
  const b = props.onchainBatch;

  if (!p?.joined) return null;

  const finalized = b?.finalized === true;
  const rewardClaimable = finalized && !p.payoutClaimed ? p.payout : BigInt(0);
  const bondLocked = !p.bondSettled ? p.bond : BigInt(0);

  return (
    <div className="mt-6 rounded-2xl border border-zinc-200 p-5 dark:border-zinc-800">
      <div className="flex flex-col gap-1">
        <div className="text-sm font-medium text-zinc-900 dark:text-zinc-50">
          Claimable & Audit
        </div>
        <div className="text-xs text-zinc-500 dark:text-zinc-400">
          {props.isOnchainLoading
            ? "Loading on-chain state…"
            : finalized
              ? "Batch finalized — rewards can now be claimed from the contract."
              : "Not finalized — rewards are not computed yet."}
        </div>
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        <div className="rounded-xl border border-zinc-200 p-4 dark:border-zinc-800">
          <div className="text-[11px] text-zinc-500 dark:text-zinc-400">
            Reward (claimable)
          </div>
          <div className="mt-1 text-lg font-semibold text-zinc-900 dark:text-zinc-50">
            {fmtUsdc(rewardClaimable)}
          </div>
          <div className="mt-1 text-[11px] text-zinc-500 dark:text-zinc-400">
            {finalized
              ? p.payoutClaimed
                ? "Already claimed"
                : "Unclaimed"
              : "Pending finalization"}
          </div>
        </div>

        <div className="rounded-xl border border-zinc-200 p-4 dark:border-zinc-800">
          <div className="text-[11px] text-zinc-500 dark:text-zinc-400">
            Bond
          </div>
          <div className="mt-1 text-lg font-semibold text-zinc-900 dark:text-zinc-50">
            {fmtUsdc(p.bond)}
          </div>
          <div className="mt-1 text-[11px] text-zinc-500 dark:text-zinc-400">
            {p.bondSettled ? "Settled in finalize()" : "Locked in contract"}
          </div>
        </div>

        <div className="rounded-xl border border-zinc-200 p-4 dark:border-zinc-800">
          <div className="text-[11px] text-zinc-500 dark:text-zinc-400">
            Status
          </div>
          <div className="mt-1 text-lg font-semibold text-zinc-900 dark:text-zinc-50">
            {finalized ? "Finalized" : "Active"}
          </div>
          <div className="mt-1 text-[11px] text-zinc-500 dark:text-zinc-400">
            {finalized
              ? "Bond refunded/slashed during finalize()"
              : bondLocked > BigInt(0)
                ? "Bond will be refunded/slashed on finalize()"
                : "—"}
          </div>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <button
          onClick={props.onOpenAudit}
          className="inline-flex h-9 items-center justify-center rounded-xl border border-zinc-200 bg-white px-4 text-sm font-medium text-zinc-900 transition hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-50 dark:hover:bg-black"
        >
          View Public Audit
        </button>
      </div>
    </div>
  );
}

function useEnrichedBatch(batchId: string) {
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [batch, setBatch] = useState<BatchInfo | null>(null);
  const [flights, setFlights] = useState<BatchFlight[]>([]);

  useEffect(() => {
    let alive = true;

    async function run() {
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

        const json = (await safeJson(res)) as BatchGetResponse | null;

        if (!res.ok || !json || !json.ok) {
          const msg =
            json && !json.ok ? json.error : "Request failed (get-enriched)";
          setError(msg);
          setIsLoading(false);
          return;
        }

        if (!alive) return;

        setBatch(json.batch);
        setFlights(Array.isArray(json.flights) ? json.flights : []);
      } catch (e: any) {
        if (!alive) return;
        setError(e?.message ?? "Failed to load batch");
      } finally {
        if (!alive) return;
        setIsLoading(false);
      }
    }

    run();
    return () => {
      alive = false;
    };
  }, [batchId]);

  return { isLoading, error, batch, flights };
}

function useOnchainState(params: {
  batchId: string;
  address: Address | null;
  publicClient: any;
}) {
  const { batchId, address, publicClient } = params;

  const [isOnchainLoading, setIsOnchainLoading] = useState(true);
  const [onchainError, setOnchainError] = useState<string | null>(null);
  const [onchainBatch, setOnchainBatch] = useState<OnchainBatch | null>(null);
  const [provider, setProvider] = useState<ProviderSummary | null>(null);

  const batchIdHash = useMemo(() => {
    if (!batchId) return null;
    return batchIdToHash(batchId);
  }, [batchId]);

  const phase = useMemo<Phase>(() => {
    const b = onchainBatch;
    if (!b) return "loading";

    const t = nowSecBigint();
    if (b.finalized) return "finalized";
    if (t < b.windowStart) return "prewindow";
    if (t >= b.windowStart && t < b.windowEnd) return "commit";
    if (t >= b.windowEnd && t <= b.revealDeadline) return "reveal";
    return "postreveal";
  }, [onchainBatch]);

  async function loadOnchain() {
    setIsOnchainLoading(true);
    setOnchainError(null);

    try {
      if (!publicClient) throw new Error("No public client");
      if (!batchIdHash) throw new Error("Missing batchIdHash");

      const res = (await publicClient.readContract({
        address: CALIBRA_PROTOCOL,
        abi: CALIBRA_PROTOCOL_ABI,
        functionName: "getBatch",
        args: [batchIdHash],
      })) as unknown as readonly [
        boolean,
        Address,
        Address,
        bigint,
        bigint,
        bigint,
        Hex,
        boolean,
        bigint,
        Hex,
        Hex,
        boolean,
        boolean,
        bigint,
        bigint,
        number,
        Hex,
        number,
        number,
        boolean,
      ];

      const exists = res[0];
      if (!exists) {
        setOnchainBatch(null);
        setProvider(null);
        setOnchainError("Batch not found on-chain");
        return;
      }

      setOnchainBatch({
        exists,
        operator: res[1],
        funder: res[2],
        windowStart: res[3],
        windowEnd: res[4],
        revealDeadline: res[5],
        funded: res[11],
        finalized: res[12],
        joinBond: res[14],
      });

      if (address) {
        const ps = (await publicClient.readContract({
          address: CALIBRA_PROTOCOL,
          abi: CALIBRA_PROTOCOL_ABI,
          functionName: "getProviderSummary",
          args: [batchIdHash, address],
        })) as unknown as readonly [
          boolean,
          bigint,
          number,
          number,
          bigint,
          bigint,
          boolean,
          bigint,
          boolean,
        ];

        setProvider({
          joined: ps[0],
          joinedAt: ps[1],
          commitCount: BigInt(ps[2]),
          revealedCount: BigInt(ps[3]),
          lastCommitAt: ps[4],
          bond: ps[5],
          bondSettled: ps[6],
          payout: ps[7],
          payoutClaimed: ps[8],
        });
      } else {
        setProvider(null);
      }
    } catch (e: any) {
      setOnchainError(
        e?.shortMessage ?? e?.message ?? "Failed to load on-chain",
      );
    } finally {
      setIsOnchainLoading(false);
    }
  }

  useEffect(() => {
    if (!publicClient) return;
    if (!batchIdHash) return;
    loadOnchain();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [publicClient, batchIdHash, address]);

  return {
    batchIdHash,
    isOnchainLoading,
    onchainError,
    onchainBatch,
    provider,
    phase,
    loadOnchain,
  };
}

function readBountyBaseUnitsFromBatch(batch: BatchInfo | null): bigint | null {
  if (!batch) return null;
  const b: any = batch as any;

  const baseUnitCandidates = [
    b.bounty_amount_base_units,
    b.bountyAmountBaseUnits,
    b.bounty_usdc_base,
    b.bountyUsdcBase,
    b.bounty_amount_base,
    b.bountyAmountBase,
  ];

  for (const v of baseUnitCandidates) {
    if (v === null || v === undefined) continue;
    try {
      if (typeof v === "bigint") return v;
      if (typeof v === "number" && Number.isFinite(v))
        return BigInt(Math.trunc(v));
      if (typeof v === "string") {
        const s = v.trim();
        if (!s) continue;
        if (/^[0-9]+$/.test(s)) return BigInt(s);
      }
    } catch {
      continue;
    }
  }

  const usdcCandidates = [
    b.bounty_amount,
    b.bountyAmount,
    b.bounty,
    b.bountyUsdc,
    b.bounty_usdc,
    b.bountyAmountUsdc,
  ];

  for (const v of usdcCandidates) {
    if (v === null || v === undefined) continue;

    try {
      if (typeof v === "number" && Number.isFinite(v)) {
        const micros = Math.round(v * 1_000_000);
        return BigInt(micros);
      }

      if (typeof v === "string") {
        const s0 = v.trim();
        if (!s0) continue;

        // allow "10000", "10000.00"
        if (!/^[0-9]+(\.[0-9]+)?$/.test(s0)) continue;

        const [whole, fracRaw] = s0.split(".");
        const frac = (fracRaw ?? "").slice(0, 6).padEnd(6, "0");
        return BigInt(whole) * BigInt(1_000_000) + BigInt(frac || "0");
      }
    } catch {
      continue;
    }
  }

  return null;
}

function deriveBondFromBountyBaseUnits(bountyBaseUnits: bigint): bigint {
  return bountyBaseUnits / BigInt(10);
}

export default function SubmitBatchPage() {
  const router = useRouter();
  const params = useParams<{ batchId: string }>();
  const batchId = (params?.batchId ?? "").toString();

  const [predByScheduleKey, setPredByScheduleKey] = useState<
    Record<string, Record<string, string>>
  >({});

  const [uiError, setUiError] = useState<string | null>(null);
  const [uiOk, setUiOk] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const { address, isConnected } = useAccount();
  const chainId = useChainId();
  const { connectAsync, connectors } = useConnect();
  const { disconnect } = useDisconnect();
  const { switchChainAsync } = useSwitchChain();
  const publicClient = usePublicClient();
  const { writeContractAsync } = useWriteContract();
  const { signMessageAsync } = useSignMessage();

  const addr = useMemo(
    () => (address ? (address as Address) : null),
    [address],
  );

  const { isLoading, error, batch, flights } = useEnrichedBatch(batchId);

  const tz = useMemo(() => {
    const v = (batch?.display_time_zone ?? "UTC").toString();
    return v || "UTC";
  }, [batch]);

  const bountyBaseUnits = useMemo(
    () => readBountyBaseUnitsFromBatch(batch),
    [batch],
  );

  const derivedBondBaseUnits = useMemo(() => {
    if (bountyBaseUnits === null) return null;
    try {
      return deriveBondFromBountyBaseUnits(bountyBaseUnits);
    } catch {
      return null;
    }
  }, [bountyBaseUnits]);

  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNowMs(Date.now()), 250);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    setPredByScheduleKey((prev) => {
      const next: Record<string, Record<string, string>> = { ...prev };
      for (const f of flights) {
        const key = (f.schedule_key ?? "").trim();
        if (!key) continue;
        if (!next[key]) next[key] = {};
      }
      return next;
    });
  }, [flights]);

  const {
    batchIdHash,
    isOnchainLoading,
    onchainError,
    onchainBatch,
    provider,
    phase,
    loadOnchain,
  } = useOnchainState({
    batchId,
    address: addr,
    publicClient,
  });

  async function ensureWalletReady(): Promise<Address> {
    let activeAddress = addr;

    if (!isConnected) {
      const connector = connectors[0];
      if (!connector) throw new Error("No wallet connector available");

      const res = await connectAsync({ connector });
      const first = Array.isArray(res.accounts) ? res.accounts[0] : null;

      if (!first) throw new Error("Wallet connected but no account returned");
      activeAddress = first as Address;
    }

    if (chainId !== ADI_TESTNET_CHAIN_ID) {
      await switchChainAsync({ chainId: ADI_TESTNET_CHAIN_ID });
    }

    if (!activeAddress) throw new Error("Wallet not connected");
    return activeAddress;
  }

  async function ensureAllowanceAtLeast(required: bigint) {
    if (!publicClient) throw new Error("No public client");
    if (!addr) throw new Error("Wallet not connected");

    const allowance = (await publicClient.readContract({
      address: MOCK_USDC,
      abi: USDC_ABI,
      functionName: "allowance",
      args: [addr, CALIBRA_PROTOCOL],
    })) as unknown as bigint;

    if (allowance >= required) return;

    const approveHash = await writeContractAsync({
      address: MOCK_USDC,
      abi: USDC_ABI,
      functionName: "approve",
      args: [CALIBRA_PROTOCOL, required],
      chainId: ADI_TESTNET_CHAIN_ID,
    });

    await publicClient.waitForTransactionReceipt({ hash: approveHash });
  }

  async function getNonceForSignature(addressLower: string) {
    const res = await fetch(
      `/api/auth/nonce?address=${encodeURIComponent(addressLower)}`,
      { method: "GET", cache: "no-store" },
    );

    const json = (await safeJson(res)) as any;

    if (!res.ok || !json?.ok) {
      throw new Error((json?.error ?? "Failed to get nonce").toString());
    }

    const nonce = (json?.nonce ?? "").toString();
    const expiresAt = (
      json?.expires_at ??
      json?.expiresAt ??
      json?.expiresAtIso ??
      ""
    ).toString();

    if (!nonce || !expiresAt) throw new Error("Bad nonce response");
    return { nonce, expiresAt };
  }

  async function authedPost(path: string, addressLower: string, body: any) {
    const { nonce, expiresAt } = await getNonceForSignature(addressLower);
    const message = buildAuthMessage(addressLower, nonce, expiresAt);
    const signature = (await signMessageAsync({ message })) as Hex;

    const res = await fetch(path, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        address: addressLower,
        signature,
        ...body,
      }),
    });

    const json = await safeJson(res);
    return { res, json };
  }

  async function onJoin() {
    setUiError(null);
    setUiOk(null);

    try {
      setIsSubmitting(true);

      if (!batchIdHash) throw new Error("Missing batchIdHash");
      if (!publicClient) throw new Error("No public client");

      const activeAddr = await ensureWalletReady();
      const b = onchainBatch;
      if (!b?.exists) throw new Error("Batch not loaded");
      if (!b.funded) throw new Error("Batch is not funded");
      if (b.joinBond <= BigInt(0)) throw new Error("Join bond not set");

      await ensureAllowanceAtLeast(b.joinBond);

      const joinHash = await writeContractAsync({
        address: CALIBRA_PROTOCOL,
        abi: CALIBRA_PROTOCOL_ABI,
        functionName: "join",
        args: [batchIdHash],
        chainId: ADI_TESTNET_CHAIN_ID,
      });

      await publicClient.waitForTransactionReceipt({ hash: joinHash });

      const joinedBefore = provider?.joined === true;
      const addrLower = activeAddr.toLowerCase();

      if (!joinedBefore) {
        const { res, json } = await authedPost(
          "/api/batches/increment-bonded-model-count",
          addrLower,
          {
            batchId,
            providerAddress: addrLower,
          },
        );

        if (!res.ok || !json?.ok) {
          const details =
            (
              json?.details ??
              json?.error ??
              "Failed to increment bonded_model_count"
            )?.toString?.() ?? "Failed to increment bonded_model_count";
          throw new Error(details);
        }
      }

      setUiOk("Joined. You can now submit during the prediction window.");
      await loadOnchain();
    } catch (e: any) {
      setUiError(e?.shortMessage ?? e?.message ?? "Join failed");
    } finally {
      setIsSubmitting(false);
    }
  }

  async function onSubmit() {
    setUiError(null);
    setUiOk(null);

    if (flights.length === 0) {
      setUiError("No flights to predict for this batch");
      return;
    }

    const b = onchainBatch;
    if (!b?.exists) {
      setUiError("On-chain batch not loaded yet");
      return;
    }

    if (phase !== "commit") {
      setUiError("Submissions are only allowed during the prediction window.");
      return;
    }

    if (!provider?.joined) {
      setUiError("You must join before submitting.");
      return;
    }

    if (!batchIdHash) {
      setUiError("Missing batchIdHash");
      return;
    }

    const payload: {
      schedule_key: string;
      probabilities: Record<string, number>;
    }[] = [];

    for (const f of flights) {
      const key = (f.schedule_key ?? "").trim();
      if (!key) continue;

      const row = predByScheduleKey[key] ?? {};
      const probs: Record<string, number> = {};

      for (const [label, raw0] of Object.entries(row)) {
        const raw = (raw0 ?? "").trim();
        if (!raw) continue;

        const x = Number(raw);
        if (!Number.isFinite(x) || x < 0 || x > 100) {
          setUiError(`Invalid probability for ${key} (${label}). Use 0–100.`);
          return;
        }

        probs[label] = Math.round(x * 100) / 100;
      }

      if (Object.keys(probs).length === 0) continue;

      payload.push({
        schedule_key: key,
        probabilities: probs,
      });
    }

    if (payload.length === 0) {
      setUiError("Enter at least one prediction to submit");
      return;
    }

    try {
      setIsSubmitting(true);

      if (!publicClient) throw new Error("No public client");

      await ensureWalletReady();

      if (!addr) throw new Error("Wallet not connected");

      const addressLower = addr.toLowerCase();
      const { nonce, expiresAt } = await getNonceForSignature(addressLower);

      const message = buildAuthMessage(addressLower, nonce, expiresAt);
      const signature = (await signMessageAsync({ message })) as Hex;

      const uploadRes = await fetch("/api/submissions/upload", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          address: addressLower,
          signature,
          batchId,
          batchIdHash,
          created_at_unix: Math.floor(Date.now() / 1000),
          provider_address: addressLower,
          payload,
        }),
      });

      const uploadJson = (await safeJson(uploadRes)) as any;

      if (!uploadRes.ok || !uploadJson?.ok) {
        throw new Error((uploadJson?.error ?? "Upload failed").toString());
      }

      const commitHash = (
        uploadJson?.commitHash ??
        uploadJson?.commit_hash ??
        ""
      )
        .toString()
        .trim();

      if (!commitHash || !isHex(commitHash) || commitHash.length !== 66) {
        throw new Error("Upload did not return a valid commitHash");
      }

      const encryptedUriHashAny =
        uploadJson?.encryptedUriHash ??
        uploadJson?.encrypted_uri_hash ??
        uploadJson?.encryptedUriHashHex ??
        uploadJson?.encrypted_uri_hash_hex ??
        uploadJson?.encryptedUriHashB64 ??
        uploadJson?.encrypted_uri_hash_b64 ??
        "";

      let encryptedUriHash: Hex = "0x" as Hex;

      if (typeof encryptedUriHashAny === "string") {
        const s = encryptedUriHashAny.trim();
        if (s.startsWith("0x")) encryptedUriHash = s as Hex;
        else encryptedUriHash = base64ToHex(s);
      } else {
        throw new Error("Upload did not return encryptedUriHash");
      }

      const txHash = await writeContractAsync({
        address: CALIBRA_PROTOCOL,
        abi: CALIBRA_PROTOCOL_ABI,
        functionName: "commit",
        args: [batchIdHash, commitHash as Hex, encryptedUriHash],
        chainId: ADI_TESTNET_CHAIN_ID,
      });

      await publicClient.waitForTransactionReceipt({ hash: txHash });

      try {
        const activeAddr = await ensureWalletReady();
        const addrLower = activeAddr.toLowerCase();

        const cc = (await publicClient.readContract({
          address: CALIBRA_PROTOCOL,
          abi: CALIBRA_PROTOCOL_ABI,
          functionName: "getCommitCount",
          args: [batchIdHash, addrLower as Address],
        })) as unknown as number;

        const latestIndex = Number(cc) - 1;

        if (Number.isFinite(latestIndex) && latestIndex >= 0) {
          const { nonce, expiresAt } = await getNonceForSignature(addrLower);

          const message2 = buildAuthMessage(addrLower, nonce, expiresAt);
          const signature2 = (await signMessageAsync({
            message: message2,
          })) as Hex;

          const setRes = await fetch("/api/submissions/set-commit-index", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              address: addrLower,
              signature: signature2,
              batchIdHash,
              providerAddress: addrLower,
              commitHash,
              commitIndex: latestIndex,
            }),
          });

          const setJson = await safeJson(setRes);

          if (!setRes.ok || !setJson?.ok) {
            setUiError(
              (
                (setJson?.error ?? "Failed to set commit_index") as string
              ).toString(),
            );
          }
        } else {
          setUiError("Committed, but failed to compute commitIndex");
        }
      } catch (e: any) {
        setUiError(e?.message ?? "Committed, but failed to set commit_index");
      }

      setUiOk("Committed on-chain. You can reveal after the window ends.");
      await loadOnchain();
    } catch (e: any) {
      setUiError(e?.shortMessage ?? e?.message ?? "Submit failed");
    } finally {
      setIsSubmitting(false);
    }
  }

  async function onRevealLatest() {
    setUiError(null);
    setUiOk(null);

    try {
      setIsSubmitting(true);

      if (!batchIdHash) throw new Error("Missing batchIdHash");
      if (!publicClient) throw new Error("No public client");

      await ensureWalletReady();

      if (!addr) throw new Error("Wallet not connected");
      if (!provider?.joined) throw new Error("Not joined");
      if (phase !== "reveal") throw new Error("Not in reveal window");

      const addressLower = addr.toLowerCase();
      const { nonce, expiresAt } = await getNonceForSignature(addressLower);

      const message = buildAuthMessage(addressLower, nonce, expiresAt);
      const signature = (await signMessageAsync({ message })) as Hex;

      const readRes = await fetch("/api/submissions/read", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          address: addressLower,
          signature,
          batchIdHash,
          providerAddress: addressLower,
        }),
      });

      const readJson = (await safeJson(readRes)) as any;

      if (!readRes.ok || !readJson?.ok) {
        throw new Error((readJson?.error ?? "Read failed").toString());
      }

      const submission = readJson?.submission ?? {};
      const root = (submission?.root ?? "").toString().trim();
      const salt = (submission?.salt ?? "").toString().trim();

      if (!root || !isHex(root) || root.length !== 66) {
        throw new Error("Submission missing root");
      }
      if (!salt || !isHex(salt) || salt.length !== 66) {
        throw new Error("Submission missing salt");
      }

      const payload = readJson?.payload ?? {};
      const publicUriAny =
        payload?.publicUri ??
        payload?.public_uri ??
        payload?.publicUriB64 ??
        payload?.public_uri_b64 ??
        null;

      if (publicUriAny === null || publicUriAny === undefined) {
        throw new Error("Submission payload missing publicUri");
      }

      let publicUriBytes: Hex = "0x" as Hex;

      if (typeof publicUriAny === "string") {
        const s = publicUriAny.trim();
        if (s.startsWith("0x")) publicUriBytes = s as Hex;
        else publicUriBytes = base64ToHex(s);
      } else {
        throw new Error("Unsupported publicUri type");
      }

      const commitCountNum = Number(provider.commitCount);
      if (!Number.isFinite(commitCountNum) || commitCountNum <= 0) {
        throw new Error("No commits found");
      }

      const latestIndex = commitCountNum - 1;

      const txHash = await writeContractAsync({
        address: CALIBRA_PROTOCOL,
        abi: CALIBRA_PROTOCOL_ABI,
        functionName: "revealCommits",
        args: [
          batchIdHash,
          [latestIndex],
          [root as Hex],
          [salt as Hex],
          [publicUriBytes],
        ],
        chainId: ADI_TESTNET_CHAIN_ID,
      });

      await publicClient.waitForTransactionReceipt({ hash: txHash });

      setUiOk(`Revealed commitIndex ${latestIndex}.`);
      await loadOnchain();
    } catch (e: any) {
      setUiError(e?.shortMessage ?? e?.message ?? "Reveal failed");
    } finally {
      setIsSubmitting(false);
    }
  }

  const canJoin = useMemo(() => {
    if (!onchainBatch?.exists) return false;
    if (!onchainBatch.funded) return false;
    if (onchainBatch.finalized) return false;
    if (provider?.joined) return false;
    if (phase === "postreveal" || phase === "finalized") return false;
    return true;
  }, [onchainBatch, provider, phase]);

  const canSubmit = useMemo(() => {
    if (!provider?.joined) return false;
    if (phase !== "commit") return false;
    return true;
  }, [provider, phase]);

  const showClaimable = useMemo(() => {
    return (
      phase === "reveal" || phase === "postreveal" || phase === "finalized"
    );
  }, [phase]);

  const isJoined = provider?.joined === true;

  return (
    <div className="flex min-h-screen items-center justify-center bg-zinc-50 font-sans dark:bg-black">
      <main className="w-full max-w-5xl px-6 py-12">
        <div className="rounded-2xl bg-white p-8 shadow-sm dark:bg-zinc-950">
          <SubmitHeader
            batchId={batchId}
            isConnected={isConnected}
            onDisconnect={() => disconnect()}
            onConnect={async () => {
              try {
                await ensureWalletReady();
              } catch (e: any) {
                setUiError(
                  e?.shortMessage ?? e?.message ?? "Failed to connect wallet",
                );
              }
            }}
            onBack={() => router.push("/submit")}
          />

          {error ? <ErrorBanner title="Error" message={error} /> : null}
          {onchainError ? (
            <ErrorBanner title="On-chain Error" message={onchainError} />
          ) : null}
          {uiError ? (
            <ErrorBanner title="Action Error" message={uiError} />
          ) : null}
          {uiOk ? <OkBanner title="OK" message={uiOk} /> : null}

          <PredictionWindowCard
            tz={tz}
            nowMs={nowMs}
            isOnchainLoading={isOnchainLoading}
            onchainBatch={onchainBatch}
            bountyBaseUnits={bountyBaseUnits}
            derivedBondBaseUnits={derivedBondBaseUnits}
          />

          <ActionBar
            isSubmitting={isSubmitting}
            canJoin={canJoin}
            onJoin={onJoin}
            isJoined={isJoined}
          />

          {!isJoined ? (
            <NoteBanner
              title="How to enter predictions"
              message="Enter values from 0–100 directly in the table. Joining is required before you can submit on-chain."
            />
          ) : (
            <NoteBanner
              title="How to enter predictions"
              message="Enter values from 0–100 directly in the table."
            />
          )}

          {showClaimable ? (
            <ClaimableAuditCard
              batchId={batchId}
              isOnchainLoading={isOnchainLoading}
              onchainBatch={onchainBatch}
              provider={provider}
              onOpenAudit={() => router.push(`/audit/${batchId}`)}
            />
          ) : null}

          <div className={!isJoined ? "pointer-events-none opacity-60" : ""}>
            <PredictionsTable
              flights={flights}
              isLoading={isLoading || isOnchainLoading}
              thresholdsMinutes={batch?.thresholds_minutes ?? null}
              predByScheduleKey={predByScheduleKey}
              setPredByScheduleKey={setPredByScheduleKey}
              onSubmit={
                canSubmit ? onSubmit : () => setUiError("Not in commit phase")
              }
              isSubmitting={isSubmitting}
            />
          </div>

          {isJoined && phase === "reveal" ? (
            <div className="mt-4 flex flex-wrap items-center gap-2">
              <button
                onClick={onRevealLatest}
                disabled={!isJoined || isSubmitting || phase !== "reveal"}
                className="inline-flex h-9 items-center justify-center rounded-xl border border-zinc-200 bg-white px-4 text-sm font-medium text-zinc-900 transition hover:bg-zinc-50 disabled:opacity-60 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-50 dark:hover:bg-black"
              >
                {isSubmitting ? "Working…" : "Reveal Latest"}
              </button>
            </div>
          ) : null}
        </div>
      </main>
    </div>
  );
}
