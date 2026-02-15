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
  useWriteContract,
} from "wagmi";
import { injected } from "wagmi/connectors";
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

  const [wantArriveLe60, setWantArriveLe60] = useState(true);
  const [wantArriveGt60, setWantArriveGt60] = useState(true);
  const [wantCancelled, setWantCancelled] = useState(true);

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [txError, setTxError] = useState<string | null>(null);
  const [txHash, setTxHash] = useState<string | null>(null);

  const tz = useMemo(() => {
    const v = (batch?.display_time_zone ?? "UTC").toString();
    return v || "UTC";
  }, [batch]);

  const { address, isConnected } = useAccount();
  const chainId = useChainId();
  const { connectAsync } = useConnect();
  const { disconnect } = useDisconnect();
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
          { method: "GET", cache: "no-store" },
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

  const canContinue = useMemo(() => {
    const s = amountUsdc.trim();
    if (!s) return false;
    const n = Number(s);
    if (!Number.isFinite(n) || n <= 0) return false;

    const ws = windowStartLocal.trim();
    const we = windowEndLocal.trim();
    if (!ws || !we) return false;

    const wsU = unixFromDatetimeLocal(ws);
    const weU = unixFromDatetimeLocal(we);
    if (wsU === null || weU === null) return false;
    if (wsU >= weU) return false;

    const anyOutcome = wantArriveLe60 || wantArriveGt60 || wantCancelled;
    if (!anyOutcome) return false;

    return true;
  }, [
    amountUsdc,
    windowStartLocal,
    windowEndLocal,
    wantArriveLe60,
    wantArriveGt60,
    wantCancelled,
  ]);

  async function ensureConnected() {
    if (isConnected) return;
    await connectAsync({ connector: injected() });
  }

  async function onContinue() {
    setTxError(null);
    setTxHash(null);

    if (!batchId) {
      setTxError("Missing batchId");
      return;
    }

    if (!publicClient) {
      setTxError("No public client");
      return;
    }

    const amtStr = amountUsdc.trim();
    const ws = unixFromDatetimeLocal(windowStartLocal.trim());
    const we = unixFromDatetimeLocal(windowEndLocal.trim());
    if (!amtStr || ws === null || we === null) {
      setTxError("Missing inputs");
      return;
    }

    const amount = parseUnits(amtStr, 6);

    const batchIdHash = keccak256(toBytes(batchId));

    const seedBytes = new Uint8Array(32);
    crypto.getRandomValues(seedBytes);
    const seed = toHex(seedBytes) as Hex;
    const seedHash = keccak256(seed);

    const spec = JSON.stringify({
      version: 1,
      outcomes: {
        arrive_le_60: wantArriveLe60,
        arrive_gt_60: wantArriveGt60,
        cancelled: wantCancelled,
      },
    });
    const specHash = keccak256(toBytes(spec));

    try {
      setIsSubmitting(true);

      await ensureConnected();

      if (chainId !== ADI_TESTNET_CHAIN_ID) {
        setTxError(
          `Wrong network (chainId=${chainId}). Switch to ADI Testnet.`,
        );
        setIsSubmitting(false);
        return;
      }

      const approveHash = await writeContractAsync({
        address: MOCK_USDC,
        abi: USDC_ABI,
        functionName: "approve",
        args: [CALIBRA_BATCHES, amount],
      });

      await publicClient.waitForTransactionReceipt({ hash: approveHash });

      const fundHash = await writeContractAsync({
        address: CALIBRA_BATCHES,
        abi: CALIBRA_BATCHES_ABI,
        functionName: "fundBatch",
        args: [batchIdHash, BigInt(ws), BigInt(we), seedHash, specHash, amount],
      });

      await publicClient.waitForTransactionReceipt({ hash: fundHash });

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
                  onClick={() => ensureConnected()}
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
            wantArriveLe60={wantArriveLe60}
            setWantArriveLe60={setWantArriveLe60}
            wantArriveGt60={wantArriveGt60}
            setWantArriveGt60={setWantArriveGt60}
            wantCancelled={wantCancelled}
            setWantCancelled={setWantCancelled}
          />

          <FundAmountCard
            amountUsdc={amountUsdc}
            setAmountUsdc={setAmountUsdc}
            canContinue={canContinue}
            isLoading={isLoading}
            isSubmitting={isSubmitting}
            onContinue={onContinue}
            isConnected={isConnected}
            address={address}
          />

          <FlightsTable flights={flights} isLoading={isLoading} tz={tz} />
        </div>
      </main>
    </div>
  );
}
