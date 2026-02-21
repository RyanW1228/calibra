// calibra/src/app/api/batches/finalize/route.ts
import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabaseServer";
import {
  recoverMessageAddress,
  keccak256,
  toBytes,
  type Address,
  type Hex,
  createPublicClient,
  http,
} from "viem";
import {
  ADI_TESTNET_CHAIN_ID,
  CALIBRA_PROTOCOL,
  CALIBRA_PROTOCOL_ABI,
} from "@/lib/calibraOnchain";

function isHexAddress(s: string) {
  return /^0x[a-fA-F0-9]{40}$/.test(s);
}

function isBytes32Hex(s: string) {
  return /^0x[a-fA-F0-9]{64}$/.test(s);
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

async function safeJson(req: Request) {
  try {
    return await req.json();
  } catch {
    return null;
  }
}

function stableFinalizeJson(input: {
  v: number;
  scoring: string;
  batchId: string;
  batchIdHash: string;
  operator: string;
  funder: string;
  createdAtUnix: number;
  providers: string[];
  selectedCommitIndices: number[];
  payouts: string[];
}) {
  const esc = (s: string) => JSON.stringify(s);
  const arrStr = (xs: string[]) => `[${xs.map(esc).join(",")}]`;
  const arrNum = (xs: number[]) => `[${xs.map((x) => String(x)).join(",")}]`;

  return (
    `{` +
    `"v":${input.v},` +
    `"scoring":${esc(input.scoring)},` +
    `"batchId":${esc(input.batchId)},` +
    `"batchIdHash":${esc(input.batchIdHash)},` +
    `"operator":${esc(input.operator)},` +
    `"funder":${esc(input.funder)},` +
    `"createdAtUnix":${String(input.createdAtUnix)},` +
    `"providers":${arrStr(input.providers)},` +
    `"selectedCommitIndices":${arrNum(input.selectedCommitIndices)},` +
    `"payouts":${arrStr(input.payouts)}` +
    `}`
  );
}

export async function POST(req: Request) {
  try {
    const body = (await safeJson(req)) as any;

    const addressRaw = (body?.address ?? "").toString().trim();
    const signatureRaw = (body?.signature ?? "").toString().trim();
    const batchId = (body?.batchId ?? "").toString().trim();
    const batchIdHashRaw = (body?.batchIdHash ?? "").toString().trim();

    if (!addressRaw || !isHexAddress(addressRaw)) {
      return NextResponse.json(
        { ok: false, error: "Invalid address" },
        { status: 400 },
      );
    }

    if (!signatureRaw || !signatureRaw.startsWith("0x")) {
      return NextResponse.json(
        { ok: false, error: "Missing signature" },
        { status: 400 },
      );
    }

    if (!batchId) {
      return NextResponse.json(
        { ok: false, error: "Missing batchId" },
        { status: 400 },
      );
    }

    if (!batchIdHashRaw || !isBytes32Hex(batchIdHashRaw)) {
      return NextResponse.json(
        { ok: false, error: "Invalid batchIdHash" },
        { status: 400 },
      );
    }

    const address = addressRaw.toLowerCase() as Address;
    const signature = signatureRaw as Hex;
    const batchIdHash = batchIdHashRaw as Hex;

    const rpcUrl = (process.env.ADI_TESTNET_RPC_URL ?? "").toString().trim();
    if (!rpcUrl) {
      return NextResponse.json(
        { ok: false, error: "Missing ADI_TESTNET_RPC_URL" },
        { status: 500 },
      );
    }

    const sb = supabaseServer();

    const { data: nonceRow, error: nonceErr } = await sb
      .from("auth_nonces")
      .select("nonce, expires_at")
      .eq("address", address)
      .single();

    if (nonceErr || !nonceRow?.nonce || !nonceRow?.expires_at) {
      return NextResponse.json(
        { ok: false, error: "Missing nonce" },
        { status: 401 },
      );
    }

    const expiresAtIso = new Date(nonceRow.expires_at).toISOString();
    const expiresMs = new Date(expiresAtIso).getTime();
    if (!Number.isFinite(expiresMs) || Date.now() > expiresMs) {
      return NextResponse.json(
        { ok: false, error: "Nonce expired" },
        { status: 401 },
      );
    }

    const message = buildAuthMessage(address, nonceRow.nonce, expiresAtIso);

    const recovered = (
      await recoverMessageAddress({ message, signature })
    ).toLowerCase();
    if (recovered !== address) {
      return NextResponse.json(
        { ok: false, error: "Bad signature" },
        { status: 401 },
      );
    }

    const client = createPublicClient({
      chain: {
        id: ADI_TESTNET_CHAIN_ID,
        name: "ADI Testnet",
        nativeCurrency: { name: "ADI", symbol: "ADI", decimals: 18 },
        rpcUrls: { default: { http: [rpcUrl] } },
      },
      transport: http(rpcUrl),
    });

    const batchRes = (await client.readContract({
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

    const exists = batchRes[0];
    if (!exists) {
      return NextResponse.json(
        { ok: false, error: "Batch not found on-chain" },
        { status: 404 },
      );
    }

    const operator = batchRes[1].toLowerCase() as Address;
    const funder = batchRes[2].toLowerCase() as Address;
    const funded = batchRes[11] === true;
    const finalized = batchRes[12] === true;
    const bounty = batchRes[13] as bigint;

    if (!funded) {
      return NextResponse.json(
        { ok: false, error: "Batch not funded" },
        { status: 400 },
      );
    }

    if (finalized) {
      return NextResponse.json(
        { ok: false, error: "Batch already finalized" },
        { status: 400 },
      );
    }

    if (address !== operator) {
      return NextResponse.json(
        { ok: false, error: "Only operator can prepare finalize params" },
        { status: 403 },
      );
    }

    const { data: rows, error: rowsErr } = await sb
      .from("submission_versions")
      .select("provider_address")
      .eq("batch_id", batchId)
      .limit(10_000);

    if (rowsErr) {
      return NextResponse.json(
        { ok: false, error: rowsErr.message },
        { status: 500 },
      );
    }

    const providersSet = new Set<string>();
    for (const r of Array.isArray(rows) ? rows : []) {
      const p = (r as any)?.provider_address;
      if (typeof p === "string" && /^0x[a-fA-F0-9]{40}$/.test(p)) {
        providersSet.add(p.toLowerCase());
      }
    }

    const providers = Array.from(providersSet).sort((a, b) =>
      a.localeCompare(b),
    ) as Address[];

    if (providers.length === 0) {
      return NextResponse.json(
        { ok: false, error: "No providers found in submission_versions" },
        { status: 400 },
      );
    }

    const selectedCommitIndices: number[] = [];
    for (const p of providers) {
      const idx = (await client.readContract({
        address: CALIBRA_PROTOCOL,
        abi: CALIBRA_PROTOCOL_ABI,
        functionName: "getSelectedCommitIndex",
        args: [batchIdHash, p],
      })) as unknown as number;

      if (!Number.isFinite(idx) || idx < 0) {
        return NextResponse.json(
          { ok: false, error: `Bad selected index for ${p}` },
          { status: 500 },
        );
      }

      selectedCommitIndices.push(idx);
    }

    const n = BigInt(providers.length);
    const base = bounty / n;
    const rem = bounty - base * n;

    const payoutsBig: bigint[] = [];
    for (let i = 0; i < providers.length; i += 1) {
      payoutsBig.push(base + (BigInt(i) < rem ? BigInt(1) : BigInt(0)));
    }

    const payouts = payoutsBig.map((x) => x.toString());

    const createdAtUnix = Math.floor(Date.now() / 1000);

    const scoresJson = stableFinalizeJson({
      v: 1,
      scoring: "mvp_equal_split",
      batchId,
      batchIdHash,
      operator,
      funder,
      createdAtUnix,
      providers,
      selectedCommitIndices,
      payouts,
    });

    const scoresHash = keccak256(toBytes(scoresJson)) as Hex;

    const up = await sb.from("batch_finalizations").upsert(
      {
        batch_id: batchId,
        finalized: false,
        finalized_at_unix: null,
        scoring_method: "mvp_equal_split",
        outcomes_json: null,
        payouts_json: {
          providers,
          selectedCommitIndices,
          payouts,
          scoresHash,
        },
        slashes_json: null,
      },
      { onConflict: "batch_id" },
    );

    if (up.error) {
      return NextResponse.json(
        { ok: false, error: up.error.message },
        { status: 500 },
      );
    }

    await sb.from("auth_nonces").delete().eq("address", address);

    return NextResponse.json(
      {
        ok: true,
        batchId,
        batchIdHash,
        operator,
        funder,
        providers,
        selectedCommitIndices,
        payouts,
        scoresHash,
        scoresJson,
      },
      { status: 200 },
    );
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message ?? "Unknown server error" },
      { status: 500 },
    );
  }
}
