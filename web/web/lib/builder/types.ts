import type { PreparedImageInfo } from "@/lib/jobs";

export type SceneCategory = "interior" | "exterior";

export type RoomSubcategory =
  | "kitchen"
  | "bathroom"
  | "bedroom"
  | "living_room"
  | "dining_room"
  | "hallway"
  | "stairs"
  | "garage"
  | "laundry"
  | "office"
  | "front_of_house"
  | "back_of_house"
  | "side_of_house"
  | "porch"
  | "deck"
  | "patio"
  | "yard"
  | "other";

export type ScanConfidence = "high" | "medium" | "low";

export type SceneElementType =
  | "floor"
  | "walls"
  | "ceiling"
  | "cabinets"
  | "countertop"
  | "backsplash"
  | "appliances"
  | "sink"
  | "faucet"
  | "lighting"
  | "windows"
  | "door"
  | "siding"
  | "trim"
  | "roof"
  | "front_door"
  | "garage_door"
  | "driveway"
  | "walkway"
  | "deck"
  | "patio"
  | "fence"
  | "pool"
  | "landscaping"
  | "other";

export type PolygonPointNorm = [number, number];

export interface PolygonMask {
  type: "polygon";
  /** Normalized polygon points: [[x,y],...] where x,y in [0..1] */
  points_norm: PolygonPointNorm[];
}

export interface SceneElement {
  id: string;
  type: SceneElementType;
  label: string;
  mask: PolygonMask;
  /** 0..1 */
  confidence: number;
}

export interface SceneGraph {
  meta: {
    category: SceneCategory;
    subcategory: RoomSubcategory;
    confidence: ScanConfidence;
    notes?: string;
  };
  locks: {
    perspective_locked: true;
    /** Things that must never move (doors, windows, appliances, etc.) */
    do_not_move: string[];
    /** Things that must never be added/removed */
    do_not_change: string[];
  };
  elements: SceneElement[];
}

export interface ScanRecord {
  id: string;
  createdAt: number;

  // Scanner output (stored to avoid re-scanning)
  sceneGraphJSON: string;

  // Prepared image (so render can happen without re-upload)
  preparedImageBase64: string;
  preparedImageMime: string;
  preparedImageInfo: PreparedImageInfo;

  // Original image for accurate masking/alignment (prepared image may be padded/resized)
  originalImageBase64: string;
  originalImageMime: string;

  // Optional 2.5D scene template (JSON) for deterministic editor rendering
  sceneTemplateJSON?: string;
}

export type OptionKind = "color" | "material" | "style";

export type OptionPreview =
  | { kind: "color"; hex: string }
  | { kind: "image"; src: string }
  | null;

export interface BuilderOption {
  id: string;
  label: string;
  kind: OptionKind;
  preview: OptionPreview;
  /** Short text appended into the render prompt */
  renderHint: string;
}

export type PreviewMode = "overlay" | "final_only";

export interface BuilderModule {
  featureId: string;
  label: string;
  targetElementTypes: SceneElementType[];
  previewMode: PreviewMode;
  options: BuilderOption[];
  defaultOptionId?: string;
}
