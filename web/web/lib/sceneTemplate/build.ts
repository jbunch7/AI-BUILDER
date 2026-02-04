import { randomUUID } from "crypto";
import type { AutoMasks } from "@/lib/masking";
import type { SceneGraph, SceneElementType } from "@/lib/builder/types";
import { defaultLayerOrder, getSceneProfile } from "@/lib/sceneTemplate/profiles";
import type { SceneTemplate, SurfaceTemplate } from "@/lib/sceneTemplate/types";

function uniq<T>(values: T[]): T[] {
  const out: T[] = [];
  const seen = new Set<T>();
  for (const v of values) {
    if (seen.has(v)) continue;
    seen.add(v);
    out.push(v);
  }
  return out;
}

function isPlanar(t: SceneElementType): boolean {
  return ["floor", "countertop", "backsplash", "walls", "siding", "roof", "driveway", "walkway", "deck", "patio"].includes(t);
}

// Pragmatic planar quad: use mask image alpha bounding-box corners (normalized).
async function quadFromMaskPng(maskPngDataUrl: string): Promise<[number, number][]> {
  // We intentionally avoid adding heavy deps in client/runtime. Server-side we can parse with sharp,
  // but the editor can also live without a quad. Therefore, we return a placeholder quad here.
  // If you later add real depth/plane fitting, replace this with a proper homography.
  return [
    [0.2, 0.7],
    [0.8, 0.7],
    [0.95, 0.98],
    [0.05, 0.98],
  ];
}

export async function buildSceneTemplate(args: {
  sceneGraph: SceneGraph;
  preparedSrc: string;
  preparedWidth: number;
  preparedHeight: number;
  autoMasks: AutoMasks | null;
}): Promise<SceneTemplate> {
  const profile = getSceneProfile(args.sceneGraph.meta.category, args.sceneGraph.meta.subcategory);
  const layer_order = defaultLayerOrder(profile);

  const maskByType = args.autoMasks?.byType || {};

  const surfaces: SurfaceTemplate[] = [];

  const allTypes: SceneElementType[] = uniq([
    ...(profile.surfaces || []),
    ...(profile.occluders || []),
  ]);

  for (const t of allTypes) {
    const isOcc = profile.occluders.includes(t);
    const editable_ops = isOcc ? [] : t === "cabinets" || t === "trim" || t === "walls" || t === "siding" || t === "front_door" || t === "garage_door" ? ["recolor"] : ["texture_swap"];
    const render_mode = editable_ops.includes("recolor") ? "recolor_shading" : (isPlanar(t) ? "planar_project" : "screen_texture");
    const mask_png = (maskByType as any)[t] as string | undefined;

    const s: SurfaceTemplate = {
      id: `srf_${t}`,
      type: t,
      label: t,
      editable_ops: editable_ops as any,
      render_mode: render_mode as any,
      mask_png,
      occluder: isOcc || undefined,
    };

    if (!isOcc && mask_png && isPlanar(t)) {
      s.plane = { valid: true, quad_norm: await quadFromMaskPng(mask_png) };
    }
    surfaces.push(s);
  }

  // Quality score: very simple for now: how many requested surfaces have masks.
  const wanted = profile.surfaces.length;
  const have = profile.surfaces.filter((t) => Boolean((maskByType as any)[t])).length;
  const score = wanted ? have / wanted : 0.0;
  const warnings: string[] = [];
  if (score < 0.4) warnings.push("Low confidence template: missing many surface masks.");

  return {
    schema_version: "1.0",
    template_id: randomUUID(),
    domain: args.sceneGraph.meta.category,
    subcategory: args.sceneGraph.meta.subcategory,
    image: {
      width: args.preparedWidth,
      height: args.preparedHeight,
      prepared_src: args.preparedSrc,
    },
    surfaces,
    constraints: { layer_order: layer_order.map(String) },
    quality: { score, warnings },
  };
}
