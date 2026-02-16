// calibra/src/app/page.tsx
"use client";

import React, { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  useAccount,
  useChainId,
  useConnect,
  useDisconnect,
  useSwitchChain,
} from "wagmi";
import type { Address } from "viem";

const ADI_TESTNET_CHAIN_ID = 99999;

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

export default function HomePage() {
  const router = useRouter();

  const { address, isConnected } = useAccount();
  const chainId = useChainId();
  const { connectAsync, connectors } = useConnect();
  const { disconnect } = useDisconnect();
  const { switchChainAsync } = useSwitchChain();

  const [walletError, setWalletError] = useState<string | null>(null);

  const [batchId, setBatchId] = useState("");

  const [activeLoading, setActiveLoading] = useState(true);
  const [activeError, setActiveError] = useState<string | null>(null);
  const [activeBatches, setActiveBatches] = useState<ActiveBatchRow[]>([]);

  const addr = useMemo(() => {
    if (!address) return null;
    return address as Address;
  }, [address]);

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
    router.push(`/batch/${encodeURIComponent(id)}`);
  }

  async function loadActiveBatches() {
    setActiveLoading(true);
    setActiveError(null);

    try {
      const res = await fetch("/api/batches/list-active?limit=25", {
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
      setActiveError(e?.message ?? "Failed to load active batches");
    } finally {
      setActiveLoading(false);
    }
  }

  useEffect(() => {
    loadActiveBatches();
  }, []);

  return (
    <div className="flex min-h-screen items-center justify-center bg-zinc-50 font-sans dark:bg-black">
      <main className="w-full max-w-2xl px-6 py-12">
        <div className="rounded-2xl bg-white p-8 shadow-sm dark:bg-zinc-950">
          <div className="flex items-start justify-between gap-6">
            <div className="flex flex-col gap-2">
              <h1 className="text-2xl font-semibold tracking-tight text-zinc-950 dark:text-zinc-50">
                Calibra
              </h1>

              <p className="text-sm text-zinc-600 dark:text-zinc-400">
                Create and fund flight prediction batches.
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
                      Chain:{" "}
                      <span className="font-mono">
                        {typeof chainId === "number" ? chainId : "—"}
                      </span>
                    </div>
                  </div>

                  <button
                    onClick={async () => {
                      try {
                        await ensureWalletReady();
                      } catch (e: any) {
                        setWalletError(
                          e?.shortMessage ??
                            e?.message ??
                            "Failed to switch chain",
                        );
                      }
                    }}
                    className="inline-flex h-9 items-center justify-center rounded-full border border-zinc-200 bg-white px-4 text-xs font-medium text-zinc-900 transition hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-50 dark:hover:bg-black"
                  >
                    Switch to ADI
                  </button>

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

          {/* Create New Batch */}
          <div className="mt-8 flex flex-col gap-3">
            <div className="text-sm font-medium text-zinc-900 dark:text-zinc-50">
              Start a new batch
            </div>

            <button
              onClick={() => router.push("/builder")}
              className="inline-flex h-10 items-center justify-center rounded-xl bg-zinc-900 px-5 text-sm font-medium text-white transition hover:bg-zinc-800 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-200"
            >
              Create New Batch
            </button>
          </div>

          {/* Open Existing Batch */}
          <div className="mt-10 flex flex-col gap-3">
            <div className="text-sm font-medium text-zinc-900 dark:text-zinc-50">
              Open existing batch
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

            <div className="text-xs text-zinc-500 dark:text-zinc-400">
              This will navigate to the funding page for the batch.
            </div>

            {/* Active Batches */}
            <div className="mt-6 flex items-center justify-between">
              <div className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">
                Active batches
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
              ) : activeBatches.length === 0 ? (
                <div className="text-sm text-zinc-600 dark:text-zinc-400">
                  No active batches found.
                </div>
              ) : (
                <div className="flex flex-col gap-2">
                  {activeBatches.map((b) => (
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
                        onClick={() => openBatchById(b.id)}
                        className="inline-flex h-8 items-center justify-center rounded-lg bg-emerald-600 px-3 text-xs font-medium text-white transition hover:bg-emerald-500"
                      >
                        Open
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
