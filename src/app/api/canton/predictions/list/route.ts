// calibra/src/app/api/canton/predictions/list/route.ts
import { NextRequest, NextResponse } from "next/server";

type LedgerEndResponse =
  | { offset: number }
  | { ledgerEnd: { offset: number } }
  | any;

type ActiveContractsResponse = {
  contractEntry?: {
    JsActiveContract?: {
      createdEvent?: {
        contractId?: string;
        createdAt?: string;
        createArgument?: any;
      };
    };
  };
}[];

function jsonOk(payload: unknown) {
  return NextResponse.json(payload, { status: 200 });
}

function jsonError(status: number, error: string, details?: unknown) {
  return NextResponse.json(
    { ok: false as const, error, details: details ?? null },
    { status },
  );
}

function mustEnv(name: string) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

function normalizeBaseUrl(raw: string) {
  return raw.endsWith("/") ? raw.slice(0, -1) : raw;
}

function getLedgerEndOffset(x: LedgerEndResponse): number | null {
  const a = x?.offset;
  if (typeof a === "number" && Number.isFinite(a)) return a;

  const b = x?.ledgerEnd?.offset;
  if (typeof b === "number" && Number.isFinite(b)) return b;

  return null;
}

function safeIso(s: any): string | null {
  if (typeof s !== "string") return null;
  const ms = Date.parse(s);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

type Submission = {
  contract_id: string;
  submitter: string;
  submitted_at_iso: string;
  probabilities_json: string;
  created_at_iso: string | null;
};

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const batchId = (url.searchParams.get("batchId") ?? "").toString();
  const atIsoRaw = url.searchParams.get("atIso");
  const atIso = atIsoRaw ? safeIso(atIsoRaw) : null;

  if (!batchId) return jsonError(400, "Missing batchId");
  if (atIsoRaw && !atIso) return jsonError(400, "Invalid atIso (must be ISO)");

  let baseUrl: string;
  let jwt: string;
  let operatorParty: string;
  let packageId: string;

  try {
    baseUrl = normalizeBaseUrl(mustEnv("CANTON_JSON_API_URL"));
    jwt = mustEnv("CANTON_JWT");
    operatorParty = mustEnv("CANTON_OPERATOR_PARTY");
    packageId = mustEnv("CALIBRA_DAML_PACKAGE_ID");
  } catch (e: any) {
    return jsonError(500, e?.message ?? "Missing Canton env vars");
  }

  try {
    const ledgerEndRes = await fetch(`${baseUrl}/v2/state/ledger-end`, {
      method: "GET",
      headers: { Authorization: `Bearer ${jwt}` },
      cache: "no-store",
    });

    const ledgerEndJson = await ledgerEndRes.json().catch(() => null);

    if (!ledgerEndRes.ok || !ledgerEndJson) {
      return jsonError(502, "Failed to fetch Canton ledger end", {
        status: ledgerEndRes.status,
        body: ledgerEndJson,
      });
    }

    const activeAtOffset = getLedgerEndOffset(ledgerEndJson);
    if (activeAtOffset === null) {
      return jsonError(502, "Canton ledger end missing offset", ledgerEndJson);
    }

    const acsBody = {
      filter: {
        filtersByParty: {
          [operatorParty]: {
            cumulative: [
              {
                identifierFilter: {
                  TemplateFilter: {
                    value: {
                      templateId: {
                        packageId,
                        moduleName: "Calibra.Batch",
                        entityName: "PredictionSubmission",
                      },
                      includeCreatedEventBlob: false,
                    },
                  },
                },
              },
            ],
          },
        },
        filtersForAnyParty: { cumulative: [] as any[] },
      },
      verbose: false,
      activeAtOffset,
    };

    const acsRes = await fetch(`${baseUrl}/v2/state/active-contracts`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${jwt}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(acsBody),
      cache: "no-store",
    });

    const acsJson = (await acsRes
      .json()
      .catch(() => null)) as ActiveContractsResponse | null;

    if (!acsRes.ok || !acsJson) {
      return jsonError(502, "Failed to fetch Canton active contracts", {
        status: acsRes.status,
        body: acsJson,
      });
    }

    const submissions: Submission[] = acsJson
      .map((row) => row?.contractEntry?.JsActiveContract?.createdEvent ?? null)
      .filter((ev): ev is NonNullable<typeof ev> => Boolean(ev))
      .map((ev) => {
        const arg = ev.createArgument ?? {};
        const submittedAtIso =
          safeIso(arg.submittedAt) ??
          safeIso(ev.createdAt) ??
          new Date(0).toISOString();

        return {
          contract_id: String(ev.contractId ?? ""),
          submitter: String(arg.submitter ?? ""),
          submitted_at_iso: submittedAtIso,
          probabilities_json: String(arg.probabilitiesJson ?? ""),
          created_at_iso: safeIso(ev.createdAt),
          batchId: String(arg.batchId ?? ""),
        };
      })
      .filter((s: any) => s.contract_id && s.submitter && s.batchId === batchId)
      .map((s: any) => ({
        contract_id: s.contract_id,
        submitter: s.submitter,
        submitted_at_iso: s.submitted_at_iso,
        probabilities_json: s.probabilities_json,
        created_at_iso: s.created_at_iso,
      }))
      .sort((a, b) => {
        const ta = Date.parse(a.submitted_at_iso) || 0;
        const tb = Date.parse(b.submitted_at_iso) || 0;
        return ta - tb;
      });

    const cutoffMs = atIso ? Date.parse(atIso) : null;

    const latestBySubmitterMap = new Map<string, Submission>();

    for (const s of submissions) {
      const t = Date.parse(s.submitted_at_iso) || 0;
      if (cutoffMs !== null && t > cutoffMs) continue;

      const prev = latestBySubmitterMap.get(s.submitter);
      if (!prev) {
        latestBySubmitterMap.set(s.submitter, s);
        continue;
      }

      const tp = Date.parse(prev.submitted_at_iso) || 0;
      if (t >= tp) latestBySubmitterMap.set(s.submitter, s);
    }

    const latest_by_submitter = Array.from(latestBySubmitterMap.values()).sort(
      (a, b) => {
        const ta = Date.parse(a.submitted_at_iso) || 0;
        const tb = Date.parse(b.submitted_at_iso) || 0;
        return ta - tb;
      },
    );

    return jsonOk({
      ok: true as const,
      batchId,
      atIso: atIso ?? null,
      latest_by_submitter,
      submissions,
    });
  } catch (e: any) {
    return jsonError(500, e?.message ?? "Unhandled error");
  }
}
