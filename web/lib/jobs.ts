// lib/jobs.ts

export type JobStatus = "queued" | "processing" | "completed" | "failed";

// GPT Image supported sizes for the Images API and the image generation tool.
// See OpenAI docs for available sizes.
export type SupportedImageSize = "1024x1024" | "1536x1024" | "1024x1536";

export interface PreparedImageInfo {
  /** The exact size we sent to the image model. */
  size: SupportedImageSize;
  width: number;
  height: number;

  /**
   * Crop box (in the prepared image coordinate space) representing the
   * original image content. This lets us remove padding after generation.
   */
  crop: { left: number; top: number; width: number; height: number };

  /** Original (post-client-resize) image dimensions. */
  original: { width: number; height: number };
}

export type BuilderSelections = Record<string, string>; // featureId -> optionId

export interface BuilderJob {
  id: string;
  status: JobStatus;
  createdAt: number;

  // Which scan this render is based on.
  scanId: string;

  // Scanner output (JSON string) used to lock layout + drive the renderer.
  sceneGraphJSON: string;

  // User picks from the UI.
  selections: BuilderSelections;

  // Optional feature toggles (e.g., update appliances).
  extras?: Record<string, boolean>;

  // Optional freeform prompt for additional requests.
  userPrompt?: string;

  // Prepared image we send to OpenAI.
  preparedImageBase64: string; // no data URL prefix
  preparedImageMime: string; // e.g. image/jpeg|image/png|image/webp
  preparedImageInfo: PreparedImageInfo;

  // Final generated image (base64 PNG)
  resultImageBase64?: string;
  error?: string;
}
