// lib/imagePrep.ts

import sharp from "sharp";
import type { PreparedImageInfo, SupportedImageSize } from "./jobs";

const SIZE_MAP: Record<SupportedImageSize, { w: number; h: number }> = {
  "1024x1024": { w: 1024, h: 1024 },
  "1536x1024": { w: 1536, h: 1024 },
  "1024x1536": { w: 1024, h: 1536 },
};

function pickClosestSize(w: number, h: number): SupportedImageSize {
  const r = w / h;
  const candidates: SupportedImageSize[] = ["1024x1024", "1536x1024", "1024x1536"];

  let best = candidates[0];
  let bestDiff = Infinity;
  for (const c of candidates) {
    const cr = SIZE_MAP[c].w / SIZE_MAP[c].h;
    const diff = Math.abs(r - cr);
    if (diff < bestDiff) {
      bestDiff = diff;
      best = c;
    }
  }
  return best;
}

/**
 * Resize + pad an input image to the closest model-supported size,
 * while preserving camera angle / composition (no cropping).
 */
export async function prepareImageForEdit(input: Buffer): Promise<{
  preparedBuffer: Buffer;
  info: PreparedImageInfo;
}> {
  const img = sharp(input, { failOn: "none" });
  const meta = await img.metadata();
  if (!meta.width || !meta.height) {
    throw new Error("Could not read image dimensions.");
  }

  const originalW = meta.width;
  const originalH = meta.height;
  const size = pickClosestSize(originalW, originalH);
  const { w: targetW, h: targetH } = SIZE_MAP[size];

  // Use the mean image color as the padding background to avoid harsh borders.
  const stats = await img.stats();
  const r = Math.round(stats.channels[0]?.mean ?? 0);
  const g = Math.round(stats.channels[1]?.mean ?? 0);
  const b = Math.round(stats.channels[2]?.mean ?? 0);

  // Contain within target and pad.
  // We'll compute the crop box for the original content inside the padded image.
  const scale = Math.min(targetW / originalW, targetH / originalH);
  const resizedW = Math.round(originalW * scale);
  const resizedH = Math.round(originalH * scale);
  const left = Math.floor((targetW - resizedW) / 2);
  const top = Math.floor((targetH - resizedH) / 2);

  const preparedBuffer = await img
    .resize(targetW, targetH, {
      fit: "contain",
      background: { r, g, b, alpha: 1 },
    })
    .jpeg({ quality: 92 })
    .toBuffer();

  const info: PreparedImageInfo = {
    size,
    width: targetW,
    height: targetH,
    crop: { left, top, width: resizedW, height: resizedH },
    original: { width: originalW, height: originalH },
  };

  return { preparedBuffer, info };
}

/**
 * Remove padding from a generated image by cropping to the original content box
 * and resizing back to the original dimensions.
 */
export async function unpadGeneratedImage(
  generated: Buffer,
  info: PreparedImageInfo
): Promise<Buffer> {
  const { crop, original } = info;
  return sharp(generated, { failOn: "none" })
    .extract({ left: crop.left, top: crop.top, width: crop.width, height: crop.height })
    .resize(original.width, original.height, { fit: "fill" })
    .png()
    .toBuffer();
}
