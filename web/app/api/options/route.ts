import { NextRequest, NextResponse } from "next/server";
import { enforceAllowedOrigin, withCors } from "@/lib/security";
import { getScan } from "@/lib/store";
import { buildModules } from "@/lib/builder/options";
import type { SceneGraph } from "@/lib/builder/types";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const originCheck = enforceAllowedOrigin(request);
  if (!originCheck.ok) {
    return withCors(request, NextResponse.json({ error: originCheck.reason }, { status: 403 }));
  }

  try {
    const body = await request.json().catch(() => ({}));
    const scanId = body?.scanId as string | undefined;
    const extras = (body?.extras || {}) as any;

    if (!scanId) {
      return withCors(request, NextResponse.json({ error: "Missing scanId" }, { status: 400 }));
    }

    const scan = await getScan(scanId);
    if (!scan) {
      return withCors(request, NextResponse.json({ error: "Scan not found" }, { status: 404 }));
    }

    const sceneGraph = JSON.parse(scan.sceneGraphJSON) as SceneGraph;
    const modules = buildModules(sceneGraph, extras);

    // Default selections (choose defaults per module)
    const defaultSelections: Record<string, string> = {};
    for (const m of modules) {
      if (m.defaultOptionId) defaultSelections[m.featureId] = m.defaultOptionId;
      else if (m.options?.[0]) defaultSelections[m.featureId] = m.options[0].id;
    }

    return withCors(
      request,
      NextResponse.json({
        scanId,
        meta: sceneGraph.meta,
        modules,
        defaultSelections,
      })
    );
  } catch (err: any) {
    return withCors(
      request,
      NextResponse.json({ error: "Options failed", message: err?.message ?? "Unknown error" }, { status: 500 })
    );
  }
}
