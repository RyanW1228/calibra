// calibra/src/app/page.tsx
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

const MOCK_USDC = "0x0033354Bc028fE794AE810b6D921E47389723dEd" as Address;

function fmtFixed(n: number, decimals: number) {
  if (!Number.isFinite(n)) return "—";
  return n.toFixed(decimals);
}

type ActiveBatchRow = {
  id: string;
  display_time_zone: string | null;
  flight_count: number | null;
  status: string | null;

  prediction_window_start_unix: number | null;
  prediction_window_end_unix: number | null;
};

type ListActiveBatchesResponse =
  | { ok: true; batches: ActiveBatchRow[] }
  | { ok: false; error: string; details?: unknown };

function fmtCountdown(seconds: number) {
  const s = Math.max(0, Math.floor(seconds));
  const days = Math.floor(s / 86400);
  const hours = Math.floor((s % 86400) / 3600);
  const mins = Math.floor((s % 3600) / 60);
  const secs = s % 60;

  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${mins}m`;
  if (mins > 0) return `${mins}m ${secs}s`;
  return `${secs}s`;
}

function batchTimingText(
  b: ActiveBatchRow,
  nowMs: number,
): { text: string; state: "starts" | "ends" | "ended" | "unknown" } {
  const startMs =
    typeof b.prediction_window_start_unix === "number" &&
    b.prediction_window_start_unix
      ? b.prediction_window_start_unix * 1000
      : null;
  const endMs =
    typeof b.prediction_window_end_unix === "number" &&
    b.prediction_window_end_unix
      ? b.prediction_window_end_unix * 1000
      : null;

  if (startMs && nowMs < startMs) {
    const secs = (startMs - nowMs) / 1000;
    return { text: `Starts in ${fmtCountdown(secs)}`, state: "starts" };
  }

  if (endMs && nowMs < endMs) {
    const secs = (endMs - nowMs) / 1000;
    return { text: `Ends in ${fmtCountdown(secs)}`, state: "ends" };
  }

  if (endMs && nowMs >= endMs) {
    return { text: "Ended", state: "ended" };
  }

  return { text: "—", state: "unknown" };
}

export default function HomePage() {
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
  const [batchId, setBatchId] = useState("");

  const [activeLoading, setActiveLoading] = useState(true);
  const [activeError, setActiveError] = useState<string | null>(null);
  const [activeBatches, setActiveBatches] = useState<ActiveBatchRow[]>([]);

  const [nowMs, setNowMs] = useState(() => Date.now());

  const [mintBusy, setMintBusy] = useState(false);
  const [mintStatus, setMintStatus] = useState<string | null>(null);
  const [mintErr, setMintErr] = useState<string | null>(null);
  const [mintTxHash, setMintTxHash] = useState<string | null>(null);

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

    if (chainId !== ADI_TESTNET_CHAIN_ID) {
      await switchChainAsync({ chainId: ADI_TESTNET_CHAIN_ID });
    }
  }

  function openBatch() {
    const id = batchId.trim();
    if (!id) return;
    router.push(`/batch/${encodeURIComponent(id)}`);
  }

  function openBatchById(id: string) {
    const clean = id.trim();
    if (!clean) return;
    router.push(`/batch/${encodeURIComponent(clean)}`);
  }

  async function loadActiveBatches() {
    setActiveLoading(true);
    setActiveError(null);

    try {
      if (!address) {
        setActiveBatches([]);
        setActiveError(null);
        return;
      }

      const url = `/api/batches/list-by-funder?funder=${encodeURIComponent(
        address,
      )}&limit=25`;

      const res = await fetch(url, {
        method: "GET",
        cache: "no-store",
      });

      const json = (await res.json()) as ListActiveBatchesResponse;

      if (!res.ok || !json.ok) {
        setActiveBatches([]);
        setActiveError(json.ok ? "Request failed" : json.error);
        return;
      }

      setActiveBatches(Array.isArray(json.batches) ? json.batches : []);
    } catch (e: any) {
      setActiveBatches([]);
      setActiveError(e?.message ?? "Failed to load your batches");
    } finally {
      setActiveLoading(false);
    }
  }

  useEffect(() => {
    loadActiveBatches();
  }, [address]);

  useEffect(() => {
    const hasAnyTimers = activeBatches.some((b) => {
      const start =
        typeof b.prediction_window_start_unix === "number" &&
        b.prediction_window_start_unix
          ? b.prediction_window_start_unix * 1000
          : null;
      const end =
        typeof b.prediction_window_end_unix === "number" &&
        b.prediction_window_end_unix
          ? b.prediction_window_end_unix * 1000
          : null;

      if (start && nowMs < start) return true;
      if (end && nowMs < end) return true;
      return false;
    });

    if (!hasAnyTimers) return;

    const t = window.setInterval(() => {
      setNowMs(Date.now());
    }, 1000);

    return () => window.clearInterval(t);
  }, [activeBatches, nowMs]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-zinc-50 font-sans dark:bg-black">
      <main className="w-full max-w-3xl px-6 py-12">
        <div className="rounded-2xl bg-white p-8 shadow-sm dark:bg-zinc-950">
          <div className="flex items-start justify-between gap-6">
            <div className="flex flex-col gap-2">
              <h1 className="text-2xl font-semibold tracking-tight text-zinc-950 dark:text-zinc-50">
                Calibra
              </h1>

              <p className="text-sm text-zinc-600 dark:text-zinc-400">
                Manage flight prediction batches.
              </p>
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

                    <div className="text-[11px] text-zinc-500 dark:text-zinc-400">
                      ADI: {adiFormatted}
                    </div>

                    <div className="text-[11px] text-zinc-500 dark:text-zinc-400">
                      USDC: {usdcFormatted}{" "}
                      {typeof usdcSymbol === "string" ? usdcSymbol : ""}
                    </div>
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

                  <button
                    onClick={() => router.push("/submit")}
                    className="inline-flex h-9 items-center justify-center rounded-full border border-zinc-200 bg-white px-4 text-xs font-medium text-zinc-900 transition hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-50 dark:hover:bg-black"
                  >
                    Predict
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
            </div>
          </div>

          {walletError ? (
            <div className="mt-6 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-200">
              <div className="font-medium">Wallet Error</div>
              <div className="mt-1 break-words">{walletError}</div>
            </div>
          ) : null}

          {isConnected && mintErr ? (
            <div className="mt-6 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-200">
              <div className="font-medium">Mint Error</div>
              <div className="mt-1 break-words">{mintErr}</div>
            </div>
          ) : null}

          {isConnected && mintStatus ? (
            <div className="mt-3 rounded-xl border border-zinc-200 bg-white p-4 text-sm text-zinc-700 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-200">
              {mintStatus}
              {mintTxHash ? (
                <div className="mt-2 font-mono break-words text-[11px] text-zinc-500 dark:text-zinc-400">
                  {mintTxHash}
                </div>
              ) : null}
            </div>
          ) : null}

          <div className="mt-8 flex flex-col gap-3">
            <button
              type="button"
              disabled={!isConnected}
              onClick={() => {
                if (!isConnected) return;
                router.push("/builder");
              }}
              className={[
                "inline-flex h-10 items-center justify-center rounded-xl bg-zinc-900 px-5 text-sm font-medium text-white transition",
                isConnected
                  ? "hover:bg-zinc-800 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-200"
                  : "opacity-50 cursor-not-allowed pointer-events-none",
              ].join(" ")}
            >
              Create New Batch
            </button>

            {!isConnected && (
              <div className="text-xs text-zinc-500 dark:text-zinc-400">
                Connect wallet to create a batch.
              </div>
            )}
          </div>

          <div className="mt-10 flex flex-col gap-3">
            <div className="text-sm font-medium text-zinc-900 dark:text-zinc-50">
              Open Batch
            </div>

            <div className="flex gap-2">
              <input
                value={batchId}
                onChange={(e) => setBatchId(e.target.value)}
                placeholder="Enter Batch ID"
                className="h-10 flex-1 rounded-xl border border-zinc-200 bg-white px-4 text-sm text-zinc-900 outline-none focus:border-zinc-400 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-50 dark:focus:border-zinc-600"
              />

              <button
                onClick={openBatch}
                disabled={!batchId.trim()}
                className="inline-flex h-10 items-center justify-center rounded-xl bg-emerald-600 px-5 text-sm font-medium text-white transition hover:bg-emerald-500 disabled:opacity-60"
              >
                Open
              </button>
            </div>

            <div className="mt-6 flex items-center justify-between">
              <div className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">
                Your Batches
              </div>

              <button
                onClick={loadActiveBatches}
                disabled={activeLoading}
                className="inline-flex h-8 items-center justify-center rounded-full border border-zinc-200 bg-white px-3 text-xs font-medium text-zinc-900 transition hover:bg-zinc-50 disabled:opacity-60 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-50 dark:hover:bg-black"
              >
                {activeLoading ? "Loading…" : "Refresh"}
              </button>
            </div>

            {activeError ? (
              <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-xs text-red-700 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-200">
                {activeError}
              </div>
            ) : null}

            <div className="rounded-2xl border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-950">
              {activeLoading ? (
                <div className="text-sm text-zinc-600 dark:text-zinc-400">
                  Loading…
                </div>
              ) : !address ? (
                <div className="text-sm text-zinc-600 dark:text-zinc-400">
                  Connect wallet to view your batches.
                </div>
              ) : activeBatches.length === 0 ? (
                <div className="text-sm text-zinc-600 dark:text-zinc-400">
                  No batches found for your wallet.
                </div>
              ) : (
                <div className="flex flex-col gap-2">
                  {activeBatches.map((b) => {
                    const timing = batchTimingText(b, nowMs);

                    return (
                      <div
                        key={b.id}
                        className="flex items-center justify-between rounded-lg border border-zinc-200 px-3 py-2 dark:border-zinc-800"
                      >
                        <div className="flex flex-col">
                          <div className="text-sm font-medium text-zinc-900 dark:text-zinc-50">
                            {b.id}
                          </div>
                          <div className="text-[11px] text-zinc-500 dark:text-zinc-400">
                            {timing.text} • {b.flight_count ?? 0} flights
                          </div>
                        </div>

                        <button
                          onClick={() => openBatchById(b.id)}
                          className="inline-flex h-8 items-center justify-center rounded-lg bg-emerald-600 px-3 text-xs font-medium text-white transition hover:bg-emerald-500"
                        >
                          Open
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
