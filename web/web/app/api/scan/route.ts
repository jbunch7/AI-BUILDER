import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";
import { randomUUID } from "crypto";
import { enforceAllowedOrigin, withCors } from "@/lib/security";
import { prepareImageForEdit } from "@/lib/imagePrep";
import { setScan } from "@/lib/store";
import type { RoomSubcategory, SceneCategory, SceneGraph, ScanRecord, SceneElementType } from "@/lib/builder/types";
import { generateAutoMasks } from "@/lib/masking";
import { getSceneProfile } from "@/lib/sceneTemplate/profiles";
import { buildSceneTemplate } from "@/lib/sceneTemplate/build";

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

async function classifyScene(openai: OpenAI, model: string, dataUrl: string): Promise<{ category: SceneCategory; subcategory: RoomSubcategory; confidence: "high" | "medium" | "low"; notes?: string }> {
  const sys =
    "You are a computer vision scene classifier for a home remodeling editor. Return ONLY valid JSON.";
  const user = {
    type: "input_text",
    text:
      "Classify this photo. Output JSON with keys: category (interior|exterior), subcategory (kitchen,bathroom,bedroom,living_room,dining_room,hallway,garage,laundry,office,front_of_house,back_of_house,side_of_house,porch,deck,patio,yard,other), confidence (high|medium|low), notes (optional).",
  } as const;

  const resp = await openai.responses.create({
    model,
    temperature: 0,
    input: [
      { role: "system", content: sys },
      {
        role: "user",
        content: [user, { type: "input_image", image_url: dataUrl, detail: "high" }],
      },
    ],
  });
  const raw = resp.output_text || "";
  const obj = safeJsonParse(raw) as any;
  const category = (obj?.category === "exterior" ? "exterior" : "interior") as SceneCategory;
  const subcategory = (obj?.subcategory || "other") as RoomSubcategory;
  const confidence = (obj?.confidence || "medium") as "high" | "medium" | "low";
  const notes = typeof obj?.notes === "string" ? obj.notes : undefined;
  return { category, subcategory, confidence, notes };
}

function makeSceneGraph(meta: { category: SceneCategory; subcategory: RoomSubcategory; confidence: "high" | "medium" | "low"; notes?: string }, types: SceneElementType[]): SceneGraph {
  return {
    meta,
    locks: {
      perspective_locked: true,
      do_not_move: ["windows", "door", "appliances", "sink", "faucet"],
      do_not_change: ["windows", "door", "appliances"],
    },
    elements: types.map((t, i) => ({
      id: `${t}_${i}`,
      type: t,
      label: t,
      mask: { type: "polygon", points_norm: [] },
      confidence: 0.6,
    })),
  };
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

    // 1) Scene classification (controls which surfaces to attempt)
    const meta = await classifyScene(openai, model, dataUrl);
    const profile = getSceneProfile(meta.category, meta.subcategory);
    const types: SceneElementType[] = [...new Set([...profile.surfaces, ...profile.occluders])];

    // 2) Build a sceneGraph WITHOUT any GPT geometry. Masks are discovered/refined by the mask service.
    const obj: SceneGraph = makeSceneGraph(meta, types);

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

    // 3) Build a lightweight 2.5D scene template (JSON) that the editor can use deterministically.
    let sceneTemplateJSON: string | undefined;
    try {
      const preparedSrc = `data:image/jpeg;base64,${preparedBuffer.toString("base64")}`;
      const template = await buildSceneTemplate({
        sceneGraph: obj,
        preparedSrc,
        preparedWidth: preparedImageInfo.width,
        preparedHeight: preparedImageInfo.height,
        autoMasks,
      });
      sceneTemplateJSON = JSON.stringify(template);
    } catch {
      sceneTemplateJSON = undefined;
    }

    const record: ScanRecord = {
      id: scanId,
      createdAt: Date.now(),
      sceneGraphJSON: JSON.stringify(obj),
      preparedImageBase64: preparedBuffer.toString("base64"),
      preparedImageMime: "image/jpeg",
      preparedImageInfo,
      originalImageBase64: inputBuffer.toString("base64"),
      originalImageMime: imageMime,
      sceneTemplateJSON,
    };

    await setScan(record);

    return withCors(
      request,
      NextResponse.json({ scanId, sceneGraph: obj, autoMasks, sceneTemplateJSON })
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
