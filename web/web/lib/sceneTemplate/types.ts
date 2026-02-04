export type TemplateDomain = "interior" | "exterior" | "unknown";

export type EditableOp = "recolor" | "texture_swap";
export type RenderMode = "recolor_shading" | "planar_project" | "screen_texture";

export type PlaneFit = {
  valid: boolean;
  // Normalized image-space quad corners (clockwise) representing the surface patch.
  // This is a pragmatic 2.5D approximation used for instant preview projection.
  quad_norm?: [number, number][]; // length 4
};

export type SurfaceTemplate = {
  id: string;
  type: string;
  label: string;
  editable_ops: EditableOp[];
  render_mode: RenderMode;
  // PNG data URL mask (white w/ alpha)
  mask_png?: string;
  // If true, this surface should be treated as an occluder (always on top / not editable).
  occluder?: boolean;
  plane?: PlaneFit;
  // Basic stats for shading preservation / UI.
  stats?: {
    area_ratio?: number;
    mean_rgb?: [number, number, number];
  };
};

export type SceneTemplate = {
  schema_version: "1.0";
  template_id: string;
  domain: TemplateDomain;
  subcategory: string;
  image: {
    width: number;
    height: number;
    // The source image shown in editor (prepared jpg data url)
    prepared_src: string;
  };
  surfaces: SurfaceTemplate[];
  constraints: {
    // Draw order for deterministic compositing.
    layer_order: string[];
  };
  quality: {
    score: number; // 0..1
    warnings: string[];
  };
};
