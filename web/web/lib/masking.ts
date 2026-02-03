// lib/masking.ts

import sharp from "sharp";
import type { SceneElementType, SceneGraph } from "@/lib/builder/types";
import { PREVIEW_MAX_SIDE } from "@/lib/constants";

export type AutoMaskSource = "mask-service" | "polygon-raster";

export type AutoMaskByType = Partial<Record<SceneElementType, string>>; // data:image/png;base64,...

export type AutoMasks = {
  /** The max side length used to generate these masks. */
  maxSide: number;
  /** Pixel dimensions of the mask images. */
  width: number;
  height: number;
  /** Mapping of element type -> PNG data URL (white with alpha). */
  byType: AutoMaskByType;
  /** Best-effort provenance */
  source: AutoMaskSource;
  /** Optional per-type errors (when partial). */
  errors?: Partial<Record<SceneElementType, string>>;
};

function clamp01(x: number) {
  return Math.max(0, Math.min(1, x));
}

function groupPolygonsByType(sceneGraph: SceneGraph): Record<SceneElementType, number[][][]> {
  const out: Record<string, number[][][]> = {};
  for (const el of sceneGraph.elements || []) {
    const t = el?.type as SceneElementType | undefined;
    const pts = el?.mask?.points_norm;
    if (!t || !Array.isArray(pts) || pts.length < 3) continue;
    const poly = pts.map((p) => [clamp01(Number(p[0])), clamp01(Number(p[1]))]);
    (out[t] ||= []).push(poly);
  }
  return out as Record<SceneElementType, number[][][]>;
}

async function downscaleForPreview(input: Buffer, maxSide: number) {
  const img = sharp(input, { failOn: "none" });
  const meta = await img.metadata();
  const ow = meta.width ?? 0;
  const oh = meta.height ?? 0;
  if (!ow || !oh) throw new Error("Could not read image dimensions for masking");

  const scale = Math.min(1, maxSide / Math.max(ow, oh));
  const w = Math.max(1, Math.round(ow * scale));
  const h = Math.max(1, Math.round(oh * scale));

  // Use PNG for the mask service to avoid JPEG artifacts around edges.
  const png = await img
    .resize({ width: w, height: h, fit: "fill" })
    .png({ compressionLevel: 9 })
    .toBuffer();

  return { buffer: png, width: w, height: h };
}

function svgForPolygons(w: number, h: number, polys: number[][][]) {
  const polyTags = polys
    .map((pts) => {
      const points = pts
        .map(([nx, ny]) => {
          const x = nx * w;
          const y = ny * h;
          return `${x.toFixed(2)},${y.toFixed(2)}`;
        })
        .join(" ");
      return `<polygon points="${points}" fill="white" />`;
    })
    .join("\n");

  // Transparent background; white where masked.
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
  ${polyTags}
</svg>`;
}

async function rasterizePolygonMasks(sceneGraph: SceneGraph, input: Buffer, maxSide: number): Promise<AutoMasks> {
  const { width: w, height: h } = await downscaleForPreview(input, maxSide);
  const grouped = groupPolygonsByType(sceneGraph);
  const byType: AutoMaskByType = {};

  for (const t of Object.keys(grouped) as SceneElementType[]) {
    const polys = grouped[t];
    if (!polys?.length) continue;
    const svg = svgForPolygons(w, h, polys);
    const png = await sharp(Buffer.from(svg)).png().toBuffer();
    byType[t] = `data:image/png;base64,${png.toString("base64")}`;
  }

  return {
    maxSide,
    width: w,
    height: h,
    byType,
    source: "polygon-raster",
  };
}

async function callMaskService(args: {
  sceneGraph: SceneGraph;
  inputBuffer: Buffer;
  maxSide: number;
}): Promise<AutoMasks> {
  const url = process.env.MASK_SERVICE_URL;
  if (!url) throw new Error("MASK_SERVICE_URL not set");

  const grouped = groupPolygonsByType(args.sceneGraph);
  const types = Object.keys(grouped) as SceneElementType[];
  if (!types.length) {
    // No polygons -> nothing to refine.
    return {
      maxSide: args.maxSide,
      width: 1,
      height: 1,
      byType: {},
      source: "mask-service",
    };
  }

  const { buffer: previewPng, width: w, height: h } = await downscaleForPreview(args.inputBuffer, args.maxSide);

  const payload = {
    image_base64: previewPng.toString("base64"),
    image_mime: "image/png",
    max_side: args.maxSide,
    items: types.map((t) => ({
      type: t,
      polygons_norm: grouped[t] || [],
    })),
  };

  const ac = new AbortController();
  const timeoutMs = Number(process.env.MASK_SERVICE_TIMEOUT_MS || 12000);
  const to = setTimeout(() => ac.abort(), timeoutMs);

  try {
    const res = await fetch(`${url.replace(/\/$/, "")}/v1/masks/preview`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(process.env.MASK_SERVICE_SECRET
          ? { "x-mask-secret": process.env.MASK_SERVICE_SECRET }
          : {}),
      },
      body: JSON.stringify(payload),
      signal: ac.signal,
    });

    const data = await res.json().catch(() => ({} as any));
    if (!res.ok) {
      throw new Error(data?.error || data?.message || `Mask service error (${res.status})`);
    }

    const masks = (data?.masks || {}) as Record<string, { png_base64?: string }>;
    const errors = (data?.errors || {}) as Record<string, string>;

    const byType: AutoMaskByType = {};
    for (const t of Object.keys(masks) as SceneElementType[]) {
      const b64 = masks[t]?.png_base64;
      if (!b64) continue;
      byType[t] = `data:image/png;base64,${b64}`;
    }

    return {
      maxSide: args.maxSide,
      width: Number(data?.width || w),
      height: Number(data?.height || h),
      byType,
      source: "mask-service",
      errors: (Object.keys(errors).length ? (errors as any) : undefined),
    };
  } finally {
    clearTimeout(to);
  }
}

/**
 * Request a refined pixel mask for specific element types.
 *
 * This is intended to be called on-demand (e.g. when the user clicks a category),
 * so you don't pay GPU costs for surfaces the user never edits.
 */
export async function refineMasksOnDemand(args: {
  sceneGraph: SceneGraph;
  originalImageBuffer: Buffer;
  types: SceneElementType[];
  maxSide?: number;
}): Promise<AutoMasks> {
  const maxSide = args.maxSide ?? Number(process.env.MASK_PREVIEW_MAX_SIDE || PREVIEW_MAX_SIDE);

  // If no service is configured, fall back to polygon raster.
  if (!process.env.MASK_SERVICE_URL) {
    return await rasterizePolygonMasks(args.sceneGraph, args.originalImageBuffer, maxSide);
  }

  // Create a temporary sceneGraph that only includes the requested types.
  const filtered: SceneGraph = {
    ...(args.sceneGraph as any),
    elements: (args.sceneGraph.elements || []).filter((e: any) => args.types.includes(e.type)),
  } as any;

  return await callMaskService({
    sceneGraph: filtered,
    inputBuffer: args.originalImageBuffer,
    maxSide,
  });
}

/**
 * Generate per-surface raster masks suitable for fast client-side previews.
 *
 * Priority order:
 * 1) If `MASK_SERVICE_URL` is configured, call it to refine coarse polygons to pixel masks.
 * 2) Otherwise, fall back to rasterizing the coarse polygons (still useful for consistency).
 */
export async function generateAutoMasks(args: {
  sceneGraph: SceneGraph;
  originalImageBuffer: Buffer;
  maxSide?: number;
}): Promise<AutoMasks> {
  const maxSide = args.maxSide ?? Number(process.env.MASK_PREVIEW_MAX_SIDE || PREVIEW_MAX_SIDE);

  // IMPORTANT COST CONTROL:
  // By default we do NOT call the (GPU) mask service during scan.
  // We rasterize polygons for immediate UI previews, and then refine masks on-demand
  // when the user interacts with a category.
  const autoOnScan = process.env.MASK_AUTO_ON_SCAN === "1";
  if (autoOnScan && process.env.MASK_SERVICE_URL) {
    try {
      return await callMaskService({
        sceneGraph: args.sceneGraph,
        inputBuffer: args.originalImageBuffer,
        maxSide,
      });
    } catch {
      // fall through
    }
  }

  return await rasterizePolygonMasks(args.sceneGraph, args.originalImageBuffer, maxSide);
}
