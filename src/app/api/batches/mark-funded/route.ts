// calibra/src/app/api/batches/mark-funded/route.ts
import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabaseServer";

type MarkFundedRequest = {
  batchId: string;
};

export async function POST(req: Request) {
  let body: MarkFundedRequest;

  try {
    body = (await req.json()) as MarkFundedRequest;
  } catch {
    return NextResponse.json(
      { ok: false, error: "Invalid JSON" },
      { status: 400 },
    );
  }

  const batchId = (body.batchId ?? "").trim();
  if (!batchId) {
    return NextResponse.json(
      { ok: false, error: "Missing batchId" },
      { status: 400 },
    );
  }

  const sb = supabaseServer();

  const { data, error } = await sb
    .from("batches")
    .update({ status: "funded" })
    .eq("id", batchId)
    .select("id, status")
    .single();

  if (error || !data) {
    return NextResponse.json(
      { ok: false, error: error?.message ?? "Failed to update batch" },
      { status: 500 },
    );
  }

  return NextResponse.json({ ok: true, batch: data }, { status: 200 });
}
