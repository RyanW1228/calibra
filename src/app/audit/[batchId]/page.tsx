// calibra/src/app/audit/[batchId]/page.tsx
"use client";

import React, { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { createClient } from "@supabase/supabase-js";
import { usePublicClient } from "wagmi";
import type { Address, Hex } from "viem";
import {
  batchIdToHash,
  CALIBRA_PROTOCOL,
  CALIBRA_PROTOCOL_ABI,
} from "@/lib/calibraOnchain";

function isHexAddress(s: string) {
  return /^0x[a-fA-F0-9]{40}$/.test(s);
}

type SubmissionRow = {
  provider_address: string | null;

  commit_index?: number | null;
  commit_hash?: string | null;

  created_at?: string | null;

  root?: string | null;
  salt?: string | null;

  encrypted_uri_hash?: string | null;
  public_uri_hash?: string | null;

  storage_bucket?: string | null;
  storage_path?: string | null;
};

type OnchainCommit = {
  commitIndex: number;
  commitHash: Hex;
  committedAt: bigint;
  revealed: boolean;
  root: Hex;
  salt: Hex;
  publicUriHash: Hex;
};

type ProviderAudit = {
  provider: Address;
  commitCount: number;
  selectedCommitIndex: number | null;
  commits: OnchainCommit[];
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
  seedRevealed: boolean;
};

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

function normAddr(a: string) {
  return a.trim().toLowerCase();
}

function shortHex(x: string | Hex, n = 10) {
  const s = String(x ?? "");
  if (!s.startsWith("0x")) return s || "—";
  if (s.length <= n + 1) return s;
  return `${s.slice(0, n)}…`;
}

function unixToIso(sec: bigint) {
  const n = Number(sec);
  if (!Number.isFinite(n) || n <= 0) return "—";
  return new Date(n * 1000).toISOString();
}

export default function AuditBatchPage() {
  const router = useRouter();
  const params = useParams<{ batchId: string }>();
  const batchId = (params?.batchId ?? "").toString();

  const publicClient = usePublicClient();

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

  const [uiError, setUiError] = useState<string | null>(null);
  const [uiOk, setUiOk] = useState<string | null>(null);

  const [batchLoading, setBatchLoading] = useState(true);
  const [b, setB] = useState<OnchainBatch | null>(null);

  const [providersLoading, setProvidersLoading] = useState(true);
  const [providers, setProviders] = useState<Address[]>([]);

  const [submissionsLoading, setSubmissionsLoading] = useState(true);
  const [submissions, setSubmissions] = useState<SubmissionRow[]>([]);
  const [subByProviderAndIndex, setSubByProviderAndIndex] = useState<
    Record<string, SubmissionRow>
  >({});
  const [subByProviderAndHash, setSubByProviderAndHash] = useState<
    Record<string, SubmissionRow>
  >({});

  const [auditLoading, setAuditLoading] = useState(false);
  const [audit, setAudit] = useState<ProviderAudit[]>([]);

  function setOk(m: string) {
    setUiError(null);
    setUiOk(m);
  }

  function setErr(m: string) {
    setUiOk(null);
    setUiError(m);
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
    setSubmissionsLoading(true);
    setUiError(null);

    try {
      if (!supabase) throw new Error("Missing Supabase env (public audit)");
      if (!batchIdHash) throw new Error("Missing batchIdHash");

      const { data, error } = await supabase
        .from("submissions")
        .select("*")
        .eq("batch_id_hash", batchIdHash)
        .order("created_at", { ascending: true });

      if (error) throw new Error(error.message);

      const rows = (Array.isArray(data) ? data : []) as SubmissionRow[];

      const providerSet = new Set<string>();
      const byIdx: Record<string, SubmissionRow> = {};
      const byHash: Record<string, SubmissionRow> = {};

      for (const r of rows) {
        const aRaw = (r.provider_address ?? "").toString();
        const a = normAddr(aRaw);
        if (a && isHexAddress(a)) providerSet.add(a);

        const idx =
          typeof r.commit_index === "number" && Number.isFinite(r.commit_index)
            ? r.commit_index
            : null;

        const h = (r.commit_hash ?? "").toString().trim().toLowerCase();

        if (a && idx !== null) byIdx[`${a}:${idx}`] = r;
        if (a && h && h.startsWith("0x")) byHash[`${a}:${h}`] = r;
      }

      const list = Array.from(providerSet).sort() as Address[];

      setProviders(list);
      setSubmissions(rows);
      setSubByProviderAndIndex(byIdx);
      setSubByProviderAndHash(byHash);

      setOk(
        `Loaded ${list.length} provider(s) and ${rows.length} DB submission row(s).`,
      );
    } catch (e: any) {
      setProviders([]);
      setSubmissions([]);
      setSubByProviderAndIndex({});
      setSubByProviderAndHash({});
      setErr(e?.message ?? "Failed to load providers/submissions");
    } finally {
      setProvidersLoading(false);
      setSubmissionsLoading(false);
    }
  }

  async function loadAudit() {
    setUiError(null);
    setUiOk(null);

    try {
      setAuditLoading(true);

      if (!publicClient) throw new Error("No public client");
      if (!batchIdHash) throw new Error("Missing batchIdHash");
      if (providers.length === 0) throw new Error("No providers loaded");

      const batch = b;
      if (!batch?.exists) throw new Error("Batch not loaded");

      const out: ProviderAudit[] = [];

      for (const p of providers) {
        const commitCount = (await publicClient.readContract({
          address: CALIBRA_PROTOCOL,
          abi: CALIBRA_PROTOCOL_ABI,
          functionName: "getCommitCount",
          args: [batchIdHash, p],
        })) as unknown as number;

        const n = Number(commitCount);
        const commits: OnchainCommit[] = [];

        for (let i = 0; i < n; i += 1) {
          const c = (await publicClient.readContract({
            address: CALIBRA_PROTOCOL,
            abi: CALIBRA_PROTOCOL_ABI,
            functionName: "getCommit",
            args: [batchIdHash, p, i],
          })) as unknown as readonly [Hex, bigint, boolean, Hex, Hex, Hex];

          commits.push({
            commitIndex: i,
            commitHash: c[0],
            committedAt: c[1],
            revealed: c[2],
            root: c[3],
            salt: c[4],
            publicUriHash: c[5],
          });
        }

        let selectedCommitIndex: number | null = null;
        if (batch.seedRevealed && n > 0) {
          const idx = (await publicClient.readContract({
            address: CALIBRA_PROTOCOL,
            abi: CALIBRA_PROTOCOL_ABI,
            functionName: "getSelectedCommitIndex",
            args: [batchIdHash, p],
          })) as unknown as number;

          selectedCommitIndex = Number(idx);
        }

        out.push({
          provider: p,
          commitCount: n,
          selectedCommitIndex,
          commits,
        });
      }

      setAudit(out);
      setOk("Loaded audit timeline from on-chain commits.");
    } catch (e: any) {
      setAudit([]);
      setErr(e?.shortMessage ?? e?.message ?? "Failed to load audit");
    } finally {
      setAuditLoading(false);
    }
  }

  useEffect(() => {
    if (!publicClient) return;
    if (!batchIdHash) return;
    loadBatch();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [publicClient, batchIdHash]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-zinc-50 font-sans dark:bg-black">
      <main className="w-full max-w-6xl px-6 py-12">
        <div className="rounded-2xl bg-white p-8 shadow-sm dark:bg-zinc-950">
          <div className="flex items-start justify-between gap-6">
            <div className="flex flex-col gap-2">
              <h1 className="text-2xl font-semibold tracking-tight text-zinc-950 dark:text-zinc-50">
                Batch Verification
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

            <div className="rounded-xl border border-zinc-200 p-4 dark:border-zinc-800">
              <div className="text-xs text-zinc-500 dark:text-zinc-400">
                Windows (unix)
              </div>
              <div className="mt-1 text-[11px] text-zinc-900 dark:text-zinc-50">
                <div>
                  start:{" "}
                  <span className="font-mono">
                    {batchLoading ? "…" : (b?.windowStart.toString() ?? "—")}
                  </span>
                </div>
                <div>
                  end:{" "}
                  <span className="font-mono">
                    {batchLoading ? "…" : (b?.windowEnd.toString() ?? "—")}
                  </span>
                </div>
                <div>
                  reveal:{" "}
                  <span className="font-mono">
                    {batchLoading ? "…" : (b?.revealDeadline.toString() ?? "—")}
                  </span>
                </div>
              </div>
            </div>
          </div>

          <div className="mt-6 flex flex-wrap items-center gap-2">
            <button
              onClick={loadProvidersFromDb}
              disabled={providersLoading || submissionsLoading}
              className="inline-flex h-9 items-center justify-center rounded-xl border border-zinc-200 bg-white px-4 text-sm font-medium text-zinc-900 transition hover:bg-zinc-50 disabled:opacity-60 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-50 dark:hover:bg-black"
            >
              {providersLoading || submissionsLoading
                ? "Loading…"
                : "Load Providers & DB Submissions"}
            </button>

            <button
              onClick={loadAudit}
              disabled={auditLoading || providers.length === 0}
              className="inline-flex h-9 items-center justify-center rounded-xl bg-zinc-900 px-4 text-sm font-medium text-white transition hover:bg-zinc-800 disabled:opacity-60 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-200"
            >
              {auditLoading ? "Loading…" : "Load On-chain Timeline"}
            </button>
          </div>

          <div className="mt-4 text-xs text-zinc-500 dark:text-zinc-400">
            MVP note: scores aren’t wired yet. This page is the canonical public
            timeline: every commit timestamp, reveal status, and the post-seed
            selected commit index used for scoring/finalization.
          </div>

          <div className="mt-6 flex flex-col gap-4">
            {audit.length === 0 ? (
              <div className="rounded-xl border border-zinc-200 p-4 text-sm text-zinc-600 dark:border-zinc-800 dark:text-zinc-400">
                No audit data loaded yet.
              </div>
            ) : (
              audit.map((p) => (
                <div
                  key={p.provider}
                  className="rounded-2xl border border-zinc-200 p-5 dark:border-zinc-800"
                >
                  <div className="flex flex-col gap-1">
                    <div className="text-sm font-medium text-zinc-900 dark:text-zinc-50">
                      <span className="font-mono">{p.provider}</span>
                    </div>
                    <div className="text-xs text-zinc-500 dark:text-zinc-400">
                      commits:{" "}
                      <span className="font-mono">{p.commitCount}</span>
                      {" · "}
                      selected:{" "}
                      <span className="font-mono">
                        {p.selectedCommitIndex === null
                          ? "— (seed not revealed)"
                          : p.selectedCommitIndex}
                      </span>
                    </div>
                  </div>

                  <div className="mt-4 overflow-auto rounded-xl border border-zinc-200 dark:border-zinc-800">
                    <table className="w-full min-w-[900px] text-left text-xs">
                      <thead className="bg-zinc-50 text-[11px] text-zinc-600 dark:bg-zinc-900/40 dark:text-zinc-300">
                        <tr>
                          <th className="px-3 py-2">commitIndex</th>

                          <th className="px-3 py-2">committedAt (unix)</th>
                          <th className="px-3 py-2">committedAt (iso)</th>

                          <th className="px-3 py-2">commitHash</th>
                          <th className="px-3 py-2">revealed</th>

                          <th className="px-3 py-2">root</th>
                          <th className="px-3 py-2">salt</th>
                          <th className="px-3 py-2">publicUriHash</th>

                          <th className="px-3 py-2">DB created_at</th>
                          <th className="px-3 py-2">DB storage</th>
                          <th className="px-3 py-2">DB encrypted_uri_hash</th>

                          <th className="px-3 py-2">score</th>
                        </tr>
                      </thead>
                      <tbody>
                        {p.commits.map((c) => {
                          const isSelected =
                            p.selectedCommitIndex !== null &&
                            c.commitIndex === p.selectedCommitIndex;

                          const prov = normAddr(String(p.provider));
                          const byIdxKey = `${prov}:${c.commitIndex}`;
                          const byHashKey = `${prov}:${String(c.commitHash).toLowerCase()}`;

                          const sub =
                            subByProviderAndIndex[byIdxKey] ??
                            subByProviderAndHash[byHashKey] ??
                            null;

                          const dbCreatedAt = (sub?.created_at ?? "")
                            .toString()
                            .trim();
                          const dbStorageBucket = (sub?.storage_bucket ?? "")
                            .toString()
                            .trim();
                          const dbStoragePath = (sub?.storage_path ?? "")
                            .toString()
                            .trim();
                          const dbEncryptedUriHash = (
                            sub?.encrypted_uri_hash ?? ""
                          )
                            .toString()
                            .trim();

                          return (
                            <tr
                              key={`${p.provider}-${c.commitIndex}`}
                              className={
                                isSelected
                                  ? "bg-emerald-50/60 dark:bg-emerald-900/20"
                                  : "bg-white dark:bg-zinc-950"
                              }
                            >
                              <td className="px-3 py-2 font-mono">
                                {c.commitIndex}
                              </td>

                              <td className="px-3 py-2 font-mono">
                                {c.committedAt.toString()}
                              </td>
                              <td className="px-3 py-2 font-mono">
                                {unixToIso(c.committedAt)}
                              </td>

                              <td className="px-3 py-2 font-mono">
                                {shortHex(c.commitHash)}
                              </td>

                              <td className="px-3 py-2">
                                {c.revealed ? "Yes" : "No"}
                              </td>

                              <td className="px-3 py-2 font-mono">
                                {shortHex(c.root)}
                              </td>
                              <td className="px-3 py-2 font-mono">
                                {shortHex(c.salt)}
                              </td>
                              <td className="px-3 py-2 font-mono">
                                {shortHex(c.publicUriHash)}
                              </td>

                              <td className="px-3 py-2 font-mono">
                                {dbCreatedAt ? dbCreatedAt : "—"}
                              </td>

                              <td className="px-3 py-2 font-mono">
                                {dbStorageBucket || dbStoragePath
                                  ? `${dbStorageBucket || "—"} / ${dbStoragePath || "—"}`
                                  : "—"}
                              </td>

                              <td className="px-3 py-2 font-mono">
                                {dbEncryptedUriHash
                                  ? shortHex(dbEncryptedUriHash)
                                  : "—"}
                              </td>

                              <td className="px-3 py-2 text-zinc-500 dark:text-zinc-400">
                                —
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
