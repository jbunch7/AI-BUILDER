import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { enforceAllowedOrigin, withCors } from "@/lib/security";
import { getScan, setJob } from "@/lib/store";
import type { BuilderJob, BuilderSelections } from "@/lib/jobs";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const originCheck = enforceAllowedOrigin(request);
  if (!originCheck.ok) {
    return withCors(request, NextResponse.json({ error: originCheck.reason }, { status: 403 }));
  }

  try {
    const body = await request.json().catch(() => ({}));
    const scanId = body?.scanId as string | undefined;
    const selections = (body?.selections || {}) as BuilderSelections;
    const extras = (body?.extras || {}) as Record<string, boolean>;
    const userPrompt = (body?.userPrompt || "") as string;

    if (!scanId) {
      return withCors(request, NextResponse.json({ error: "Missing scanId" }, { status: 400 }));
    }

    const scan = await getScan(scanId);
    if (!scan) {
      return withCors(request, NextResponse.json({ error: "Scan not found" }, { status: 404 }));
    }

    const jobId = randomUUID();

    const job: BuilderJob = {
      id: jobId,
      status: "queued",
      createdAt: Date.now(),
      scanId,
      sceneGraphJSON: scan.sceneGraphJSON,
      selections: selections ?? {},
      extras,
      userPrompt,
      preparedImageBase64: scan.preparedImageBase64,
      preparedImageMime: scan.preparedImageMime,
      preparedImageInfo: scan.preparedImageInfo,
    };

    await setJob(job, 60 * 60);

    // Kick worker (best-effort)
    const origin = new URL(request.url).origin;

    const headers: Record<string, string> = { "content-type": "application/json" };
    if (process.env.WORKER_SECRET) {
      headers["x-worker-secret"] = process.env.WORKER_SECRET;
    }

    void fetch(`${origin}/api/worker`, {
      method: "POST",
      headers,
      body: JSON.stringify({ jobId }),
    }).catch(() => {
      // best-effort; client polls job status
    });

    return withCors(request, NextResponse.json({ jobId }));
  } catch (err: any) {
    return withCors(
      request,
      NextResponse.json({ error: "Render failed", message: err?.message ?? "Unknown error" }, { status: 500 })
    );
  }
}
