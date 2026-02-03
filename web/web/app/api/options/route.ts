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
    if (!scanId) {
      return withCors(request, NextResponse.json({ error: "Missing scanId" }, { status: 400 }));
    }

    const scan = await getScan(scanId);
    if (!scan) {
      return withCors(request, NextResponse.json({ error: "Scan not found" }, { status: 404 }));
    }

    const sceneGraph = JSON.parse(scan.sceneGraphJSON) as SceneGraph;
    // Builder options are deterministic and driven by the detected scene.
    // "extras" are handled during prompted/refine/final generation, not as selectable modules.
    const modules = buildModules(sceneGraph);

    return withCors(
      request,
      NextResponse.json({
        scanId,
        meta: sceneGraph.meta,
        modules,
        // No pre-selected defaults. User starts on the prompted baseline and explores
        // Light / Neutral / Dark options themselves.
        defaultSelections: {},
      })
    );
  } catch (err: any) {
    return withCors(
      request,
      NextResponse.json({ error: "Options failed", message: err?.message ?? "Unknown error" }, { status: 500 })
    );
  }
}
