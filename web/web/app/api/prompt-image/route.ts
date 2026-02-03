import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";
import sharp from "sharp";
import path from "path";
import fs from "fs/promises";
import { enforceAllowedOrigin, withCors } from "@/lib/security";
import { getScan } from "@/lib/store";
import { unpadGeneratedImage } from "@/lib/imagePrep";
import type { SceneGraph } from "@/lib/builder/types";

export const runtime = "nodejs";
export const maxDuration = 180;

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! });

function shouldOverlayLogo() {
  const v = (process.env.OVERLAY_LOGO || "true").toLowerCase();
  return v !== "0" && v !== "false" && v !== "no";
}

async function loadLogo() {
  return fs.readFile(path.join(process.cwd(), "public", "logo.png"));
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

function buildPrompt(sceneGraph: SceneGraph, userPrompt: string, extras: Record<string, boolean>) {
  const lockNotes = [
    "Preserve the exact camera angle, perspective, and geometry.",
    "Do not move or resize walls, ceilings, doors, windows, cabinets, appliances, or built-ins.",
    "Do not change room/house dimensions.",
    "Only update finishes/materials/colors and tasteful upgrades that do not change structure.",
  ];

  const extraLines = extrasToLines(extras);

  return `
You are performing an IMAGE EDIT of the provided photo.

HARD RULES (NON-NEGOTIABLE):
${lockNotes.map((s) => `- ${s}`).join("\n")}

SCENE TYPE:
- category: ${sceneGraph.meta?.category}
- subcategory: ${sceneGraph.meta?.subcategory}

SCENE GRAPH (BINDING CONSTRAINTS):
${JSON.stringify(sceneGraph)}

USER PROMPT (PRIMARY INSTRUCTIONS):
${userPrompt?.trim() ? userPrompt.trim() : "(none)"}

OPTIONAL UPGRADES (IF ENABLED):
${extraLines.length ? extraLines.join("\n") : "- (none)"}

RENDERING REQUIREMENTS:
- Photorealistic.
- Keep original lighting direction and shadows consistent.
- Keep all object positions the same; no perspective drift.
- Do not invent new rooms/structures. Do not add/remove doors/windows.

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

  try {
    const body = await req.json().catch(() => ({}));
    const scanId = body?.scanId as string | undefined;
    const userPrompt = (body?.userPrompt || "") as string;
    const extras = (body?.extras || {}) as Record<string, boolean>;

    if (!scanId) {
      return withCors(req, NextResponse.json({ error: "Missing scanId" }, { status: 400 }));
    }

    const scan = await getScan(scanId);
    if (!scan) {
      return withCors(req, NextResponse.json({ error: "Scan not found" }, { status: 404 }));
    }

    const sceneGraph = JSON.parse(scan.sceneGraphJSON) as SceneGraph;
    const prompt = buildPrompt(sceneGraph, userPrompt, extras);

    const originalMime = scan.preparedImageMime || "image/jpeg";
    const originalBytes = Buffer.from(scan.preparedImageBase64, "base64");
    const originalFile = new File([originalBytes], "input.jpg", { type: originalMime });

    const imageModel = process.env.IMAGE_MODEL || "gpt-image-1.5";

    const imageEdit = await openai.images.edit({
      model: imageModel,
      image: originalFile,
      prompt,
      input_fidelity: "high",
      // speed bias for baseline (still looks good). User can further refine by mixing options.
      quality: "medium",
      size: scan.preparedImageInfo.size,
    } as any);

    const base64 = imageEdit.data?.[0]?.b64_json;
    if (!base64) throw new Error("No image returned from OpenAI");

    let imgBuffer: Buffer = Buffer.from(base64, "base64");

    // Remove padding and restore original aspect ratio.
    imgBuffer = await unpadGeneratedImage(imgBuffer, scan.preparedImageInfo);

    if (shouldOverlayLogo()) {
      const logo = await loadLogo();
      const base = sharp(imgBuffer);
      const meta = await base.metadata();
      const width = meta.width ?? 1024;
      const logoWidth = Math.round(width * 0.33);
      const resizedLogo: Buffer = Buffer.from(await sharp(logo).resize({ width: logoWidth }).png().toBuffer());
      imgBuffer = Buffer.from(await base.composite([{ input: resizedLogo, gravity: "southeast" }]).png().toBuffer());
    }

    return withCors(req, NextResponse.json({ imageBase64: imgBuffer.toString("base64") }));
  } catch (err: any) {
    return withCors(req, NextResponse.json({ error: "Prompt image failed", message: err?.message ?? "Unknown error" }, { status: 500 }));
  }
}
