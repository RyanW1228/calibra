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
import {
  encodeFunctionData,
  formatUnits,
  parseUnits,
  type Address,
  type Hex,
} from "viem";

type Props = {
  amountUsdc: string;
  setAmountUsdc: (v: string) => void;
  canContinue: boolean;
  isLoading: boolean;
  isSubmitting: boolean;
  onContinue: () => void;
};

const ADI_TESTNET_CHAIN_ID = 99999;
const MOCK_USDC = "0x4fA65A338618FA771bA11eb37892641cBD055f98" as Address;

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
    if (!Number.isFinite(n)) return "—";
    return n.toFixed(2);
  }, [usdcBalRaw, usdcDecimals]);

  const adiFormatted = useMemo(() => {
    if (!adiBal) return "—";
    const n = Number(formatUnits(adiBal.value, adiBal.decimals));
    if (!Number.isFinite(n)) return "—";
    return n.toFixed(4);
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

  async function mintViaRawMetamask() {
    setErr(null);
    setTxHash(null);

    if (!addr) {
      setErr("Connect your wallet first.");
      return;
    }

    const eth = (window as any)?.ethereum;
    if (!eth?.request) {
      setErr("window.ethereum is missing (MetaMask not detected).");
      return;
    }

    try {
      setBusy(true);
      setStatus("Requesting wallet permissions…");

      await eth.request({ method: "eth_requestAccounts" });

      setStatus("Switching to ADI Testnet…");
      await eth.request({
        method: "wallet_switchEthereumChain",
        params: [{ chainId: "0x1869f" }],
      });

      const amt = parseUnits("1000", usdcDecimals);

      const data = encodeFunctionData({
        abi: ERC20_ABI,
        functionName: "mint",
        args: [addr, amt],
      }) as Hex;

      setStatus("Waiting for MetaMask… (check the extension if no popup)");

      const sendPromise = eth.request({
        method: "eth_sendTransaction",
        params: [{ from: addr, to: MOCK_USDC, data }],
      }) as Promise<Hex>;

      const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(
          () =>
            reject(
              new Error(
                "MetaMask did not open. Click the MetaMask extension and check Activity for a pending confirmation.",
              ),
            ),
          15_000,
        ),
      );

      const hash = await Promise.race([sendPromise, timeoutPromise]);

      setTxHash(hash);
      setStatus("Submitted. Waiting for confirmation…");
      await publicClient?.waitForTransactionReceipt({ hash });

      setStatus("Confirmed.");
      setTimeout(() => setStatus(null), 1500);
    } catch (e: any) {
      setErr(e?.message ?? "Raw mint failed");
      setStatus(null);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-6 rounded-2xl border border-zinc-200 p-5 dark:border-zinc-800">
      <div className="flex flex-col gap-2">
        <div className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">
          Funding Amount
        </div>

        <div className="mt-3 rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950">
          {isConnected && addr ? (
            <div className="flex flex-col gap-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="text-xs text-zinc-500 dark:text-zinc-400">
                  Connected: <span className="font-mono">{addr}</span>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={mintViaWagmi}
                    disabled={busy || isSubmitting}
                    className="rounded-lg border border-zinc-200 px-3 py-2 text-xs text-zinc-900 hover:bg-zinc-50 disabled:opacity-60 dark:border-zinc-800 dark:text-zinc-50 dark:hover:bg-zinc-900"
                  >
                    {busy ? "Working…" : "Mint 1,000 USDC"}
                  </button>

                  <button
                    type="button"
                    onClick={mintViaRawMetamask}
                    disabled={busy || isSubmitting}
                    className="rounded-lg border border-zinc-200 px-3 py-2 text-xs text-zinc-900 hover:bg-zinc-50 disabled:opacity-60 dark:border-zinc-800 dark:text-zinc-50 dark:hover:bg-zinc-900"
                  >
                    {busy ? "Working…" : "Mint (Raw MetaMask)"}
                  </button>
                </div>
              </div>

              <div className="grid gap-2 sm:grid-cols-2">
                <div className="rounded-lg border border-zinc-200 p-3 dark:border-zinc-800">
                  <div className="text-[11px] text-zinc-500 dark:text-zinc-400">
                    USDC Balance (
                    {typeof usdcSymbol === "string" ? usdcSymbol : "token"} @{" "}
                    <span className="font-mono">{MOCK_USDC}</span>)
                  </div>
                  <div className="mt-1 text-sm font-medium text-zinc-900 dark:text-zinc-50">
                    {usdcFormatted}
                  </div>
                </div>

                <div className="rounded-lg border border-zinc-200 p-3 dark:border-zinc-800">
                  <div className="text-[11px] text-zinc-500 dark:text-zinc-400">
                    ADI Balance
                  </div>
                  <div className="mt-1 text-sm font-medium text-zinc-900 dark:text-zinc-50">
                    {adiFormatted}
                  </div>
                </div>
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
            <div className="text-xs text-zinc-500 dark:text-zinc-400">
              Wallet not connected
            </div>
          )}
        </div>

        <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-center">
          <input
            value={amountUsdc}
            onChange={(e) => setAmountUsdc(e.target.value)}
            inputMode="decimal"
            placeholder="USDC amount (e.g. 250)"
            className="h-10 w-full rounded-xl border border-zinc-200 bg-white px-4 text-sm text-zinc-900 outline-none focus:border-zinc-400 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-50 dark:focus:border-zinc-600"
          />

          <button
            onClick={onContinue}
            disabled={!canContinue || isLoading || isSubmitting}
            className="inline-flex h-10 items-center justify-center rounded-xl bg-emerald-600 px-5 text-sm font-medium text-white transition hover:bg-emerald-500 disabled:opacity-60"
          >
            {isSubmitting ? "Submitting…" : "Continue"}
          </button>
        </div>
      </div>
    </div>
  );
}
