// calibra/src/app/submit/page.tsx
"use client";

import React, { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  useAccount,
  useBalance,
  useChainId,
  useConnect,
  useDisconnect,
  useReadContract,
  useSwitchChain,
  usePublicClient,
  useWalletClient,
} from "wagmi";
import { formatUnits, parseUnits, type Address } from "viem";

const ADI_TESTNET_CHAIN_ID = 99999;

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
  {
    type: "function",
    name: "mint",
    stateMutability: "nonpayable",
    inputs: [
      { name: "to", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [],
  },
] as const;

const MOCK_USDC = "0xa014Dab469Eb138aa0072129458067aCd1688240" as Address;

function fmtFixed(n: number, decimals: number) {
  if (!Number.isFinite(n)) return "—";
  return n.toFixed(decimals);
}

type ActiveBatchRow = {
  id: string;
  display_time_zone: string | null;
  flight_count: number | null;
  status: string | null;
  created_at: string | null;
};

type ListActiveBatchesResponse =
  | { ok: true; batches: ActiveBatchRow[] }
  | { ok: false; error: string; details?: unknown };

function fmtDate(s?: string | null) {
  if (!s) return "—";
  const d = new Date(s);
  const ms = d.getTime();
  if (!Number.isFinite(ms)) return "—";
  return d.toLocaleString();
}

export default function SubmitHomePage() {
  const router = useRouter();

  const { address, isConnected } = useAccount();
  const chainId = useChainId();
  const { connectAsync, connectors } = useConnect();
  const { disconnect } = useDisconnect();
  const { switchChainAsync } = useSwitchChain();

  const publicClient = usePublicClient({ chainId: ADI_TESTNET_CHAIN_ID });
  const { data: walletClient } = useWalletClient({
    chainId: ADI_TESTNET_CHAIN_ID,
  });

  const [walletError, setWalletError] = useState<string | null>(null);

  const [mintBusy, setMintBusy] = useState(false);
  const [mintStatus, setMintStatus] = useState<string | null>(null);
  const [mintErr, setMintErr] = useState<string | null>(null);
  const [mintTxHash, setMintTxHash] = useState<string | null>(null);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [batches, setBatches] = useState<ActiveBatchRow[]>([]);

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

  async function ensureAdiChain() {
    if (chainId !== ADI_TESTNET_CHAIN_ID) {
      await switchChainAsync({ chainId: ADI_TESTNET_CHAIN_ID });
    }
  }

  async function mintViaWagmi() {
    setMintErr(null);
    setMintTxHash(null);

    if (!addr) {
      setMintErr("Connect your wallet first.");
      return;
    }

    try {
      setMintBusy(true);
      setMintStatus("Switching to ADI Testnet…");
      await ensureAdiChain();

      if (!publicClient) {
        setMintErr("No publicClient for ADI Testnet (99999).");
        setMintStatus(null);
        return;
      }

      if (!walletClient) {
        setMintErr(
          "No walletClient for ADI Testnet (99999). Disconnect/reconnect after switching.",
        );
        setMintStatus(null);
        return;
      }

      const amt = parseUnits("1000", usdcDecimals);

      setMintStatus("Preparing transaction…");
      const { request } = await publicClient.simulateContract({
        address: MOCK_USDC,
        abi: ERC20_ABI,
        functionName: "mint",
        args: [addr, amt],
        account: addr,
      });

      setMintStatus("Waiting for MetaMask…");
      const hash = await walletClient.writeContract(request);

      setMintTxHash(hash);
      setMintStatus("Submitted. Waiting for confirmation…");
      await publicClient.waitForTransactionReceipt({ hash });

      setMintStatus("Confirmed.");
      setTimeout(() => setMintStatus(null), 1500);
    } catch (e: any) {
      setMintErr(e?.shortMessage ?? e?.message ?? "Mint failed");
      setMintStatus(null);
    } finally {
      setMintBusy(false);
    }
  }

  async function ensureWalletReady() {
    setWalletError(null);

    if (!isConnected) {
      const connector = connectors[0];
      if (!connector) throw new Error("No wallet connector available");
      await connectAsync({ connector });
    }

    await switchChainAsync({ chainId: ADI_TESTNET_CHAIN_ID });
  }

  async function loadBatches() {
    setLoading(true);
    setError(null);

    try {
      const res = await fetch("/api/batches/list-active?limit=50", {
        method: "GET",
        cache: "no-store",
      });

      const json = (await res.json()) as ListActiveBatchesResponse;

      if (!res.ok || !json.ok) {
        setBatches([]);
        setError(json.ok ? "Request failed" : json.error);
        return;
      }

      setBatches(Array.isArray(json.batches) ? json.batches : []);
    } catch (e: any) {
      setBatches([]);
      setError(e?.message ?? "Failed to load batches");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadBatches();
  }, []);

  function openBatch(batchId: string) {
    router.push(`/submit/${encodeURIComponent(batchId)}`);
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-zinc-50 font-sans dark:bg-black">
      <main className="w-full max-w-3xl px-6 py-12">
        <div className="rounded-2xl bg-white p-8 shadow-sm dark:bg-zinc-950">
          <div className="flex items-start justify-between gap-6">
            <div className="flex flex-col gap-2">
              <h1 className="text-2xl font-semibold tracking-tight text-zinc-950 dark:text-zinc-50">
                Model Submission
              </h1>
              <div className="text-sm text-zinc-600 dark:text-zinc-400">
                Select a batch to submit predictions.
              </div>
            </div>

            <div className="flex items-center gap-2">
              {isConnected ? (
                <>
                  <div className="flex flex-col items-end gap-1">
                    <div className="text-[11px] text-zinc-500 dark:text-zinc-400">
                      {addr ? (
                        <span className="font-mono">
                          {addr.slice(0, 6)}…{addr.slice(-4)}
                        </span>
                      ) : (
                        "Connected"
                      )}
                    </div>

                    {addr ? (
                      <>
                        <div className="text-[11px] text-zinc-500 dark:text-zinc-400">
                          ADI: {adiFormatted}
                        </div>

                        <div className="text-[11px] text-zinc-500 dark:text-zinc-400">
                          USDC: {usdcFormatted}{" "}
                          {typeof usdcSymbol === "string" ? usdcSymbol : ""}
                        </div>
                      </>
                    ) : null}
                  </div>

                  <button
                    onClick={() => {
                      disconnect();
                    }}
                    className="inline-flex h-9 items-center justify-center rounded-full border border-zinc-200 bg-white px-4 text-xs font-medium text-zinc-900 transition hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-50 dark:hover:bg-black"
                  >
                    Disconnect
                  </button>

                  <button
                    onClick={mintViaWagmi}
                    disabled={mintBusy}
                    className="inline-flex h-9 items-center justify-center rounded-full border border-zinc-200 bg-white px-4 text-xs font-medium text-zinc-900 transition hover:bg-zinc-50 disabled:opacity-60 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-50 dark:hover:bg-black"
                  >
                    {mintBusy ? "Working…" : "Mint"}
                  </button>
                </>
              ) : (
                <button
                  onClick={async () => {
                    try {
                      await ensureWalletReady();
                    } catch (e: any) {
                      setWalletError(
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

          {walletError ? (
            <div className="mt-6 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-200">
              <div className="font-medium">Wallet Error</div>
              <div className="mt-1 break-words">{walletError}</div>
            </div>
          ) : null}

          {isConnected && mintErr ? (
            <div className="mt-4 rounded-xl border border-red-200 bg-red-50 p-3 text-xs text-red-700 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-200">
              {mintErr}
            </div>
          ) : null}

          {isConnected && mintStatus ? (
            <div className="mt-3 rounded-xl border border-zinc-200 bg-white p-3 text-xs text-zinc-700 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-200">
              {mintStatus}
              {mintTxHash ? (
                <div className="mt-2 font-mono break-words text-[11px] text-zinc-500 dark:text-zinc-400">
                  {mintTxHash}
                </div>
              ) : null}
            </div>
          ) : null}

          <div className="mt-6 flex items-center justify-between">
            <div className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">
              Active batches
            </div>

            <button
              onClick={loadBatches}
              disabled={loading}
              className="inline-flex h-8 items-center justify-center rounded-full border border-zinc-200 bg-white px-3 text-xs font-medium text-zinc-900 transition hover:bg-zinc-50 disabled:opacity-60 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-50 dark:hover:bg-black"
            >
              {loading ? "Loading…" : "Refresh"}
            </button>
          </div>

          {error ? (
            <div className="mt-4 rounded-xl border border-red-200 bg-red-50 p-3 text-xs text-red-700 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-200">
              {error}
            </div>
          ) : null}

          <div className="mt-4 rounded-2xl border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-950">
            {loading ? (
              <div className="text-sm text-zinc-600 dark:text-zinc-400">
                Loading…
              </div>
            ) : batches.length === 0 ? (
              <div className="text-sm text-zinc-600 dark:text-zinc-400">
                No active batches available.
              </div>
            ) : (
              <div className="flex flex-col gap-2">
                {batches.map((b) => (
                  <div
                    key={b.id}
                    className="flex items-center justify-between rounded-lg border border-zinc-200 px-3 py-2 dark:border-zinc-800"
                  >
                    <div className="flex flex-col">
                      <div className="text-sm font-medium text-zinc-900 dark:text-zinc-50">
                        {b.id}
                      </div>
                      <div className="text-[11px] text-zinc-500 dark:text-zinc-400">
                        {b.status ?? "—"} • {b.flight_count ?? 0} flights •{" "}
                        {fmtDate(b.created_at)}
                      </div>
                    </div>

                    <button
                      onClick={() => openBatch(b.id)}
                      className="inline-flex h-8 items-center justify-center rounded-lg bg-indigo-600 px-3 text-xs font-medium text-white transition hover:bg-indigo-500"
                    >
                      Predict
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
