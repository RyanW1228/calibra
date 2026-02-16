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
const CALIBRA_BATCHES = "0xCDBc322c04D15068f7B6EAD5e32D73d5429cA7ad" as Address;

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

const CALIBRA_BATCHES_ABI = [
  {
    type: "function",
    name: "fundBatch",
    stateMutability: "nonpayable",
    inputs: [
      { name: "batchIdHash", type: "bytes32" },
      { name: "windowStart", type: "uint64" },
      { name: "windowEnd", type: "uint64" },
      { name: "seedHash", type: "bytes32" },
      { name: "specHash", type: "bytes32" },
      { name: "bountyAmount", type: "uint256" },
    ],
    outputs: [],
  },
] as const;

function unixFromDatetimeLocal(s: string) {
  const d = new Date(s);
  const ms = d.getTime();
  if (Number.isNaN(ms)) return null;
  return Math.floor(ms / 1000);
}

function seedLocalStorageKey(batchId: string) {
  return `calibra_seed_${batchId}`;
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

  const { isConnected } = useAccount();
  const chainId = useChainId();
  const { connectAsync, connectors } = useConnect();
  const { disconnect } = useDisconnect();
  const { switchChainAsync } = useSwitchChain();
  const publicClient = usePublicClient();
  const { writeContractAsync } = useWriteContract();

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

    const wsU = unixFromDatetimeLocal(windowStartLocal.trim());
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

    const d = new Date(autoEndU * 1000);
    const local = new Date(d.getTime() - d.getTimezoneOffset() * 60 * 1000)
      .toISOString()
      .slice(0, 16);

    setWindowEndLocal(local);
  }, [endWhenAllLanded, windowStartLocal, flights]);

  const canContinue = useMemo(() => {
    const s = amountUsdc.trim();
    if (!s) return false;
    const n = Number(s);
    if (!Number.isFinite(n) || n <= 0) return false;

    const ws = windowStartLocal.trim();
    if (!ws) return false;

    const wsU = unixFromDatetimeLocal(ws);
    if (wsU === null) return false;

    const we = windowEndLocal.trim();
    if (!we) return false;

    const weU = unixFromDatetimeLocal(we);
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
  }, [amountUsdc, windowStartLocal, windowEndLocal, thresholds]);

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

    const wsU = unixFromDatetimeLocal(windowStartLocal.trim());
    const weU = unixFromDatetimeLocal(windowEndLocal.trim());
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
        args: [CALIBRA_BATCHES, amount],
        chainId: ADI_TESTNET_CHAIN_ID,
      });

      await publicClient.waitForTransactionReceipt({ hash: approveHash });

      const fundHash = await writeContractAsync({
        address: CALIBRA_BATCHES,
        abi: CALIBRA_BATCHES_ABI,
        functionName: "fundBatch",
        args: [
          batchIdHash,
          BigInt(wsU),
          BigInt(weU),
          seedHash,
          specHash,
          amount,
        ],
        chainId: ADI_TESTNET_CHAIN_ID,
      });

      await publicClient.waitForTransactionReceipt({ hash: fundHash });

      try {
        await fetch("/api/batches/mark-funded", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ batchId }),
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
      <main className="w-full max-w-5xl px-6 py-12">
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
                <button
                  onClick={() => disconnect()}
                  className="inline-flex h-9 items-center justify-center rounded-full border border-zinc-200 bg-white px-4 text-xs font-medium text-zinc-900 transition hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-50 dark:hover:bg-black"
                >
                  Disconnect
                </button>
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

          <div className="mt-6 grid gap-4 sm:grid-cols-3">
            <div className="rounded-xl border border-zinc-200 p-4 dark:border-zinc-800">
              <div className="text-xs text-zinc-500 dark:text-zinc-400">
                Status
              </div>
              <div className="mt-1 text-sm font-medium text-zinc-900 dark:text-zinc-50">
                {batch?.status ?? (isLoading ? "Loading…" : "—")}
              </div>
            </div>

            <div className="rounded-xl border border-zinc-200 p-4 dark:border-zinc-800">
              <div className="text-xs text-zinc-500 dark:text-zinc-400">
                Flight Count
              </div>
              <div className="mt-1 text-sm font-medium text-zinc-900 dark:text-zinc-50">
                {typeof batch?.flight_count === "number"
                  ? batch.flight_count
                  : isLoading
                    ? "Loading…"
                    : "—"}
              </div>
            </div>

            <div className="rounded-xl border border-zinc-200 p-4 dark:border-zinc-800">
              <div className="text-xs text-zinc-500 dark:text-zinc-400">
                Display Time Zone
              </div>
              <div className="mt-1 text-sm font-medium text-zinc-900 dark:text-zinc-50">
                {tz}
              </div>
            </div>
          </div>

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
