import { NextRequest, NextResponse } from "next/server";
import { enforceAllowedOrigin, withCors } from "@/lib/security";
import { getScan } from "@/lib/store";
import type { SceneElementType, SceneGraph } from "@/lib/builder/types";
import { refineMasksOnDemand } from "@/lib/masking";

export const runtime = "nodejs";
export const maxDuration = 120;

type Body = {
  scanId: string;
  types: SceneElementType[];
};

export async function POST(request: NextRequest) {
  const originCheck = enforceAllowedOrigin(request);
  if (!originCheck.ok) {
    return withCors(request, NextResponse.json({ error: originCheck.reason }, { status: 403 }));
  }

  try {
    const body = (await request.json()) as Body;
    const scanId = body?.scanId;
    const types = (body?.types || []).filter(Boolean) as SceneElementType[];

    if (!scanId) {
      return withCors(request, NextResponse.json({ error: "Missing scanId" }, { status: 400 }));
    }
    if (!types.length) {
      return withCors(request, NextResponse.json({ error: "Missing types" }, { status: 400 }));
    }

    const rec = await getScan(scanId);
    if (!rec) {
      return withCors(request, NextResponse.json({ error: "Unknown scanId" }, { status: 404 }));
    }

    const sceneGraph = JSON.parse(rec.sceneGraphJSON) as SceneGraph;
    const originalBuffer = Buffer.from(rec.preparedImageBase64, "base64");

    const autoMasks = await refineMasksOnDemand({
      sceneGraph,
      originalImageBuffer: originalBuffer,
      types,
    });

    return withCors(request, NextResponse.json({ scanId, autoMasks }));
  } catch (err: any) {
    return withCors(
      request,
      NextResponse.json(
        {
          error: "Mask refine failed",
          message: err?.message ?? "Unknown error",
        },
        { status: 500 }
      )
    );
  }
}
