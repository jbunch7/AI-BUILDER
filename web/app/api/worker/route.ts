import { NextRequest, NextResponse } from "next/server";
import { enforceAllowedOrigin, withCors } from "@/lib/security";
import OpenAI from "openai";
import sharp from "sharp";
import path from "path";
import fs from "fs/promises";
import { getJob, setJob } from "@/lib/store";
import type { BuilderJob } from "@/lib/jobs";
import { unpadGeneratedImage } from "@/lib/imagePrep";
import type { SceneGraph } from "@/lib/builder/types";
import { buildModules } from "@/lib/builder/options";

export const runtime = "nodejs";
export const maxDuration = 300;

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! });

function shouldOverlayLogo() {
  const v = (process.env.OVERLAY_LOGO || "true").toLowerCase();
  return v !== "0" && v !== "false" && v !== "no";
}

/**
 * Utility: safely load logo from public/
 */
async function loadLogo() {
  return fs.readFile(path.join(process.cwd(), "public", "logo.png"));
}

function resolveSelections(sceneGraph: SceneGraph, selections: Record<string, string>, extras: Record<string, boolean> = {}) {
  const modules = buildModules(sceneGraph, extras);
  const lines: string[] = [];
  for (const m of modules) {
    const chosenId = selections?.[m.featureId] ?? m.defaultOptionId ?? m.options?.[0]?.id;
    const chosen = m.options.find((o) => o.id === chosenId) ?? m.options?.[0];
    if (!chosen) continue;
    lines.push(`- ${m.label}: ${chosen.renderHint}`);
  }
  return { modules, lines };
}

function buildGenerationPrompt(sceneGraph: SceneGraph, selectionLines: string[], userPrompt?: string) {
  const lockNotes = [
    "Preserve the exact camera angle, perspective, and geometry.",
    "Do not move or resize walls, ceilings, doors, windows, cabinets, appliances, or built-ins.",
    "Do not change the room dimensions.",
    "Only update finishes/colors/materials per the user's selections.",
  ];

  return `
You are performing an IMAGE EDIT of the provided photo.

HARD RULES (NON-NEGOTIABLE):
${lockNotes.map((s) => `- ${s}`).join("\n")}

SCENE GRAPH (BINDING CONSTRAINTS):
${JSON.stringify(sceneGraph)}

USER SELECTIONS (APPLY THESE UPDATES):
${selectionLines.join("\n") || "- (none)"}

ADDITIONAL USER NOTES (OPTIONAL):
${userPrompt?.trim() ? userPrompt.trim() : "(none)"}

RENDERING REQUIREMENTS:
- Photorealistic. Keep original lighting direction and shadows consistent.
- Keep all object positions the same; change only finishes/materials/colors.
- No new openings, no new walls, no perspective drift.

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

  const secret = req.headers.get("x-worker-secret");
  // In production, a secret is required. In development, allow worker calls without it.
  if (process.env.NODE_ENV === "production") {
    if (!process.env.WORKER_SECRET || !secret || secret !== process.env.WORKER_SECRET) {
      return withCors(req, NextResponse.json({ error: "Forbidden" }, { status: 403 }));
    }
  }
  const { jobId } = await req.json();
  const job = await getJob(jobId);

  if (!job) {
    return withCors(req, NextResponse.json({ ok: false, error: "Job not found" }, { status: 404 }));
  }

  if (!job?.preparedImageBase64) {
    const failed: BuilderJob = { ...job, status: "failed", error: "Job missing prepared image" };
    await setJob(failed);
    return withCors(req, NextResponse.json({ ok: false, error: failed.error }, { status: 400 }));
  }

  if (!job.sceneGraphJSON) {
    const failed: BuilderJob = { ...job, status: "failed", error: "Job missing sceneGraphJSON" };
    await setJob(failed);
    return withCors(req, NextResponse.json({ ok: false, error: failed.error }, { status: 400 }));
  }

  try {
    // Mark processing
    await setJob({ ...job, status: "processing", error: undefined });

    const originalMime = job.preparedImageMime || "image/jpeg";
    const originalBytes = Buffer.from(job.preparedImageBase64, "base64");

    // Node 18+ has File globally (Vercel Node runtime)
    const originalFile = new File([originalBytes], "input.jpg", { type: originalMime });

    const sceneGraph = JSON.parse(job.sceneGraphJSON) as SceneGraph;
    const { lines } = resolveSelections(sceneGraph, job.selections || {}, job.extras || {});
    const generationPrompt = buildGenerationPrompt(sceneGraph, lines, job.userPrompt);

    /* ------------------------------------------------------------------
     * TRUE IMAGE-TO-IMAGE (EDIT)
     * ------------------------------------------------------------------ */
    const imageModel = process.env.IMAGE_MODEL || "gpt-image-1.5";

    const imageEdit = await openai.images.edit({
      model: imageModel,
      image: originalFile,
      prompt: generationPrompt,
      // High input fidelity helps preserve details/layout in edits.
      input_fidelity: "high",
      quality: "high",
      size: job.preparedImageInfo.size,
    } as any);

    const base64 = imageEdit.data?.[0]?.b64_json;
    if (!base64) throw new Error("No image returned from OpenAI");

    let imgBuffer: Buffer = Buffer.from(base64, "base64");

    // Remove padding and restore original aspect ratio.
    imgBuffer = await unpadGeneratedImage(imgBuffer, job.preparedImageInfo);

    /* ------------------------------------------------------------------
     * LOGO OVERLAY (optional)
     * ------------------------------------------------------------------ */
    if (shouldOverlayLogo()) {
      const logo = await loadLogo();
      const base = sharp(imgBuffer);
      const meta = await base.metadata();
      const width = meta.width ?? 1024;

      const logoWidth = Math.round(width * 0.33);
      const resizedLogo: Buffer = Buffer.from(
        await sharp(logo).resize({ width: logoWidth }).png().toBuffer()
      );

      imgBuffer = Buffer.from(
        await base
          .composite([{ input: resizedLogo, gravity: "southeast" }])
          .png()
          .toBuffer()
      );
    }

    const completed: BuilderJob = {
      ...job,
      status: "completed",
      resultImageBase64: imgBuffer.toString("base64"),
      error: undefined,
    };
    await setJob(completed);
  } catch (err: any) {
    const failed: BuilderJob = {
      ...job,
      status: "failed",
      error: err?.message ?? "Unknown error",
    };
    await setJob(failed);
  }

  return withCors(req, NextResponse.json({ ok: true }));
}
