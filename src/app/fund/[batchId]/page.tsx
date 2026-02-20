// calibra/src/app/fund/[batchId]/page.tsx
"use client";

import React, { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  useAccount,
  useChainId,
  useConnect,
  useDisconnect,
  usePublicClient,
  useSwitchChain,
  useWriteContract,
} from "wagmi";
import {
  keccak256,
  parseUnits,
  toBytes,
  toHex,
  type Address,
  type Hex,
} from "viem";
import BatchParamsCard from "./components/BatchParamsCard";
import FundAmountCard from "./components/FundAmountCard";
import FlightsTable from "./components/FlightsTable";

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
      };
      flights: BatchFlight[];
    }
  | { ok: false; error: string; details?: unknown };

type BatchInfo = Extract<BatchGetResponse, { ok: true }>["batch"];

const ADI_TESTNET_CHAIN_ID = 99999;

const MOCK_USDC = "0x4fA65A338618FA771bA11eb37892641cBD055f98" as Address;
const CALIBRA_PROTOCOL =
  "0x2efe9ae023241Df74A1A79d64b8CA3acfC9d7a25" as Address;
const USDC_ABI = [
  {
    type: "function",
    name: "approve",
    stateMutability: "nonpayable",
    inputs: [
      { name: "spender", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
] as const;

const CALIBRA_PROTOCOL_ABI = [
  {
    type: "function",
    name: "createBatch",
    stateMutability: "nonpayable",
    inputs: [
      { name: "batchIdHash", type: "bytes32" },
      { name: "funder", type: "address" },
      { name: "windowStart", type: "uint64" },
      { name: "windowEnd", type: "uint64" },
      { name: "revealDeadline", type: "uint64" },
      { name: "seedHash", type: "bytes32" },
      { name: "specHash", type: "bytes32" },
      { name: "funderEncryptPubKey", type: "bytes" },
      { name: "refundTopBP", type: "uint16" },
      { name: "minCommitsPerProvider", type: "uint32" },
      { name: "maxCommitsPerProvider", type: "uint32" },
      { name: "requireRevealAllCommits", type: "bool" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "fundBatch",
    stateMutability: "nonpayable",
    inputs: [
      { name: "batchIdHash", type: "bytes32" },
      { name: "bountyAmount", type: "uint256" },
    ],
    outputs: [],
  },
] as const;

function unixFromDatetimeLocal(s: string, timeZone: string) {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(s);
  if (!m) return null;

  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  const hour = Number(m[4]);
  const minute = Number(m[5]);

  if (
    !Number.isFinite(year) ||
    !Number.isFinite(month) ||
    !Number.isFinite(day) ||
    !Number.isFinite(hour) ||
    !Number.isFinite(minute)
  ) {
    return null;
  }

  const utcGuessMs = Date.UTC(year, month - 1, day, hour, minute, 0);

  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(new Date(utcGuessMs));

  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";

  const asUTC = Date.UTC(
    Number(get("year")),
    Number(get("month")) - 1,
    Number(get("day")),
    Number(get("hour")),
    Number(get("minute")),
    Number(get("second")),
  );

  const offsetMs = asUTC - utcGuessMs;
  return Math.floor((utcGuessMs - offsetMs) / 1000);
}

function seedLocalStorageKey(batchId: string) {
  return `calibra_seed_${batchId}`;
}

function datetimeLocalFromUnixSecondsInTimeZone(u: number, timeZone: string) {
  const d = new Date(u * 1000);

  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(d);

  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";

  const year = get("year");
  const month = get("month");
  const day = get("day");
  const hour = get("hour");
  const minute = get("minute");

  if (!year || !month || !day || !hour || !minute) return "";

  return `${year}-${month}-${day}T${hour}:${minute}`;
}

export default function FundBatchPage() {
  const router = useRouter();
  const params = useParams<{ batchId: string }>();
  const batchId = (params?.batchId ?? "").toString();

  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [batch, setBatch] = useState<BatchInfo | null>(null);
  const [flights, setFlights] = useState<BatchFlight[]>([]);

  const [amountUsdc, setAmountUsdc] = useState("");

  const [windowStartLocal, setWindowStartLocal] = useState("");
  const [windowEndLocal, setWindowEndLocal] = useState("");

  const [endWhenAllLanded, setEndWhenAllLanded] = useState(false);

  const [thresholds, setThresholds] = useState<
    { id: string; minutes: number }[]
  >([{ id: "t_1", minutes: 60 }]);
  const maxThresholds = 5;

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [txError, setTxError] = useState<string | null>(null);
  const [txHash, setTxHash] = useState<string | null>(null);

  const tz = useMemo(() => {
    const v = (batch?.display_time_zone ?? "UTC").toString();
    return v || "UTC";
  }, [batch]);

  const { address, isConnected } = useAccount();
  const chainId = useChainId();
  const { connectAsync, connectors } = useConnect();
  const { disconnect } = useDisconnect();
  const { switchChainAsync } = useSwitchChain();
  const publicClient = usePublicClient();
  const { writeContractAsync } = useWriteContract();

  const addr = useMemo(() => {
    if (!address) return null;
    return address as Address;
  }, [address]);

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
          `/api/batches/get?batchId=${encodeURIComponent(batchId)}`,
          {
            method: "GET",
            cache: "no-store",
          },
        );

        const json = (await res.json()) as BatchGetResponse;

        if (!res.ok || !json.ok) {
          setError(json.ok ? "Request failed" : json.error);
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

  useEffect(() => {
    if (!endWhenAllLanded) return;
    if (!windowStartLocal.trim()) return;

    const wsU = unixFromDatetimeLocal(windowStartLocal.trim(), tz);
    if (wsU === null) return;

    const arriveTimes = flights
      .map((f) => f.scheduled_arrive_iso)
      .filter((s): s is string => typeof s === "string" && s.length > 0)
      .map((s) => new Date(s).getTime())
      .filter((ms) => Number.isFinite(ms));

    if (arriveTimes.length === 0) return;

    const latestArriveMs = Math.max(...arriveTimes);
    const latestArriveU = Math.floor(latestArriveMs / 1000);

    const bufferSeconds = 6 * 60 * 60;
    const autoEndU = Math.max(wsU + 60, latestArriveU + bufferSeconds);

    const local = datetimeLocalFromUnixSecondsInTimeZone(autoEndU, tz);
    if (local) setWindowEndLocal(local);
  }, [endWhenAllLanded, windowStartLocal, flights]);

  const canContinue = useMemo(() => {
    const s = amountUsdc.trim();
    if (!s) return false;
    const n = Number(s);
    if (!Number.isFinite(n) || n <= 0) return false;

    const ws = windowStartLocal.trim();
    if (!ws) return false;

    const wsU = unixFromDatetimeLocal(ws, tz);
    if (wsU === null) return false;

    const we = windowEndLocal.trim();
    if (!we) return false;

    const weU = unixFromDatetimeLocal(we, tz);
    if (weU === null) return false;
    if (wsU >= weU) return false;

    const uniq = Array.from(
      new Set(
        thresholds
          .map((t) => t.minutes)
          .filter((m) => Number.isFinite(m) && m > 0)
          .map((m) => Math.floor(m)),
      ),
    ).sort((a, b) => a - b);

    if (uniq.length === 0) return false;
    if (uniq.length > maxThresholds) return false;

    return true;
  }, [amountUsdc, windowStartLocal, windowEndLocal, thresholds, tz]);

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

  async function onContinue() {
    setTxError(null);
    setTxHash(null);

    if (!canContinue) {
      setTxError("Missing or invalid inputs");
      return;
    }

    if (!batchId) {
      setTxError("Missing batchId");
      return;
    }

    if (!publicClient) {
      setTxError("No public client");
      return;
    }

    if (!addr) {
      setTxError("Wallet not connected");
      return;
    }

    const wsU = unixFromDatetimeLocal(windowStartLocal.trim(), tz);
    const weU = unixFromDatetimeLocal(windowEndLocal.trim(), tz);
    if (wsU === null || weU === null) {
      setTxError("Invalid time inputs");
      return;
    }

    const amount = parseUnits(amountUsdc.trim(), 6);
    const batchIdHash = keccak256(toBytes(batchId));

    const seedBytes = new Uint8Array(32);
    crypto.getRandomValues(seedBytes);
    const seed = toHex(seedBytes) as Hex;
    const seedHash = keccak256(seed);

    const uniqThresholdMinutes = Array.from(
      new Set(
        thresholds
          .map((t) => t.minutes)
          .filter((m) => Number.isFinite(m) && m > 0)
          .map((m) => Math.floor(m)),
      ),
    )
      .sort((a, b) => a - b)
      .slice(0, maxThresholds);

    const spec = JSON.stringify({
      version: 1,
      end_when_all_landed: endWhenAllLanded,
      thresholds_minutes: uniqThresholdMinutes,
      includes_flight_does_not_arrive: true,
    });

    const specHash = keccak256(toBytes(spec));

    try {
      setIsSubmitting(true);

      await ensureWalletReady();

      const approveHash = await writeContractAsync({
        address: MOCK_USDC,
        abi: USDC_ABI,
        functionName: "approve",
        args: [CALIBRA_PROTOCOL, amount],
        chainId: ADI_TESTNET_CHAIN_ID,
      });

      await publicClient.waitForTransactionReceipt({ hash: approveHash });

      const revealDeadlineU = weU + 6 * 60 * 60;

      const refundTopBP = 2_000;
      const minCommitsPerProvider = 1;
      const maxCommitsPerProvider = 50;
      const requireRevealAllCommits = false;

      const funderEncryptPubKey = "0x01" as Hex;

      const createHash = await writeContractAsync({
        address: CALIBRA_PROTOCOL,
        abi: CALIBRA_PROTOCOL_ABI,
        functionName: "createBatch",
        args: [
          batchIdHash,
          addr as Address,
          BigInt(wsU),
          BigInt(weU),
          BigInt(revealDeadlineU),
          seedHash,
          specHash,
          funderEncryptPubKey,
          refundTopBP,
          minCommitsPerProvider,
          maxCommitsPerProvider,
          requireRevealAllCommits,
        ],
        chainId: ADI_TESTNET_CHAIN_ID,
      });

      await publicClient.waitForTransactionReceipt({ hash: createHash });

      const fundHash = await writeContractAsync({
        address: CALIBRA_PROTOCOL,
        abi: CALIBRA_PROTOCOL_ABI,
        functionName: "fundBatch",
        args: [batchIdHash, amount],
        chainId: ADI_TESTNET_CHAIN_ID,
      });

      await publicClient.waitForTransactionReceipt({ hash: fundHash });

      try {
        await fetch("/api/batches/mark-funded", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            batchId,
            predictionWindowStartUnix: wsU,
            predictionWindowEndUnix: weU,
            windowStartLocal: windowStartLocal.trim(),
            windowEndLocal: windowEndLocal.trim(),
            endWhenAllLanded,
            thresholdsMinutes: uniqThresholdMinutes,
            spec,
            specHash,
            seedHash,
            fundTxHash: fundHash,
            bountyUsdc: amountUsdc.trim(),
          }),
        });
      } catch {}

      localStorage.setItem(seedLocalStorageKey(batchId), seed);

      setTxHash(fundHash);
      router.push("/");
    } catch (e: any) {
      setTxError(e?.shortMessage ?? e?.message ?? "Transaction failed");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-zinc-50 font-sans dark:bg-black">
      <main className="w-full max-w-[1050px] px-6 py-12">
        <div className="rounded-2xl bg-white p-8 shadow-sm dark:bg-zinc-950">
          <div className="flex items-start justify-between gap-6">
            <div className="flex flex-col gap-2">
              <h1 className="text-2xl font-semibold tracking-tight text-zinc-950 dark:text-zinc-50">
                Fund Batch
              </h1>
              <div className="text-sm text-zinc-600 dark:text-zinc-400">
                Batch ID: <span className="font-mono">{batchId}</span>
              </div>
            </div>

            <div className="flex items-center gap-2">
              {isConnected ? (
                <>
                  <div className="hidden flex-col items-end gap-1 sm:flex">
                    <div className="text-[11px] text-zinc-500 dark:text-zinc-400">
                      {addr ? (
                        <span className="font-mono">
                          {addr.slice(0, 6)}…{addr.slice(-4)}
                        </span>
                      ) : (
                        "Connected"
                      )}
                    </div>
                  </div>

                  <button
                    onClick={() => disconnect()}
                    className="inline-flex h-9 items-center justify-center rounded-full border border-zinc-200 bg-white px-4 text-xs font-medium text-zinc-900 transition hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-50 dark:hover:bg-black"
                  >
                    Disconnect
                  </button>
                </>
              ) : (
                <button
                  onClick={async () => {
                    try {
                      await ensureWalletReady();
                    } catch (e: any) {
                      setTxError(
                        e?.shortMessage ??
                          e?.message ??
                          "Failed to connect wallet",
                      );
                    }
                  }}
                  className="inline-flex h-9 items-center justify-center rounded-full bg-zinc-900 px-4 text-xs font-medium text-white transition hover:bg-zinc-800 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-200"
                >
                  Connect Wallet
                </button>
              )}

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

          {txError ? (
            <div className="mt-6 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-200">
              <div className="font-medium">Transaction Error</div>
              <div className="mt-1 break-words">{txError}</div>
            </div>
          ) : null}

          {txHash ? (
            <div className="mt-6 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800 dark:border-emerald-900/50 dark:bg-emerald-950/30 dark:text-emerald-200">
              <div className="font-medium">Funded</div>
              <div className="mt-1 font-mono break-words text-xs">{txHash}</div>
            </div>
          ) : null}

          <BatchParamsCard
            windowStartLocal={windowStartLocal}
            setWindowStartLocal={setWindowStartLocal}
            windowEndLocal={windowEndLocal}
            setWindowEndLocal={setWindowEndLocal}
            endWhenAllLanded={endWhenAllLanded}
            setEndWhenAllLanded={setEndWhenAllLanded}
            thresholds={thresholds}
            setThresholds={setThresholds}
            maxThresholds={maxThresholds}
            timeZone={tz}
          />

          <FundAmountCard
            amountUsdc={amountUsdc}
            setAmountUsdc={setAmountUsdc}
            canContinue={canContinue}
            isLoading={isLoading}
            isSubmitting={isSubmitting}
            onContinue={onContinue}
          />

          <FlightsTable flights={flights} isLoading={isLoading} tz={tz} />
        </div>
      </main>
    </div>
  );
}
