// calibra/src/app/operator/finalize/[batchId]/page.tsx
"use client";

import React, { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { createClient } from "@supabase/supabase-js";
import {
  useAccount,
  useChainId,
  useConnect,
  useDisconnect,
  usePublicClient,
  useSwitchChain,
  useWriteContract,
} from "wagmi";
import { formatUnits, keccak256, toBytes, type Address, type Hex } from "viem";
import {
  ADI_TESTNET_CHAIN_ID,
  batchIdToHash,
  CALIBRA_PROTOCOL,
  CALIBRA_PROTOCOL_ABI,
} from "@/lib/calibraOnchain";

const USDC_DECIMALS = 6;

function nowSec() {
  return Math.floor(Date.now() / 1000);
}

function fmtUsdc(x: bigint) {
  const s = formatUnits(x, USDC_DECIMALS);
  const [a, bRaw] = s.split(".");
  const b = (bRaw ?? "").slice(0, 2).padEnd(2, "0");
  return `$${a}.${b}`;
}

function isHexAddress(s: string) {
  return /^0x[a-fA-F0-9]{40}$/.test(s);
}

function isBytes32(s: string) {
  return /^0x[a-fA-F0-9]{64}$/.test(s);
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

type SubmissionRow = {
  id: string;
  batch_id_hash: string | null;
  provider_address: string | null;
};

type OnchainBatch = {
  exists: boolean;
  operator: Address;
  funder: Address;
  windowStart: bigint;
  windowEnd: bigint;
  revealDeadline: bigint;
  funded: boolean;
  finalized: boolean;
  bounty: bigint;
  joinBond: bigint;
  seedRevealed: boolean;
};

export default function OperatorFinalizePage() {
  const router = useRouter();
  const params = useParams<{ batchId: string }>();
  const batchId = (params?.batchId ?? "").toString();

  const { address, isConnected } = useAccount();
  const chainId = useChainId();
  const { connectAsync, connectors } = useConnect();
  const { disconnect } = useDisconnect();
  const { switchChainAsync } = useSwitchChain();
  const publicClient = usePublicClient();
  const { writeContractAsync } = useWriteContract();

  const [uiError, setUiError] = useState<string | null>(null);
  const [uiOk, setUiOk] = useState<string | null>(null);
  const [isWorking, setIsWorking] = useState(false);

  const batchIdHash = useMemo(() => {
    if (!batchId) return null;
    return batchIdToHash(batchId);
  }, [batchId]);

  const supabase = useMemo(() => {
    const url = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").toString().trim();
    const anon = (process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "")
      .toString()
      .trim();
    if (!url || !anon) return null;
    return createClient(url, anon);
  }, []);

  const [batchLoading, setBatchLoading] = useState(true);
  const [b, setB] = useState<OnchainBatch | null>(null);

  const [providersLoading, setProvidersLoading] = useState(true);
  const [providers, setProviders] = useState<Address[]>([]);

  const [cutoffLoading, setCutoffLoading] = useState(false);
  const [cutoff, setCutoff] = useState<bigint | null>(null);

  const [selectedLoading, setSelectedLoading] = useState(false);
  const [selectedCommitIdx, setSelectedCommitIdx] = useState<
    Record<string, number>
  >({});

  const [seedHex, setSeedHex] = useState<string>("");
  const [payoutsJson, setPayoutsJson] = useState<string>(
    `{\n  "0x...": "0"\n}\n`,
  );

  function setOk(m: string) {
    setUiError(null);
    setUiOk(m);
  }

  function setErr(m: string) {
    setUiOk(null);
    setUiError(m);
  }

  async function ensureWalletReady(): Promise<Address> {
    let active = (address ? (address as Address) : null) as Address | null;

    if (!isConnected) {
      const connector = connectors[0];
      if (!connector) throw new Error("No wallet connector available");
      const res = await connectAsync({ connector });
      const first = Array.isArray(res.accounts) ? res.accounts[0] : null;
      if (!first) throw new Error("Wallet connected but no account returned");
      active = first as Address;
    }

    if (chainId !== ADI_TESTNET_CHAIN_ID) {
      await switchChainAsync({ chainId: ADI_TESTNET_CHAIN_ID });
    }

    if (!active) throw new Error("Wallet not connected");
    return active;
  }

  async function loadBatch() {
    setBatchLoading(true);
    setUiError(null);

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
        setB(null);
        setErr("Batch not found on-chain");
        return;
      }

      setB({
        exists: true,
        operator: res[1],
        funder: res[2],
        windowStart: res[3],
        windowEnd: res[4],
        revealDeadline: res[5],
        seedRevealed: res[7] === true,
        funded: res[11] === true,
        finalized: res[12] === true,
        bounty: res[13],
        joinBond: res[14],
      });
    } catch (e: any) {
      setErr(e?.shortMessage ?? e?.message ?? "Failed to load batch");
      setB(null);
    } finally {
      setBatchLoading(false);
    }
  }

  async function loadProvidersFromDb() {
    setProvidersLoading(true);
    setUiError(null);

    try {
      if (!supabase) throw new Error("Missing Supabase env");
      if (!batchIdHash) throw new Error("Missing batchIdHash");

      const { data, error } = await supabase
        .from("submissions")
        .select("id,batch_id_hash,provider_address")
        .eq("batch_id_hash", batchIdHash);

      if (error) throw new Error(error.message);

      const rows = (Array.isArray(data) ? data : []) as SubmissionRow[];

      const set = new Set<string>();
      for (const r of rows) {
        const a = (r.provider_address ?? "").toString().trim().toLowerCase();
        if (a && isHexAddress(a)) set.add(a);
      }

      const list = Array.from(set).sort() as Address[];
      setProviders(list);
      setOk(`Loaded ${list.length} provider(s) from submissions table.`);
    } catch (e: any) {
      setProviders([]);
      setErr(e?.message ?? "Failed to load providers from DB");
    } finally {
      setProvidersLoading(false);
    }
  }

  async function onGetCutoff() {
    setUiError(null);
    setUiOk(null);
    try {
      setCutoffLoading(true);
      if (!publicClient) throw new Error("No public client");
      if (!batchIdHash) throw new Error("Missing batchIdHash");

      const c = (await publicClient.readContract({
        address: CALIBRA_PROTOCOL,
        abi: CALIBRA_PROTOCOL_ABI,
        functionName: "getCutoff",
        args: [batchIdHash],
      })) as unknown as bigint;

      setCutoff(c);
      setOk(`Cutoff: ${c.toString()} (unix seconds)`);
    } catch (e: any) {
      setErr(e?.shortMessage ?? e?.message ?? "Failed to get cutoff");
    } finally {
      setCutoffLoading(false);
    }
  }

  async function onComputeSelectedIndices() {
    setUiError(null);
    setUiOk(null);

    try {
      setSelectedLoading(true);
      if (!publicClient) throw new Error("No public client");
      if (!batchIdHash) throw new Error("Missing batchIdHash");
      if (!b?.seedRevealed) throw new Error("Seed not revealed yet");
      if (providers.length === 0) throw new Error("No providers loaded");

      const next: Record<string, number> = {};

      for (const p of providers) {
        const idx = (await publicClient.readContract({
          address: CALIBRA_PROTOCOL,
          abi: CALIBRA_PROTOCOL_ABI,
          functionName: "getSelectedCommitIndex",
          args: [batchIdHash, p],
        })) as unknown as number;

        next[p.toLowerCase()] = Number(idx);
      }

      setSelectedCommitIdx(next);
      setOk(
        `Computed selected commit indices for ${providers.length} provider(s).`,
      );
    } catch (e: any) {
      setErr(
        e?.shortMessage ?? e?.message ?? "Failed to compute selected indices",
      );
    } finally {
      setSelectedLoading(false);
    }
  }

  async function onLockRandomness() {
    setUiError(null);
    setUiOk(null);

    try {
      setIsWorking(true);
      if (!publicClient) throw new Error("No public client");
      if (!batchIdHash) throw new Error("Missing batchIdHash");

      await ensureWalletReady();

      const tx = await writeContractAsync({
        address: CALIBRA_PROTOCOL,
        abi: CALIBRA_PROTOCOL_ABI,
        functionName: "lockRandomness",
        args: [batchIdHash],
        chainId: ADI_TESTNET_CHAIN_ID,
      });

      await publicClient.waitForTransactionReceipt({ hash: tx });

      setOk("Randomness locked (mix block set).");
      await loadBatch();
    } catch (e: any) {
      setErr(e?.shortMessage ?? e?.message ?? "lockRandomness failed");
    } finally {
      setIsWorking(false);
    }
  }

  async function onRevealSeed() {
    setUiError(null);
    setUiOk(null);

    try {
      setIsWorking(true);
      if (!publicClient) throw new Error("No public client");
      if (!batchIdHash) throw new Error("Missing batchIdHash");

      await ensureWalletReady();

      const s = seedHex.trim();
      if (!isBytes32(s)) throw new Error("Seed must be 0x + 64 hex chars");

      const tx = await writeContractAsync({
        address: CALIBRA_PROTOCOL,
        abi: CALIBRA_PROTOCOL_ABI,
        functionName: "revealSeed",
        args: [batchIdHash, s as Hex],
        chainId: ADI_TESTNET_CHAIN_ID,
      });

      await publicClient.waitForTransactionReceipt({ hash: tx });

      setOk("Seed revealed. Cutoff is now defined.");
      await loadBatch();
    } catch (e: any) {
      setErr(e?.shortMessage ?? e?.message ?? "revealSeed failed");
    } finally {
      setIsWorking(false);
    }
  }

  function parsePayoutsObject(): Record<string, bigint> {
    let obj: any;
    try {
      obj = JSON.parse(payoutsJson);
    } catch {
      throw new Error("Payouts JSON is invalid JSON");
    }

    if (!obj || typeof obj !== "object" || Array.isArray(obj)) {
      throw new Error("Payouts JSON must be an object: { address: amount }");
    }

    const out: Record<string, bigint> = {};

    for (const [k0, v0] of Object.entries(obj)) {
      const k = (k0 ?? "").toString().trim().toLowerCase();
      if (!isHexAddress(k)) throw new Error(`Bad address key: ${k0}`);

      const vStr = (v0 as any)?.toString?.() ?? String(v0);
      if (!/^\d+$/.test(vStr)) {
        throw new Error(`Payout for ${k} must be an integer (USDC base units)`);
      }

      const v = BigInt(vStr);
      if (v < BigInt(0)) throw new Error(`Negative payout for ${k}`);
      out[k] = v;
    }

    return out;
  }

  async function onFinalize() {
    setUiError(null);
    setUiOk(null);

    try {
      setIsWorking(true);

      if (!publicClient) throw new Error("No public client");
      if (!batchIdHash) throw new Error("Missing batchIdHash");
      if (!b?.exists) throw new Error("Batch not loaded");
      if (b.finalized) throw new Error("Already finalized");
      if (!b.seedRevealed) throw new Error("Seed not revealed");
      if (providers.length === 0) throw new Error("No providers loaded");

      await ensureWalletReady();

      const payoutsObj = parsePayoutsObject();

      const providerList: Address[] = [];
      const payouts: bigint[] = [];
      const selectedCommitIndices: number[] = [];

      for (const p of providers) {
        const key = p.toLowerCase();
        const payout = payoutsObj[key] ?? BigInt(0);

        const idx =
          selectedCommitIdx[key] ??
          Number(
            (await publicClient.readContract({
              address: CALIBRA_PROTOCOL,
              abi: CALIBRA_PROTOCOL_ABI,
              functionName: "getSelectedCommitIndex",
              args: [batchIdHash, p],
            })) as unknown as number,
          );

        providerList.push(p);
        payouts.push(payout);
        selectedCommitIndices.push(idx);
      }

      const scoresHash = keccak256(toBytes(payoutsJson)) as Hex;

      const tx = await writeContractAsync({
        address: CALIBRA_PROTOCOL,
        abi: CALIBRA_PROTOCOL_ABI,
        functionName: "finalize",
        args: [
          batchIdHash,
          providerList,
          payouts,
          selectedCommitIndices,
          scoresHash,
        ],
        chainId: ADI_TESTNET_CHAIN_ID,
      });

      await publicClient.waitForTransactionReceipt({ hash: tx });

      setOk("Finalized successfully. Providers can now claim payouts.");
      await loadBatch();
    } catch (e: any) {
      setErr(e?.shortMessage ?? e?.message ?? "Finalize failed");
    } finally {
      setIsWorking(false);
    }
  }

  useEffect(() => {
    if (!publicClient) return;
    if (!batchIdHash) return;
    loadBatch();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [publicClient, batchIdHash]);

  const timeSummary = useMemo(() => {
    if (!b) return null;

    const t = BigInt(nowSec());
    const pre = t < b.windowStart;
    const commit = t >= b.windowStart && t < b.windowEnd;
    const reveal = t >= b.windowEnd && t <= b.revealDeadline;
    const post = t > b.revealDeadline;

    const phase = b.finalized
      ? "finalized"
      : pre
        ? "prewindow"
        : commit
          ? "commit"
          : reveal
            ? "reveal"
            : post
              ? "postreveal"
              : "—";

    return {
      phase,
      windowStart: b.windowStart.toString(),
      windowEnd: b.windowEnd.toString(),
      revealDeadline: b.revealDeadline.toString(),
    };
  }, [b]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-zinc-50 font-sans dark:bg-black">
      <main className="w-full max-w-5xl px-6 py-12">
        <div className="rounded-2xl bg-white p-8 shadow-sm dark:bg-zinc-950">
          <div className="flex items-start justify-between gap-6">
            <div className="flex flex-col gap-2">
              <h1 className="text-2xl font-semibold tracking-tight text-zinc-950 dark:text-zinc-50">
                Operator Finalize
              </h1>
              <div className="text-sm text-zinc-600 dark:text-zinc-400">
                Batch ID: <span className="font-mono">{batchId}</span>
              </div>
              <div className="text-xs text-zinc-500 dark:text-zinc-400">
                Batch Hash:{" "}
                <span className="font-mono">{batchIdHash ?? "—"}</span>
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
                      setOk("Wallet connected.");
                    } catch (e: any) {
                      setErr(e?.shortMessage ?? e?.message ?? "Connect failed");
                    }
                  }}
                  className="inline-flex h-9 items-center justify-center rounded-full bg-zinc-900 px-4 text-xs font-medium text-white transition hover:bg-zinc-800 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-200"
                >
                  Connect Wallet
                </button>
              )}

              <button
                onClick={() => router.push(`/audit/${batchId}`)}
                className="inline-flex h-9 items-center justify-center rounded-full border border-zinc-200 bg-white px-4 text-xs font-medium text-zinc-900 transition hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-50 dark:hover:bg-black"
              >
                Public Audit
              </button>

              <button
                onClick={() => router.push(`/submit/${batchId}`)}
                className="inline-flex h-9 items-center justify-center rounded-full border border-zinc-200 bg-white px-4 text-xs font-medium text-zinc-900 transition hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-50 dark:hover:bg-black"
              >
                Back
              </button>
            </div>
          </div>

          {uiError ? <ErrorBanner title="Error" message={uiError} /> : null}
          {uiOk ? <OkBanner title="OK" message={uiOk} /> : null}

          <div className="mt-6 grid gap-4 sm:grid-cols-4">
            <div className="rounded-xl border border-zinc-200 p-4 dark:border-zinc-800">
              <div className="text-xs text-zinc-500 dark:text-zinc-400">
                Phase
              </div>
              <div className="mt-1 text-sm font-medium text-zinc-900 dark:text-zinc-50">
                {batchLoading ? "Loading…" : (timeSummary?.phase ?? "—")}
              </div>
            </div>

            <div className="rounded-xl border border-zinc-200 p-4 dark:border-zinc-800">
              <div className="text-xs text-zinc-500 dark:text-zinc-400">
                Funded
              </div>
              <div className="mt-1 text-sm font-medium text-zinc-900 dark:text-zinc-50">
                {batchLoading ? "Loading…" : b?.funded ? "Yes" : "No"}
              </div>
            </div>

            <div className="rounded-xl border border-zinc-200 p-4 dark:border-zinc-800">
              <div className="text-xs text-zinc-500 dark:text-zinc-400">
                Seed Revealed
              </div>
              <div className="mt-1 text-sm font-medium text-zinc-900 dark:text-zinc-50">
                {batchLoading ? "Loading…" : b?.seedRevealed ? "Yes" : "No"}
              </div>
            </div>

            <div className="rounded-xl border border-zinc-200 p-4 dark:border-zinc-800">
              <div className="text-xs text-zinc-500 dark:text-zinc-400">
                Finalized
              </div>
              <div className="mt-1 text-sm font-medium text-zinc-900 dark:text-zinc-50">
                {batchLoading ? "Loading…" : b?.finalized ? "Yes" : "No"}
              </div>
            </div>
          </div>

          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <div className="rounded-2xl border border-zinc-200 p-5 dark:border-zinc-800">
              <div className="text-sm font-medium text-zinc-900 dark:text-zinc-50">
                Randomness + Seed
              </div>
              <div className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                You must lock randomness after the prediction window, then
                reveal the seed.
              </div>

              <div className="mt-4 flex flex-wrap gap-2">
                <button
                  onClick={onLockRandomness}
                  disabled={isWorking}
                  className="inline-flex h-9 items-center justify-center rounded-xl bg-zinc-900 px-4 text-sm font-medium text-white transition hover:bg-zinc-800 disabled:opacity-60 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-200"
                >
                  {isWorking ? "Working…" : "Lock Randomness"}
                </button>

                <button
                  onClick={onGetCutoff}
                  disabled={cutoffLoading}
                  className="inline-flex h-9 items-center justify-center rounded-xl border border-zinc-200 bg-white px-4 text-sm font-medium text-zinc-900 transition hover:bg-zinc-50 disabled:opacity-60 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-50 dark:hover:bg-black"
                >
                  {cutoffLoading ? "Loading…" : "Get Cutoff"}
                </button>
              </div>

              <div className="mt-4">
                <label className="text-[11px] font-medium text-zinc-600 dark:text-zinc-300">
                  Seed (bytes32)
                </label>
                <input
                  value={seedHex}
                  onChange={(e) => setSeedHex(e.target.value)}
                  placeholder="0x..."
                  className="mt-1 w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 font-mono text-xs text-zinc-900 outline-none ring-0 focus:border-zinc-400 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-50"
                />
                <button
                  onClick={onRevealSeed}
                  disabled={isWorking}
                  className="mt-3 inline-flex h-9 items-center justify-center rounded-xl border border-zinc-200 bg-white px-4 text-sm font-medium text-zinc-900 transition hover:bg-zinc-50 disabled:opacity-60 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-50 dark:hover:bg-black"
                >
                  {isWorking ? "Working…" : "Reveal Seed"}
                </button>
              </div>

              <div className="mt-4 text-[11px] text-zinc-500 dark:text-zinc-400">
                Cutoff:{" "}
                <span className="font-mono">
                  {cutoff ? cutoff.toString() : "—"}
                </span>
              </div>
            </div>

            <div className="rounded-2xl border border-zinc-200 p-5 dark:border-zinc-800">
              <div className="text-sm font-medium text-zinc-900 dark:text-zinc-50">
                Provider Set (from DB)
              </div>
              <div className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                Pulled from your <span className="font-mono">submissions</span>{" "}
                table.
              </div>

              <div className="mt-4 flex flex-wrap gap-2">
                <button
                  onClick={loadProvidersFromDb}
                  disabled={providersLoading}
                  className="inline-flex h-9 items-center justify-center rounded-xl border border-zinc-200 bg-white px-4 text-sm font-medium text-zinc-900 transition hover:bg-zinc-50 disabled:opacity-60 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-50 dark:hover:bg-black"
                >
                  {providersLoading ? "Loading…" : "Load Providers"}
                </button>

                <button
                  onClick={onComputeSelectedIndices}
                  disabled={selectedLoading || providers.length === 0}
                  className="inline-flex h-9 items-center justify-center rounded-xl border border-zinc-200 bg-white px-4 text-sm font-medium text-zinc-900 transition hover:bg-zinc-50 disabled:opacity-60 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-50 dark:hover:bg-black"
                >
                  {selectedLoading ? "Computing…" : "Compute Selected Indices"}
                </button>
              </div>

              <div className="mt-4 max-h-44 overflow-auto rounded-xl border border-zinc-200 p-3 dark:border-zinc-800">
                {providers.length === 0 ? (
                  <div className="text-xs text-zinc-500 dark:text-zinc-400">
                    No providers loaded yet.
                  </div>
                ) : (
                  <div className="flex flex-col gap-2">
                    {providers.map((p) => {
                      const idx = selectedCommitIdx[p.toLowerCase()];
                      return (
                        <div
                          key={p}
                          className="flex items-center justify-between gap-3"
                        >
                          <div className="font-mono text-[11px] text-zinc-900 dark:text-zinc-50">
                            {p}
                          </div>
                          <div className="font-mono text-[11px] text-zinc-500 dark:text-zinc-400">
                            {idx === undefined ? "idx=—" : `idx=${idx}`}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          </div>

          <div className="mt-6 rounded-2xl border border-zinc-200 p-5 dark:border-zinc-800">
            <div className="text-sm font-medium text-zinc-900 dark:text-zinc-50">
              Finalize (Paste Payouts JSON)
            </div>
            <div className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
              Payouts must be integers in USDC base units (6 decimals). Keys are
              provider addresses.
              <span className="ml-2">
                scoresHash is computed as{" "}
                <span className="font-mono">keccak256(JSON)</span> for MVP.
              </span>
            </div>

            <textarea
              value={payoutsJson}
              onChange={(e) => setPayoutsJson(e.target.value)}
              className="mt-3 h-48 w-full rounded-xl border border-zinc-200 bg-white p-3 font-mono text-xs text-zinc-900 outline-none focus:border-zinc-400 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-50"
            />

            <div className="mt-4 flex flex-wrap items-center gap-2">
              <button
                onClick={onFinalize}
                disabled={isWorking}
                className="inline-flex h-9 items-center justify-center rounded-xl bg-zinc-900 px-4 text-sm font-medium text-white transition hover:bg-zinc-800 disabled:opacity-60 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-200"
              >
                {isWorking ? "Working…" : "Finalize Batch"}
              </button>
            </div>

            <div className="mt-3 text-[11px] text-zinc-500 dark:text-zinc-400">
              Tip: you can start with payout=0 for everyone while you wire
              scoring. Finalize still sets bond refunds/slashes.
            </div>
          </div>

          <div className="mt-6 text-xs text-zinc-500 dark:text-zinc-400">
            For MVP: you (operator) compute truth + scoring off-chain, then
            paste payouts. Later: swap this for an oracle / verifiable scoring
            pipeline.
          </div>
        </div>
      </main>
    </div>
  );
}
