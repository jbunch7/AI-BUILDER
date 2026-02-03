import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";
import { randomUUID } from "crypto";
import { enforceAllowedOrigin, withCors } from "@/lib/security";
import { prepareImageForEdit } from "@/lib/imagePrep";
import { setScan } from "@/lib/store";
import { SCANNER_SYSTEM_PROMPT } from "@/lib/builder/scannerPrompt";
import type { SceneGraph, ScanRecord } from "@/lib/builder/types";
import { generateAutoMasks } from "@/lib/masking";

export const runtime = "nodejs";
export const maxDuration = 120;

function stripToJson(text: string) {
  let t = text.trim();
  t = t.replace(/^```(?:json)?/i, "").replace(/```$/i, "").trim();
  const firstBrace = t.indexOf("{");
  const lastBrace = t.lastIndexOf("}");
  if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
    t = t.slice(firstBrace, lastBrace + 1);
  }
  return t.trim();
}

function safeJsonParse(text: string) {
  const cleaned = stripToJson(text);
  try {
    return JSON.parse(cleaned);
  } catch {
    const preview = cleaned.slice(0, 500);
    throw new Error(`Scanner returned invalid JSON. Preview: ${preview.replace(/\s+/g, " ")}`);
  }
}

function validateSceneGraph(obj: any): obj is SceneGraph {
  if (!obj || typeof obj !== "object") return false;
  if (!obj.meta || typeof obj.meta !== "object") return false;
  if (!obj.locks || typeof obj.locks !== "object") return false;
  if (!Array.isArray(obj.elements)) return false;
  if (obj.locks.perspective_locked !== true) return false;
  return true;
}

export async function POST(request: NextRequest) {
  const originCheck = enforceAllowedOrigin(request);
  if (!originCheck.ok) {
    return withCors(
      request,
      NextResponse.json({ error: originCheck.reason }, { status: 403 })
    );
  }

  if (!process.env.OPENAI_API_KEY) {
    return withCors(
      request,
      NextResponse.json({ error: "Server misconfigured: missing OPENAI_API_KEY" }, { status: 500 })
    );
  }

  try {
    const formData = await request.formData();
    const imageFile = formData.get("image") as File | null;

    if (!imageFile) {
      return withCors(
        request,
        NextResponse.json({ error: "Missing image" }, { status: 400 })
      );
    }

    const inputBuffer = Buffer.from(await imageFile.arrayBuffer());
    const imageMime = imageFile.type || "image/jpeg";
    const dataUrl = `data:${imageMime};base64,${inputBuffer.toString("base64")}`;

    // Prepare image for later rendering
    const { preparedBuffer, info: preparedImageInfo } = await prepareImageForEdit(inputBuffer);

    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

    const model = process.env.SCANNER_MODEL || "gpt-4.1-mini";

    const resp = await openai.responses.create({
      model,
      temperature: 0,
      input: [
        { role: "system", content: SCANNER_SYSTEM_PROMPT },
        {
          role: "user",
          content: [
            {
              type: "input_text",
              text: "Scan this photo for a remodeling configurator. Output JSON only.",
            },
            {
              type: "input_image",
              image_url: dataUrl,
              detail: "high",
            },
          ],
        },
      ],
    });

    const raw = resp.output_text;
    if (!raw) {
      return withCors(
        request,
        NextResponse.json({ error: "Scanner produced no output" }, { status: 500 })
      );
    }

    const obj = safeJsonParse(raw);
    if (!validateSceneGraph(obj)) {
      return withCors(
        request,
        NextResponse.json(
          {
            error: "Scanner output did not match expected shape",
            debug: {
              topLevelKeys: obj && typeof obj === "object" ? Object.keys(obj) : null,
            },
          },
          { status: 500 }
        )
      );
    }

    const scanId = randomUUID();

    // Best-effort: generate raster masks for fast, precise client-side previews.
    // This NEVER blocks returning the scan if masking fails; it gracefully falls back.
    let autoMasks: any = null;
    try {
      autoMasks = await generateAutoMasks({
        sceneGraph: obj as SceneGraph,
        originalImageBuffer: inputBuffer,
      });
    } catch {
      autoMasks = null;
    }

    const record: ScanRecord = {
      id: scanId,
      createdAt: Date.now(),
      sceneGraphJSON: JSON.stringify(obj),
      preparedImageBase64: preparedBuffer.toString("base64"),
      preparedImageMime: "image/jpeg",
      preparedImageInfo,
    };

    await setScan(record);

    return withCors(
      request,
      NextResponse.json({ scanId, sceneGraph: obj, autoMasks })
    );
  } catch (err: any) {
    return withCors(
      request,
      NextResponse.json(
        {
          error: "Scan failed",
          message: err?.message ?? "Unknown error",
        },
        { status: 500 }
      )
    );
  }
}
