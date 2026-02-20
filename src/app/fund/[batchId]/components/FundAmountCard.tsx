// calibra/src/app/fund/[batchId]/components/FundAmountCard.tsx
"use client";

import React, { useMemo, useState } from "react";
import {
  useAccount,
  useBalance,
  useChainId,
  usePublicClient,
  useReadContract,
  useSwitchChain,
  useWalletClient,
} from "wagmi";
import { formatUnits, parseUnits, type Address } from "viem";

type Props = {
  amountUsdc: string;
  setAmountUsdc: (v: string) => void;
  canContinue: boolean;
  isLoading: boolean;
  isSubmitting: boolean;
  onContinue: () => void;
};

const ADI_TESTNET_CHAIN_ID = 99999;
const MOCK_USDC = "0xa014Dab469Eb138aa0072129458067aCd1688240" as Address;

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

function shortAddr(a: Address) {
  return `${a.slice(0, 6)}…${a.slice(-4)}`;
}

function fmtFixed(n: number, decimals: number) {
  if (!Number.isFinite(n)) return "—";
  return n.toFixed(decimals);
}

export default function FundAmountCard({
  amountUsdc,
  setAmountUsdc,
  canContinue,
  isLoading,
  isSubmitting,
  onContinue,
}: Props) {
  const { address, isConnected } = useAccount();
  const chainId = useChainId();
  const { switchChainAsync } = useSwitchChain();

  const publicClient = usePublicClient({ chainId: ADI_TESTNET_CHAIN_ID });
  const { data: walletClient } = useWalletClient({
    chainId: ADI_TESTNET_CHAIN_ID,
  });

  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [txHash, setTxHash] = useState<string | null>(null);

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
    setErr(null);
    setTxHash(null);

    if (!addr) {
      setErr("Connect your wallet first.");
      return;
    }

    try {
      setBusy(true);
      setStatus("Switching to ADI Testnet…");
      await ensureAdiChain();

      if (!publicClient) {
        setErr("No publicClient for ADI Testnet (99999).");
        setStatus(null);
        return;
      }

      if (!walletClient) {
        setErr(
          "No walletClient for ADI Testnet (99999). Disconnect/reconnect after switching.",
        );
        setStatus(null);
        return;
      }

      const amt = parseUnits("1000", usdcDecimals);

      setStatus("Preparing transaction…");
      const { request } = await publicClient.simulateContract({
        address: MOCK_USDC,
        abi: ERC20_ABI,
        functionName: "mint",
        args: [addr, amt],
        account: addr,
      });

      setStatus("Waiting for MetaMask…");
      const hash = await walletClient.writeContract(request);

      setTxHash(hash);
      setStatus("Submitted. Waiting for confirmation…");
      await publicClient.waitForTransactionReceipt({ hash });

      setStatus("Confirmed.");
      setTimeout(() => setStatus(null), 1500);
    } catch (e: any) {
      setErr(e?.shortMessage ?? e?.message ?? "Mint failed");
      setStatus(null);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-6 rounded-2xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-950">
      <div className="flex flex-col gap-4">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">
              Funding Amount
            </div>
          </div>

          {isConnected && addr ? (
            <div className="text-xs text-zinc-500 dark:text-zinc-400">
              {shortAddr(addr)}
            </div>
          ) : null}
        </div>

        {isConnected && addr ? (
          <div className="flex flex-col gap-3">
            <div className="flex items-center justify-between gap-3 rounded-xl border border-zinc-200 bg-zinc-50 px-4 py-3 dark:border-zinc-800 dark:bg-zinc-900/30">
              <div className="flex items-center gap-6">
                <div>
                  <div className="text-[11px] text-zinc-500 dark:text-zinc-400">
                    USDC Balance
                  </div>
                  <div className="mt-0.5 text-sm font-medium text-zinc-900 dark:text-zinc-50">
                    {usdcFormatted}{" "}
                    {typeof usdcSymbol === "string" ? usdcSymbol : ""}
                  </div>
                </div>

                <div>
                  <div className="text-[11px] text-zinc-500 dark:text-zinc-400">
                    ADI Balance
                  </div>
                  <div className="mt-0.5 text-sm font-medium text-zinc-900 dark:text-zinc-50">
                    {adiFormatted}
                  </div>
                </div>
              </div>

              <button
                type="button"
                onClick={mintViaWagmi}
                disabled={busy || isSubmitting}
                className="rounded-lg border border-zinc-200 bg-white px-3 py-2 text-xs font-medium text-zinc-900 hover:bg-zinc-50 disabled:opacity-60 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-50 dark:hover:bg-zinc-900"
              >
                {busy ? "Working…" : "Mint 1,000 USDC"}
              </button>
            </div>

            {err ? (
              <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-xs text-red-700 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-200">
                {err}
              </div>
            ) : null}

            {status ? (
              <div className="rounded-xl border border-zinc-200 bg-white p-3 text-xs text-zinc-700 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-200">
                {status}
                {txHash ? (
                  <div className="mt-2 font-mono break-words text-[11px] text-zinc-500 dark:text-zinc-400">
                    {txHash}
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>
        ) : (
          <div className="rounded-xl border border-zinc-200 bg-zinc-50 p-4 text-xs text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900/30 dark:text-zinc-400">
            Wallet not connected
          </div>
        )}

        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <input
            value={amountUsdc}
            onChange={(e) => setAmountUsdc(e.target.value)}
            inputMode="decimal"
            placeholder="USDC amount (e.g. 250)"
            className="h-11 w-full rounded-xl border border-zinc-200 bg-white px-4 text-sm text-zinc-900 outline-none focus:border-zinc-400 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-50 dark:focus:border-zinc-600"
          />

          <button
            onClick={onContinue}
            disabled={!canContinue || isLoading || isSubmitting}
            className="inline-flex h-11 items-center justify-center rounded-xl bg-zinc-900 px-6 text-sm font-semibold text-white transition hover:bg-zinc-800 disabled:opacity-60 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-white"
          >
            {isSubmitting ? "Submitting…" : "Continue"}
          </button>
        </div>
      </div>
    </div>
  );
}
