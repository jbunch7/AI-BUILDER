import { NextRequest, NextResponse } from "next/server";
import { enforceAllowedOrigin, withCors } from "@/lib/security";
import OpenAI from "openai";
import { getScan, getRefine, setRefine } from "@/lib/store";
import type { SceneGraph } from "@/lib/builder/types";
import { buildModules } from "@/lib/builder/options";
import { unpadGeneratedImage } from "@/lib/imagePrep";

export const runtime = "nodejs";
export const maxDuration = 120;

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! });

function stableStringify(obj: unknown) {
  // Stable stringify (sorted keys) so cache keys are deterministic.
  const seen = new WeakSet();
  const sorter = (_k: string, v: any) => {
    if (!v || typeof v !== "object") return v;
    if (seen.has(v)) return undefined;
    seen.add(v);
    if (Array.isArray(v)) return v;
    return Object.keys(v)
      .sort()
      .reduce((acc: any, k) => {
        acc[k] = v[k];
        return acc;
      }, {});
  };
  return JSON.stringify(obj, sorter);
}

function hashString(input: string) {
  // Small non-crypto hash (fast, deterministic) for cache keys.
  // We don't need cryptographic guarantees here.
  let h = 2166136261;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16);
}


function extrasToLines(extras: Record<string, boolean> = {}) {
  const lines: string[] = [];
  if (extras.appliances) lines.push("- Update appliances (premium, realistic)");
  if (extras.lighting) lines.push("- Update/add light fixtures where appropriate");
  if (extras.backsplash) lines.push("- Add/update backsplash (if applicable)");
  if (extras.countertop) lines.push("- Update countertops (if applicable)");
  if (extras.hardware) lines.push("- Update hardware (pulls/knobs/faucet suggestions when applicable)");
  if (extras.landscaping) lines.push("- Beautify landscaping / lawn / curb appeal (if exterior)");
  if (extras.garden) lines.push("- Add tasteful garden beds/planters that match the style");
  if (extras.decor) lines.push("- Add subtle premium staging/decor (tasteful, not cluttered)");
  return lines;
}

function resolveSelections(sceneGraph: SceneGraph, selections: Record<string, string>, extras: Record<string, boolean> = {}) {
  const modules = buildModules(sceneGraph);
  const lines: string[] = [];
  for (const m of modules) {
    // IMPORTANT: no default selections. If the user didn't pick an option for a module,
    // we skip that surface entirely ("no change").
    const chosenId = selections?.[m.featureId];
    if (!chosenId) continue;
    const chosen = m.options.find((o) => o.id === chosenId);
    if (!chosen) continue;
    lines.push(`- ${m.label}: ${chosen.renderHint}`);
  }
  return lines;
}

function buildRefinePrompt(sceneGraph: SceneGraph, selectionLines: string[], extras: Record<string, boolean>, userPrompt?: string) {
  const lockNotes = [
    "Preserve the exact camera angle, perspective, and geometry.",
    "Do not move or resize walls, ceilings, doors, windows, cabinets, appliances, or built-ins.",
    "Do not change the room dimensions.",
    "Only update finishes/colors/materials per the user's selections.",
  ];

  return `
You are performing a FAST IMAGE EDIT refinement.

HARD RULES (NON-NEGOTIABLE):
${lockNotes.map((s) => `- ${s}`).join("\n")}

SCENE GRAPH (BINDING CONSTRAINTS):
${JSON.stringify(sceneGraph)}

USER SELECTIONS (APPLY THESE UPDATES):
${selectionLines.join("\n") || "- (none)"}

ADDITIONAL USER NOTES (OPTIONAL):
${userPrompt?.trim() ? userPrompt.trim() : "(none)"}

OPTIONAL UPGRADES (IF ENABLED):
${extrasToLines(extras).length ? extrasToLines(extras).join("\n") : "- (none)"}

REFINEMENT GOAL:
- Produce a photorealistic result that looks fully integrated (tight edges, consistent lighting).
- Keep geometry perfectly locked.
- Prioritize speed over ultra-fine detail.

Return a photoreal remodeled preview of the SAME exact space.
  `.trim();
}

export async function POST(req: NextRequest) {
  const originCheck = enforceAllowedOrigin(req);
  if (!originCheck.ok) {
    return withCors(req, NextResponse.json({ error: originCheck.reason }, { status: 403 }));
  }

  if (!process.env.OPENAI_API_KEY) {
    return withCors(req, NextResponse.json({ error: "Server misconfigured: missing OPENAI_API_KEY" }, { status: 500 }));
  }

  const body = await req.json().catch(() => ({} as any));
  const scanId = String(body.scanId || "");
  const selections = (body.selections || {}) as Record<string, string>;
  const extras = (body.extras || {}) as Record<string, boolean>;
  const userPrompt = String(body.userPrompt || "");
  const variant = String(body.variant || "low"); // "low" | "high" (future)

  if (!scanId) {
    return withCors(req, NextResponse.json({ error: "Missing scanId" }, { status: 400 }));
  }

  const cacheSeed = stableStringify({ selections, extras, userPrompt, variant });
  const cacheKey = `${scanId}:${hashString(cacheSeed)}:${variant}`;

  // Serve from cache if possible.
  const cached = await getRefine(cacheKey);
  if (cached) {
    return withCors(req, NextResponse.json({ ok: true, cached: true, resultImageBase64: cached }));
  }

  const scan = await getScan(scanId);
  if (!scan) {
    return withCors(req, NextResponse.json({ error: "Scan not found" }, { status: 404 }));
  }

  const sceneGraph = JSON.parse(scan.sceneGraphJSON) as SceneGraph;
  const selectionLines = resolveSelections(sceneGraph, selections, extras);
  const prompt = buildRefinePrompt(sceneGraph, selectionLines, extras, userPrompt);

  const originalBytes = Buffer.from(scan.preparedImageBase64, "base64");
  const originalFile = new File([originalBytes], "input.jpg", { type: scan.preparedImageMime || "image/jpeg" });

  try {
    const imageModel = process.env.IMAGE_MODEL || "gpt-image-1.5";

    const imageEdit = await openai.images.edit({
      model: imageModel,
      image: originalFile,
      prompt,
      input_fidelity: "high",
      // Prefer speed here. Some models accept "medium"; if unsupported it will be ignored.
      quality: "medium" as any,
      size: scan.preparedImageInfo.size,
    } as any);

    const base64 = imageEdit.data?.[0]?.b64_json;
    if (!base64) throw new Error("No image returned from OpenAI");

    let imgBuffer: Buffer = Buffer.from(base64, "base64");
    imgBuffer = await unpadGeneratedImage(imgBuffer, scan.preparedImageInfo);

    const outBase64 = imgBuffer.toString("base64");
    await setRefine(cacheKey, outBase64, 60 * 60); // 1 hour

    return withCors(req, NextResponse.json({ ok: true, cached: false, resultImageBase64: outBase64 }));
  } catch (err: any) {
    return withCors(
      req,
      NextResponse.json({ ok: false, error: err?.message ?? "Refine failed" }, { status: 500 })
    );
  }
}
