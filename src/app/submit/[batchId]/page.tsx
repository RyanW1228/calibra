// calibra/src/app/audit/[batchId]/page.tsx
"use client";

import React, { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { createClient } from "@supabase/supabase-js";
import { formatUnits, type Address, type Hex, keccak256, toBytes } from "viem";
import { usePublicClient } from "wagmi";
import {
  batchIdToHash,
  CALIBRA_PROTOCOL,
  CALIBRA_PROTOCOL_ABI,
} from "@/lib/calibraOnchain";

const USDC_DECIMALS = 6;

function isHexAddress(s: string) {
  return /^0x[a-fA-F0-9]{40}$/.test(s);
}

function nowSec() {
  return Math.floor(Date.now() / 1000);
}

function fmtUsdc(x: bigint) {
  const s = formatUnits(x, USDC_DECIMALS);
  const [a, bRaw] = s.split(".");
  const b = (bRaw ?? "").slice(0, 2).padEnd(2, "0");
  return `$${a}.${b}`;
}

function ErrorBanner(props: { title: string; message: string }) {
  return (
    <div className="mt-6 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-200">
      <div className="font-medium">{props.title}</div>
      <div className="mt-1 break-words">{props.message}</div>
    </div>
  );
}

type SubmissionRow = {
  id: string;
  batch_id: string | null;
  batch_id_hash: string | null;
  provider_address: string | null;
  commit_hash: string | null;
  commit_index: number | null;
  root: string | null;
  salt: string | null;
  storage_bucket: string | null;
  storage_path: string | null;
  encrypted_uri_hash: string | null;
  created_at?: string | null;
};

type ProviderOnchain = {
  address: Address;
  joined: boolean;
  commitCount: number;
  revealedCount: number;
  bond: bigint;
  bondSettled: boolean;
  payout: bigint;
  payoutClaimed: boolean;
  selectedCommitIndex: number | null;
  selectedCommittedAt: bigint | null;
  selectedRevealed: boolean | null;
  selectedRoot: Hex | null;
  selectedPublicUriHash: Hex | null;
};

export default function AuditBatchPage() {
  const router = useRouter();
  const params = useParams<{ batchId: string }>();
  const batchId = (params?.batchId ?? "").toString();

  const publicClient = usePublicClient();

  const [uiError, setUiError] = useState<string | null>(null);

  const [batchLoading, setBatchLoading] = useState(true);
  const [batchExists, setBatchExists] = useState<boolean | null>(null);
  const [seedRevealed, setSeedRevealed] = useState<boolean>(false);
  const [finalized, setFinalized] = useState<boolean>(false);
  const [windowStart, setWindowStart] = useState<bigint | null>(null);
  const [windowEnd, setWindowEnd] = useState<bigint | null>(null);
  const [revealDeadline, setRevealDeadline] = useState<bigint | null>(null);
  const [bounty, setBounty] = useState<bigint | null>(null);
  const [joinBond, setJoinBond] = useState<bigint | null>(null);

  const [subsLoading, setSubsLoading] = useState(true);
  const [submissions, setSubmissions] = useState<SubmissionRow[]>([]);

  const [providersLoading, setProvidersLoading] = useState(true);
  const [providers, setProviders] = useState<ProviderOnchain[]>([]);

  const batchIdHash = useMemo(() => {
    if (!batchId) return null;
    return batchIdToHash(batchId);
  }, [batchId]);

  const phase = useMemo(() => {
    if (batchLoading) return "loading";
    if (!batchExists) return "not_found";
    if (!windowStart || !windowEnd || !revealDeadline) return "loading";

    const t = BigInt(nowSec());
    if (finalized) return "finalized";
    if (t < windowStart) return "prewindow";
    if (t >= windowStart && t < windowEnd) return "commit";
    if (t >= windowEnd && t <= revealDeadline) return "reveal";
    return "postreveal";
  }, [
    batchLoading,
    batchExists,
    windowStart,
    windowEnd,
    revealDeadline,
    finalized,
  ]);

  const supabase = useMemo(() => {
    const url = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").toString().trim();
    const anon = (process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "")
      .toString()
      .trim();

    if (!url || !anon) return null;
    return createClient(url, anon);
  }, []);

  useEffect(() => {
    let alive = true;

    async function loadBatch() {
      setUiError(null);
      setBatchLoading(true);

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

        if (!alive) return;

        const exists = res[0];
        setBatchExists(exists);

        if (!exists) {
          setSeedRevealed(false);
          setFinalized(false);
          setWindowStart(null);
          setWindowEnd(null);
          setRevealDeadline(null);
          setBounty(null);
          setJoinBond(null);
          return;
        }

        setWindowStart(res[3]);
        setWindowEnd(res[4]);
        setRevealDeadline(res[5]);
        setSeedRevealed(res[7] === true);
        setFinalized(res[12] === true);
        setBounty(res[13]);
        setJoinBond(res[14]);
      } catch (e: any) {
        setUiError(e?.shortMessage ?? e?.message ?? "Failed to load batch");
        setBatchExists(null);
      } finally {
        if (!alive) return;
        setBatchLoading(false);
      }
    }

    loadBatch();
    return () => {
      alive = false;
    };
  }, [publicClient, batchIdHash]);

  useEffect(() => {
    let alive = true;

    async function loadSubmissions() {
      setSubsLoading(true);
      try {
        if (!supabase) throw new Error("Missing Supabase env (public audit)");
        if (!batchIdHash) throw new Error("Missing batchIdHash");

        const { data, error } = await supabase
          .from("submissions")
          .select(
            "id,batch_id,batch_id_hash,provider_address,commit_hash,commit_index,root,salt,storage_bucket,storage_path,encrypted_uri_hash,created_at",
          )
          .eq("batch_id_hash", batchIdHash)
          .order("created_at", { ascending: true });

        if (!alive) return;

        if (error) throw new Error(error.message);

        const rows = (Array.isArray(data) ? data : []) as SubmissionRow[];
        setSubmissions(rows);
      } catch (e: any) {
        if (!alive) return;
        setUiError(e?.message ?? "Failed to load submissions");
        setSubmissions([]);
      } finally {
        if (!alive) return;
        setSubsLoading(false);
      }
    }

    loadSubmissions();
    return () => {
      alive = false;
    };
  }, [supabase, batchIdHash]);

  const providerAddresses = useMemo(() => {
    const set = new Set<string>();
    for (const r of submissions) {
      const a = (r.provider_address ?? "").toString().trim().toLowerCase();
      if (a && isHexAddress(a)) set.add(a);
    }
    return Array.from(set).sort() as Address[];
  }, [submissions]);

  useEffect(() => {
    let alive = true;

    async function loadProviders() {
      setProvidersLoading(true);
      try {
        if (!publicClient) throw new Error("No public client");
        if (!batchIdHash) throw new Error("Missing batchIdHash");

        const out: ProviderOnchain[] = [];

        for (const p of providerAddresses) {
          const ps = (await publicClient.readContract({
            address: CALIBRA_PROTOCOL,
            abi: CALIBRA_PROTOCOL_ABI,
            functionName: "getProviderSummary",
            args: [batchIdHash, p],
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

          const joined = ps[0] === true;
          const commitCount = Number(ps[2]);
          const revealedCount = Number(ps[3]);

          let selectedCommitIndex: number | null = null;
          let selectedCommittedAt: bigint | null = null;
          let selectedRevealed: boolean | null = null;
          let selectedRoot: Hex | null = null;
          let selectedPublicUriHash: Hex | null = null;

          if (joined && seedRevealed && commitCount > 0) {
            const idx = (await publicClient.readContract({
              address: CALIBRA_PROTOCOL,
              abi: CALIBRA_PROTOCOL_ABI,
              functionName: "getSelectedCommitIndex",
              args: [batchIdHash, p],
            })) as unknown as number;

            selectedCommitIndex = Number(idx);

            if (
              Number.isFinite(selectedCommitIndex) &&
              selectedCommitIndex >= 0
            ) {
              const ci = (await publicClient.readContract({
                address: CALIBRA_PROTOCOL,
                abi: CALIBRA_PROTOCOL_ABI,
                functionName: "getCommit",
                args: [batchIdHash, p, selectedCommitIndex],
              })) as unknown as readonly [Hex, bigint, boolean, Hex, Hex, Hex];

              selectedCommittedAt = ci[1];
              selectedRevealed = ci[2];
              selectedRoot = ci[3];
              selectedPublicUriHash = ci[5];
            }
          }

          out.push({
            address: p,
            joined,
            commitCount: Number.isFinite(commitCount) ? commitCount : 0,
            revealedCount: Number.isFinite(revealedCount) ? revealedCount : 0,
            bond: ps[5],
            bondSettled: ps[6] === true,
            payout: ps[7],
            payoutClaimed: ps[8] === true,
            selectedCommitIndex,
            selectedCommittedAt,
            selectedRevealed,
            selectedRoot,
            selectedPublicUriHash,
          });
        }

        if (!alive) return;

        out.sort((a, b) => a.address.localeCompare(b.address));
        setProviders(out);
      } catch (e: any) {
        if (!alive) return;
        setUiError(e?.shortMessage ?? e?.message ?? "Failed to load providers");
        setProviders([]);
      } finally {
        if (!alive) return;
        setProvidersLoading(false);
      }
    }

    loadProviders();
    return () => {
      alive = false;
    };
  }, [publicClient, batchIdHash, providerAddresses, seedRevealed]);

  const submissionsByProvider = useMemo(() => {
    const map: Record<string, SubmissionRow[]> = {};
    for (const r of submissions) {
      const a = (r.provider_address ?? "").toString().trim().toLowerCase();
      if (!a || !isHexAddress(a)) continue;
      if (!map[a]) map[a] = [];
      map[a].push(r);
    }
    for (const a of Object.keys(map)) {
      map[a].sort((x, y) => {
        const ax = x.commit_index ?? -1;
        const ay = y.commit_index ?? -1;
        if (ax !== ay) return ax - ay;

        const tx = (x.created_at ?? "").toString();
        const ty = (y.created_at ?? "").toString();
        return tx.localeCompare(ty);
      });
    }
    return map;
  }, [submissions]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-zinc-50 font-sans dark:bg-black">
      <main className="w-full max-w-6xl px-6 py-12">
        <div className="rounded-2xl bg-white p-8 shadow-sm dark:bg-zinc-950">
          <div className="flex items-start justify-between gap-6">
            <div className="flex flex-col gap-2">
              <h1 className="text-2xl font-semibold tracking-tight text-zinc-950 dark:text-zinc-50">
                Public Audit
              </h1>
              <div className="text-sm text-zinc-600 dark:text-zinc-400">
                Batch ID: <span className="font-mono">{batchId}</span>
              </div>
              <div className="text-xs text-zinc-500 dark:text-zinc-400">
                Batch Hash:{" "}
                <span className="font-mono">
                  {batchIdHash ? batchIdHash : "—"}
                </span>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={() => router.push(`/submit/${batchId}`)}
                className="inline-flex h-9 items-center justify-center rounded-full border border-zinc-200 bg-white px-4 text-xs font-medium text-zinc-900 transition hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-50 dark:hover:bg-black"
              >
                Back to Submit
              </button>
            </div>
          </div>

          {uiError ? <ErrorBanner title="Error" message={uiError} /> : null}

          <div className="mt-6 grid gap-4 sm:grid-cols-4">
            <div className="rounded-xl border border-zinc-200 p-4 dark:border-zinc-800">
              <div className="text-xs text-zinc-500 dark:text-zinc-400">
                Phase
              </div>
              <div className="mt-1 text-sm font-medium text-zinc-900 dark:text-zinc-50">
                {phase}
              </div>
            </div>

            <div className="rounded-xl border border-zinc-200 p-4 dark:border-zinc-800">
              <div className="text-xs text-zinc-500 dark:text-zinc-400">
                Seed Revealed
              </div>
              <div className="mt-1 text-sm font-medium text-zinc-900 dark:text-zinc-50">
                {batchLoading ? "Loading…" : seedRevealed ? "Yes" : "No"}
              </div>
            </div>

            <div className="rounded-xl border border-zinc-200 p-4 dark:border-zinc-800">
              <div className="text-xs text-zinc-500 dark:text-zinc-400">
                Finalized
              </div>
              <div className="mt-1 text-sm font-medium text-zinc-900 dark:text-zinc-50">
                {batchLoading ? "Loading…" : finalized ? "Yes" : "No"}
              </div>
            </div>

            <div className="rounded-xl border border-zinc-200 p-4 dark:border-zinc-800">
              <div className="text-xs text-zinc-500 dark:text-zinc-400">
                Bounty / Bond
              </div>
              <div className="mt-1 text-sm font-medium text-zinc-900 dark:text-zinc-50">
                {bounty !== null ? fmtUsdc(bounty) : "—"}{" "}
                <span className="text-xs text-zinc-500 dark:text-zinc-400">
                  / {joinBond !== null ? fmtUsdc(joinBond) : "—"}
                </span>
              </div>
            </div>
          </div>

          <div className="mt-8 flex items-center justify-between gap-3">
            <div>
              <div className="text-sm font-medium text-zinc-900 dark:text-zinc-50">
                Providers
              </div>
              <div className="text-xs text-zinc-500 dark:text-zinc-400">
                {providersLoading || subsLoading
                  ? "Loading submissions + on-chain summaries…"
                  : `${providers.length} provider(s) detected from submissions`}
              </div>
            </div>

            <button
              onClick={() => {
                setUiError(null);
                setBatchLoading(true);
                setSubsLoading(true);
                setProvidersLoading(true);
                router.refresh();
              }}
              className="inline-flex h-9 items-center justify-center rounded-xl border border-zinc-200 bg-white px-4 text-sm font-medium text-zinc-900 transition hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-50 dark:hover:bg-black"
            >
              Refresh
            </button>
          </div>

          <div className="mt-4 overflow-hidden rounded-2xl border border-zinc-200 dark:border-zinc-800">
            <div className="grid grid-cols-12 gap-0 border-b border-zinc-200 bg-zinc-50 px-4 py-3 text-[11px] font-medium text-zinc-600 dark:border-zinc-800 dark:bg-zinc-900/40 dark:text-zinc-300">
              <div className="col-span-4">Provider</div>
              <div className="col-span-2">Commits / Reveals</div>
              <div className="col-span-2">Selected Commit</div>
              <div className="col-span-2">Payout</div>
              <div className="col-span-2">Bond</div>
            </div>

            {providers.length === 0 ? (
              <div className="px-4 py-6 text-sm text-zinc-600 dark:text-zinc-400">
                {subsLoading
                  ? "Loading…"
                  : "No providers found yet (no submissions for this batch)."}
              </div>
            ) : (
              providers.map((p) => {
                const addrLower = p.address.toLowerCase();
                const rows = submissionsByProvider[addrLower] ?? [];
                const selectedRow =
                  p.selectedCommitIndex === null
                    ? null
                    : (rows.find(
                        (r) => r.commit_index === p.selectedCommitIndex,
                      ) ?? null);

                return (
                  <div
                    key={p.address}
                    className="border-b border-zinc-200 px-4 py-4 last:border-b-0 dark:border-zinc-800"
                  >
                    <div className="grid grid-cols-12 items-start gap-2">
                      <div className="col-span-4">
                        <div className="font-mono text-xs text-zinc-900 dark:text-zinc-50">
                          {p.address}
                        </div>
                        <div className="mt-1 text-[11px] text-zinc-500 dark:text-zinc-400">
                          {rows.length} submission row(s) in DB
                        </div>
                      </div>

                      <div className="col-span-2 text-sm text-zinc-900 dark:text-zinc-50">
                        {p.commitCount} / {p.revealedCount}
                      </div>

                      <div className="col-span-2">
                        <div className="text-sm text-zinc-900 dark:text-zinc-50">
                          {seedRevealed && p.selectedCommitIndex !== null
                            ? `#${p.selectedCommitIndex}`
                            : "—"}
                        </div>
                        <div className="mt-1 text-[11px] text-zinc-500 dark:text-zinc-400">
                          {seedRevealed
                            ? p.selectedCommittedAt !== null
                              ? `t=${p.selectedCommittedAt.toString()}`
                              : "t=—"
                            : "Seed not revealed"}
                        </div>
                      </div>

                      <div className="col-span-2">
                        <div className="text-sm text-zinc-900 dark:text-zinc-50">
                          {finalized ? fmtUsdc(p.payout) : "—"}
                        </div>
                        <div className="mt-1 text-[11px] text-zinc-500 dark:text-zinc-400">
                          {finalized
                            ? p.payoutClaimed
                              ? "claimed"
                              : "unclaimed"
                            : "not finalized"}
                        </div>
                      </div>

                      <div className="col-span-2">
                        <div className="text-sm text-zinc-900 dark:text-zinc-50">
                          {fmtUsdc(p.bond)}
                        </div>
                        <div className="mt-1 text-[11px] text-zinc-500 dark:text-zinc-400">
                          {p.bondSettled ? "settled" : "unsettled"}
                        </div>
                      </div>
                    </div>

                    <div className="mt-4 rounded-xl border border-zinc-200 p-4 dark:border-zinc-800">
                      <div className="text-xs font-medium text-zinc-900 dark:text-zinc-50">
                        Submissions (DB)
                      </div>

                      <div className="mt-2 overflow-x-auto">
                        <table className="w-full text-left text-xs">
                          <thead className="text-[11px] text-zinc-500 dark:text-zinc-400">
                            <tr className="border-b border-zinc-200 dark:border-zinc-800">
                              <th className="py-2 pr-3">commitIndex</th>
                              <th className="py-2 pr-3">commitHash</th>
                              <th className="py-2 pr-3">created_at</th>
                              <th className="py-2 pr-3">storage</th>
                              <th className="py-2 pr-3">selected</th>
                            </tr>
                          </thead>
                          <tbody className="text-zinc-900 dark:text-zinc-50">
                            {rows.length === 0 ? (
                              <tr>
                                <td
                                  className="py-3 text-zinc-500 dark:text-zinc-400"
                                  colSpan={5}
                                >
                                  No submission rows found for this provider.
                                </td>
                              </tr>
                            ) : (
                              rows.map((r) => {
                                const isSelected =
                                  seedRevealed &&
                                  p.selectedCommitIndex !== null &&
                                  r.commit_index === p.selectedCommitIndex;

                                const storage =
                                  r.storage_bucket && r.storage_path
                                    ? `sb://${r.storage_bucket}/${r.storage_path}`
                                    : "—";

                                return (
                                  <tr
                                    key={r.id}
                                    className="border-b border-zinc-100 last:border-b-0 dark:border-zinc-900/60"
                                  >
                                    <td className="py-2 pr-3 font-mono">
                                      {r.commit_index ?? "—"}
                                    </td>
                                    <td className="py-2 pr-3 font-mono">
                                      {(r.commit_hash ?? "—").toString()}
                                    </td>
                                    <td className="py-2 pr-3 font-mono text-[11px] text-zinc-600 dark:text-zinc-400">
                                      {(r.created_at ?? "—").toString()}
                                    </td>
                                    <td className="py-2 pr-3 font-mono text-[11px] text-zinc-600 dark:text-zinc-400">
                                      {storage}
                                    </td>
                                    <td className="py-2 pr-3">
                                      {isSelected ? (
                                        <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-200">
                                          selected
                                        </span>
                                      ) : (
                                        <span className="text-[11px] text-zinc-500 dark:text-zinc-400">
                                          —
                                        </span>
                                      )}
                                    </td>
                                  </tr>
                                );
                              })
                            )}
                          </tbody>
                        </table>
                      </div>

                      {seedRevealed && p.selectedCommitIndex !== null ? (
                        <div className="mt-3 text-[11px] text-zinc-500 dark:text-zinc-400">
                          Selected row found in DB:{" "}
                          <span className="font-mono">
                            {selectedRow ? "yes" : "no"}
                          </span>
                          {selectedRow ? (
                            <>
                              {" "}
                              • commitHash{" "}
                              <span className="font-mono">
                                {(selectedRow.commit_hash ?? "").toString()}
                              </span>
                            </>
                          ) : null}
                        </div>
                      ) : null}
                    </div>
                  </div>
                );
              })
            )}
          </div>

          <div className="mt-6 text-xs text-zinc-500 dark:text-zinc-400">
            MVP note: this page audits the on-chain selected commit index + the
            stored submission metadata. Scored outcomes and per-flight truth
            values should be added once your operator scoring pipeline writes a
            public score artifact (or a DB table) keyed by{" "}
            <span className="font-mono">
              (batch_id_hash, provider_address, commit_index)
            </span>
            .
          </div>
        </div>
      </main>
    </div>
  );
}
