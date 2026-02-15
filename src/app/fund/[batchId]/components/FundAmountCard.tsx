// calibra/src/app/fund/[batchId]/components/FundAmountCard.tsx
"use client";

import React from "react";

type Props = {
  amountUsdc: string;
  setAmountUsdc: (v: string) => void;
  canContinue: boolean;
  isLoading: boolean;
  isSubmitting: boolean;
  onContinue: () => void;

  isConnected: boolean;
  address?: string;
};

export default function FundAmountCard({
  amountUsdc,
  setAmountUsdc,
  canContinue,
  isLoading,
  isSubmitting,
  onContinue,
  isConnected,
  address,
}: Props) {
  return (
    <div className="mt-6 rounded-2xl border border-zinc-200 p-5 dark:border-zinc-800">
      <div className="flex flex-col gap-2">
        <div className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">
          Funding Amount
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

        {isConnected && address ? (
          <div className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">
            Connected: <span className="font-mono">{address}</span>
          </div>
        ) : (
          <div className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">
            Wallet not connected
          </div>
        )}
      </div>
    </div>
  );
}
