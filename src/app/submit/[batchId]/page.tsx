// calibra/src/app/submit/[batchId]/page.tsx
"use client";

import React, { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import PredictionsTable from "./components/PredictionsTable";
import {
  useAccount,
  useChainId,
  useConnect,
  useDisconnect,
  usePublicClient,
  useSignMessage,
  useSwitchChain,
  useWriteContract,
} from "wagmi";
import { parseUnits, type Address, type Hex } from "viem";
import {
  ADI_TESTNET_CHAIN_ID,
  batchIdToHash,
  CALIBRA_PROTOCOL,
  CALIBRA_PROTOCOL_ABI,
  MOCK_USDC,
  USDC_ABI,
} from "@/lib/calibraOnchain";

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
        thresholds_minutes?: number[] | null;
      };
      flights: BatchFlight[];
    }
  | { ok: false; error: string; details?: unknown };

type BatchInfo = Extract<BatchGetResponse, { ok: true }>["batch"];

type OnchainBatch = {
  exists: boolean;
  operator: Address;
  funder: Address;
  windowStart: bigint;
  windowEnd: bigint;
  revealDeadline: bigint;
  funded: boolean;
  finalized: boolean;
  joinBond: bigint;
};

type ProviderSummary = {
  joined: boolean;
  joinedAt: bigint;
  commitCount: bigint;
  revealedCount: bigint;
  lastCommitAt: bigint;
  bond: bigint;
  bondSettled: boolean;
  payout: bigint;
  payoutClaimed: boolean;
};

function isHex(s: string) {
  return /^0x[0-9a-fA-F]*$/.test(s);
}

function base64ToHex(b64: string): Hex {
  const buf = Buffer.from(b64, "base64");
  return (`0x${buf.toString("hex")}` as Hex) || ("0x" as Hex);
}

function nowSecBigint() {
  return BigInt(Math.floor(Date.now() / 1000));
}

function buildAuthMessage(
  address: string,
  nonce: string,
  expiresAtIso: string,
) {
  return (
    `Calibra login\n` +
    `Address: ${address}\n` +
    `Nonce: ${nonce}\n` +
    `Expires: ${expiresAtIso}`
  );
}

export default function SubmitBatchPage() {
  const router = useRouter();
  const params = useParams<{ batchId: string }>();
  const batchId = (params?.batchId ?? "").toString();

  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [batch, setBatch] = useState<BatchInfo | null>(null);
  const [flights, setFlights] = useState<BatchFlight[]>([]);

  const [predByScheduleKey, setPredByScheduleKey] = useState<
    Record<string, Record<string, string>>
  >({});

  const [uiError, setUiError] = useState<string | null>(null);
  const [uiOk, setUiOk] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const [isOnchainLoading, setIsOnchainLoading] = useState(true);
  const [onchainError, setOnchainError] = useState<string | null>(null);
  const [onchainBatch, setOnchainBatch] = useState<OnchainBatch | null>(null);
  const [provider, setProvider] = useState<ProviderSummary | null>(null);

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
  const { signMessageAsync } = useSignMessage();

  const addr = useMemo(() => {
    if (!address) return null;
    return address as Address;
  }, [address]);

  const batchIdHash = useMemo(() => {
    if (!batchId) return null;
    return batchIdToHash(batchId);
  }, [batchId]);

  const phase = useMemo(() => {
    const b = onchainBatch;
    if (!b) return "loading" as const;

    const t = nowSecBigint();
    if (b.finalized) return "finalized" as const;
    if (t < b.windowStart) return "prewindow" as const;
    if (t >= b.windowStart && t < b.windowEnd) return "commit" as const;
    if (t >= b.windowEnd && t <= b.revealDeadline) return "reveal" as const;
    return "postreveal" as const;
  }, [onchainBatch]);

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

  async function loadOnchain() {
    setIsOnchainLoading(true);
    setOnchainError(null);

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
        setOnchainBatch(null);
        setProvider(null);
        setOnchainError("Batch not found on-chain");
        return;
      }

      setOnchainBatch({
        exists,
        operator: res[1],
        funder: res[2],
        windowStart: res[3],
        windowEnd: res[4],
        revealDeadline: res[5],
        funded: res[11],
        finalized: res[12],
        joinBond: res[14],
      });

      if (addr) {
        const ps = (await publicClient.readContract({
          address: CALIBRA_PROTOCOL,
          abi: CALIBRA_PROTOCOL_ABI,
          functionName: "getProviderSummary",
          args: [batchIdHash, addr],
        })) as unknown as readonly [
          boolean,
          bigint,
          number,
          number,
          bigint,
          bigint,
          boolean,
          bigint,
          boolean,
        ];

        setProvider({
          joined: ps[0],
          joinedAt: ps[1],
          commitCount: BigInt(ps[2]),
          revealedCount: BigInt(ps[3]),
          lastCommitAt: ps[4],
          bond: ps[5],
          bondSettled: ps[6],
          payout: ps[7],
          payoutClaimed: ps[8],
        });
      } else {
        setProvider(null);
      }
    } catch (e: any) {
      setOnchainError(
        e?.shortMessage ?? e?.message ?? "Failed to load on-chain",
      );
    } finally {
      setIsOnchainLoading(false);
    }
  }

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
          `/api/batches/get-enriched?batchId=${encodeURIComponent(batchId)}`,
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

        const fs = Array.isArray(json.flights) ? json.flights : [];
        setFlights(fs);

        setPredByScheduleKey((prev) => {
          const next: Record<string, Record<string, string>> = { ...prev };
          for (const f of fs) {
            const key = (f.schedule_key ?? "").trim();
            if (!key) continue;
            if (!next[key]) next[key] = {};
          }
          return next;
        });
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
    if (!publicClient) return;
    if (!batchIdHash) return;
    loadOnchain();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [publicClient, batchIdHash, addr]);

  async function ensureAllowanceAtLeast(required: bigint) {
    if (!publicClient) throw new Error("No public client");
    if (!addr) throw new Error("Wallet not connected");

    const allowance = (await publicClient.readContract({
      address: MOCK_USDC,
      abi: USDC_ABI,
      functionName: "allowance",
      args: [addr, CALIBRA_PROTOCOL],
    })) as unknown as bigint;

    if (allowance >= required) return;

    const approveHash = await writeContractAsync({
      address: MOCK_USDC,
      abi: USDC_ABI,
      functionName: "approve",
      args: [CALIBRA_PROTOCOL, required],
      chainId: ADI_TESTNET_CHAIN_ID,
    });

    await publicClient.waitForTransactionReceipt({ hash: approveHash });
  }

  async function onJoin() {
    setUiError(null);
    setUiOk(null);

    try {
      setIsSubmitting(true);

      if (!batchIdHash) throw new Error("Missing batchIdHash");
      if (!publicClient) throw new Error("No public client");

      await ensureWalletReady();

      const b = onchainBatch;
      if (!b?.exists) throw new Error("Batch not loaded");
      if (!b.funded) throw new Error("Batch is not funded");
      if (b.joinBond <= BigInt(0)) throw new Error("Join bond not set");

      await ensureAllowanceAtLeast(b.joinBond);

      const joinHash = await writeContractAsync({
        address: CALIBRA_PROTOCOL,
        abi: CALIBRA_PROTOCOL_ABI,
        functionName: "join",
        args: [batchIdHash],
        chainId: ADI_TESTNET_CHAIN_ID,
      });

      await publicClient.waitForTransactionReceipt({ hash: joinHash });

      setUiOk("Joined. You can now submit during the prediction window.");
      await loadOnchain();
    } catch (e: any) {
      setUiError(e?.shortMessage ?? e?.message ?? "Join failed");
    } finally {
      setIsSubmitting(false);
    }
  }

  async function getNonceForSignature(addressLower: string) {
    const res = await fetch("/api/auth/nonce", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ address: addressLower }),
    });

    const json = (await res.json().catch(() => null)) as any;
    if (!res.ok || !json?.ok) {
      throw new Error((json?.error ?? "Failed to get nonce").toString());
    }

    const nonce = (json?.nonce ?? "").toString();
    const expiresAt = (json?.expiresAt ?? json?.expires_at ?? "").toString();

    if (!nonce || !expiresAt) throw new Error("Bad nonce response");
    return { nonce, expiresAt };
  }

  async function onSubmit() {
    setUiError(null);
    setUiOk(null);

    if (flights.length === 0) {
      setUiError("No flights to predict for this batch");
      return;
    }

    const b = onchainBatch;
    if (!b?.exists) {
      setUiError("On-chain batch not loaded yet");
      return;
    }

    if (phase !== "commit") {
      setUiError("Submissions are only allowed during the prediction window.");
      return;
    }

    if (!provider?.joined) {
      setUiError("You must join before submitting.");
      return;
    }

    if (!batchIdHash) {
      setUiError("Missing batchIdHash");
      return;
    }

    const payload: {
      schedule_key: string;
      probabilities: Record<string, number>;
    }[] = [];

    for (const f of flights) {
      const key = (f.schedule_key ?? "").trim();
      if (!key) continue;

      const row = predByScheduleKey[key] ?? {};
      const probs: Record<string, number> = {};

      for (const [label, raw0] of Object.entries(row)) {
        const raw = (raw0 ?? "").trim();
        if (!raw) continue;

        const x = Number(raw);
        if (!Number.isFinite(x) || x < 0 || x > 100) {
          setUiError(`Invalid probability for ${key} (${label}). Use 0–100.`);
          return;
        }

        probs[label] = Math.round(x * 100) / 100;
      }

      if (Object.keys(probs).length === 0) continue;

      payload.push({
        schedule_key: key,
        probabilities: probs,
      });
    }

    if (payload.length === 0) {
      setUiError("Enter at least one prediction to submit");
      return;
    }

    try {
      setIsSubmitting(true);

      if (!publicClient) throw new Error("No public client");

      await ensureWalletReady();

      if (!addr) throw new Error("Wallet not connected");

      const addressLower = addr.toLowerCase();
      const { nonce, expiresAt } = await getNonceForSignature(addressLower);

      const message = buildAuthMessage(addressLower, nonce, expiresAt);
      const signature = (await signMessageAsync({
        message,
      })) as Hex;

      const uploadRes = await fetch("/api/submissions/upload", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          address: addressLower,
          signature,
          batchId,
          batchIdHash,
          payload: {
            v: 1,
            created_at_unix: Math.floor(Date.now() / 1000),
            batch_id: batchId,
            batch_id_hash: batchIdHash,
            provider_address: addressLower,
            predictions: payload,
          },
        }),
      });

      const uploadJson = (await uploadRes.json().catch(() => null)) as any;
      if (!uploadRes.ok || !uploadJson?.ok) {
        throw new Error((uploadJson?.error ?? "Upload failed").toString());
      }

      const commitHash = (
        uploadJson?.commitHash ??
        uploadJson?.commit_hash ??
        ""
      )
        .toString()
        .trim();

      if (!commitHash || !isHex(commitHash) || commitHash.length !== 66) {
        throw new Error("Upload did not return a valid commitHash");
      }

      const encryptedUriHashAny =
        uploadJson?.encryptedUriHash ??
        uploadJson?.encrypted_uri_hash ??
        uploadJson?.encryptedUriHashHex ??
        uploadJson?.encrypted_uri_hash_hex ??
        uploadJson?.encryptedUriHashB64 ??
        uploadJson?.encrypted_uri_hash_b64 ??
        "";

      let encryptedUriHash: Hex = "0x" as Hex;

      if (typeof encryptedUriHashAny === "string") {
        const s = encryptedUriHashAny.trim();
        if (s.startsWith("0x")) encryptedUriHash = s as Hex;
        else encryptedUriHash = base64ToHex(s);
      } else {
        throw new Error("Upload did not return encryptedUriHash");
      }

      const beforeCount = (await publicClient.readContract({
        address: CALIBRA_PROTOCOL,
        abi: CALIBRA_PROTOCOL_ABI,
        functionName: "getCommitCount",
        args: [batchIdHash, addr],
      })) as unknown as number;

      const txHash = await writeContractAsync({
        address: CALIBRA_PROTOCOL,
        abi: CALIBRA_PROTOCOL_ABI,
        functionName: "commit",
        args: [batchIdHash, commitHash as Hex, encryptedUriHash],
        chainId: ADI_TESTNET_CHAIN_ID,
      });

      await publicClient.waitForTransactionReceipt({ hash: txHash });

      const afterCount = (await publicClient.readContract({
        address: CALIBRA_PROTOCOL,
        abi: CALIBRA_PROTOCOL_ABI,
        functionName: "getCommitCount",
        args: [batchIdHash, addr],
      })) as unknown as number;

      const newIndex = Math.max(0, afterCount - 1);

      setUiOk(
        `Committed on-chain (commitIndex ${newIndex}). You can reveal after the window ends.`,
      );

      await loadOnchain();
    } catch (e: any) {
      setUiError(e?.shortMessage ?? e?.message ?? "Submit failed");
    } finally {
      setIsSubmitting(false);
    }
  }

  async function onRevealLatest() {
    setUiError(null);
    setUiOk(null);

    try {
      setIsSubmitting(true);

      if (!batchIdHash) throw new Error("Missing batchIdHash");
      if (!publicClient) throw new Error("No public client");

      await ensureWalletReady();

      if (!addr) throw new Error("Wallet not connected");
      if (!provider?.joined) throw new Error("Not joined");
      if (phase !== "reveal") throw new Error("Not in reveal window");

      const addressLower = addr.toLowerCase();
      const { nonce, expiresAt } = await getNonceForSignature(addressLower);

      const message = buildAuthMessage(addressLower, nonce, expiresAt);
      const signature = (await signMessageAsync({ message })) as Hex;

      const readRes = await fetch("/api/submissions/read", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          address: addressLower,
          signature,
          batchIdHash,
          providerAddress: addressLower,
        }),
      });

      const readJson = (await readRes.json().catch(() => null)) as any;
      if (!readRes.ok || !readJson?.ok) {
        throw new Error((readJson?.error ?? "Read failed").toString());
      }

      const submission = readJson?.submission ?? {};
      const root = (submission?.root ?? "").toString().trim();
      const salt = (submission?.salt ?? "").toString().trim();

      if (!root || !isHex(root) || root.length !== 66) {
        throw new Error("Submission missing root");
      }
      if (!salt || !isHex(salt) || salt.length !== 66) {
        throw new Error("Submission missing salt");
      }

      const payload = readJson?.payload ?? {};
      const publicUriAny =
        payload?.publicUri ??
        payload?.public_uri ??
        payload?.publicUriB64 ??
        payload?.public_uri_b64 ??
        null;

      if (publicUriAny === null || publicUriAny === undefined) {
        throw new Error("Submission payload missing publicUri");
      }

      let publicUriBytes: Hex = "0x" as Hex;

      if (typeof publicUriAny === "string") {
        const s = publicUriAny.trim();
        if (s.startsWith("0x")) publicUriBytes = s as Hex;
        else publicUriBytes = base64ToHex(s);
      } else {
        throw new Error("Unsupported publicUri type");
      }

      const commitCountNum = Number(provider.commitCount);
      if (!Number.isFinite(commitCountNum) || commitCountNum <= 0) {
        throw new Error("No commits found");
      }

      const latestIndex = commitCountNum - 1;

      const txHash = await writeContractAsync({
        address: CALIBRA_PROTOCOL,
        abi: CALIBRA_PROTOCOL_ABI,
        functionName: "revealCommits",
        args: [
          batchIdHash,
          [latestIndex],
          [root as Hex],
          [salt as Hex],
          [publicUriBytes],
        ],
        chainId: ADI_TESTNET_CHAIN_ID,
      });

      await publicClient.waitForTransactionReceipt({ hash: txHash });

      setUiOk(`Revealed commitIndex ${latestIndex}.`);
      await loadOnchain();
    } catch (e: any) {
      setUiError(e?.shortMessage ?? e?.message ?? "Reveal failed");
    } finally {
      setIsSubmitting(false);
    }
  }

  const canJoin = useMemo(() => {
    if (!onchainBatch?.exists) return false;
    if (!onchainBatch.funded) return false;
    if (onchainBatch.finalized) return false;
    if (provider?.joined) return false;
    if (phase === "postreveal" || phase === "finalized") return false;
    return true;
  }, [onchainBatch, provider, phase]);

  const canSubmit = useMemo(() => {
    if (!provider?.joined) return false;
    if (phase !== "commit") return false;
    return true;
  }, [provider, phase]);

  const canReveal = useMemo(() => {
    if (!provider?.joined) return false;
    if (phase !== "reveal") return false;
    return true;
  }, [provider, phase]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-zinc-50 font-sans dark:bg-black">
      <main className="w-full max-w-5xl px-6 py-12">
        <div className="rounded-2xl bg-white p-8 shadow-sm dark:bg-zinc-950">
          <div className="flex items-start justify-between gap-6">
            <div className="flex flex-col gap-2">
              <h1 className="text-2xl font-semibold tracking-tight text-zinc-950 dark:text-zinc-50">
                Submit Predictions
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
                      setUiError(
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
                onClick={() => router.push("/submit")}
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

          {onchainError ? (
            <div className="mt-6 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-200">
              <div className="font-medium">On-chain Error</div>
              <div className="mt-1">{onchainError}</div>
            </div>
          ) : null}

          {uiError ? (
            <div className="mt-6 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-200">
              <div className="font-medium">Action Error</div>
              <div className="mt-1 break-words">{uiError}</div>
            </div>
          ) : null}

          {uiOk ? (
            <div className="mt-6 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800 dark:border-emerald-900/50 dark:bg-emerald-950/30 dark:text-emerald-200">
              <div className="font-medium">OK</div>
              <div className="mt-1 break-words">{uiOk}</div>
            </div>
          ) : null}

          <div className="mt-6 grid gap-4 sm:grid-cols-3">
            <div className="rounded-xl border border-zinc-200 p-4 dark:border-zinc-800">
              <div className="text-xs text-zinc-500 dark:text-zinc-400">
                Phase
              </div>
              <div className="mt-1 text-sm font-medium text-zinc-900 dark:text-zinc-50">
                {isOnchainLoading ? "Loading…" : phase}
              </div>
            </div>

            <div className="rounded-xl border border-zinc-200 p-4 dark:border-zinc-800">
              <div className="text-xs text-zinc-500 dark:text-zinc-400">
                Joined
              </div>
              <div className="mt-1 text-sm font-medium text-zinc-900 dark:text-zinc-50">
                {provider?.joined
                  ? "Yes"
                  : isOnchainLoading
                    ? "Loading…"
                    : "No"}
              </div>
            </div>

            <div className="rounded-xl border border-zinc-200 p-4 dark:border-zinc-800">
              <div className="text-xs text-zinc-500 dark:text-zinc-400">
                Commits / Reveals
              </div>
              <div className="mt-1 text-sm font-medium text-zinc-900 dark:text-zinc-50">
                {provider
                  ? `${provider.commitCount.toString()} / ${provider.revealedCount.toString()}`
                  : isOnchainLoading
                    ? "Loading…"
                    : "—"}
              </div>
            </div>
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-2">
            <button
              onClick={loadOnchain}
              disabled={isOnchainLoading}
              className="inline-flex h-9 items-center justify-center rounded-xl border border-zinc-200 bg-white px-4 text-sm font-medium text-zinc-900 transition hover:bg-zinc-50 disabled:opacity-60 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-50 dark:hover:bg-black"
            >
              {isOnchainLoading ? "Refreshing…" : "Refresh On-chain"}
            </button>

            <button
              onClick={onJoin}
              disabled={!canJoin || isSubmitting}
              className="inline-flex h-9 items-center justify-center rounded-xl bg-zinc-900 px-4 text-sm font-medium text-white transition hover:bg-zinc-800 disabled:opacity-60 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-200"
            >
              {isSubmitting ? "Working…" : "Join (Bond)"}
            </button>

            <button
              onClick={onRevealLatest}
              disabled={!canReveal || isSubmitting}
              className="inline-flex h-9 items-center justify-center rounded-xl border border-zinc-200 bg-white px-4 text-sm font-medium text-zinc-900 transition hover:bg-zinc-50 disabled:opacity-60 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-50 dark:hover:bg-black"
            >
              {isSubmitting ? "Working…" : "Reveal Latest"}
            </button>

            <div className="ml-auto text-xs text-zinc-500 dark:text-zinc-400">
              Display Time Zone: <span className="font-mono">{tz}</span>
            </div>
          </div>

          <PredictionsTable
            flights={flights}
            isLoading={isLoading || isOnchainLoading}
            thresholdsMinutes={batch?.thresholds_minutes ?? null}
            predByScheduleKey={predByScheduleKey}
            setPredByScheduleKey={setPredByScheduleKey}
            onSubmit={
              canSubmit ? onSubmit : () => setUiError("Not in commit phase")
            }
            isSubmitting={isSubmitting}
          />
        </div>
      </main>
    </div>
  );
}
