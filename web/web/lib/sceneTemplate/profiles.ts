import type { SceneCategory, RoomSubcategory, SceneElementType } from "@/lib/builder/types";

export type SceneProfile = {
  category: SceneCategory;
  subcategory: RoomSubcategory;
  /** Editable surfaces we try to detect and offer in the editor. */
  surfaces: SceneElementType[];
  /** Non-editable masks that must remain in front of edited surfaces. */
  occluders: SceneElementType[];
};

const INTERIOR_COMMON_SURFACES: SceneElementType[] = ["floor", "walls", "ceiling"];
const INTERIOR_COMMON_OCCLUDERS: SceneElementType[] = ["appliances", "windows", "door", "sink", "faucet"];

const EXTERIOR_COMMON_SURFACES: SceneElementType[] = [
  "siding",
  "trim",
  "roof",
  "driveway",
  "walkway",
  "deck",
  "patio",
  "fence",
  "landscaping",
  "pool",
];
const EXTERIOR_COMMON_OCCLUDERS: SceneElementType[] = ["windows", "front_door", "garage_door"];

export function getSceneProfile(category: SceneCategory, subcategory: RoomSubcategory): SceneProfile {
  const cat = category;

  if (cat === "interior") {
    if (subcategory === "kitchen") {
      return {
        category: cat,
        subcategory,
        surfaces: [...INTERIOR_COMMON_SURFACES, "cabinets", "countertop", "backsplash"],
        occluders: INTERIOR_COMMON_OCCLUDERS,
      };
    }
    if (subcategory === "bathroom") {
      return {
        category: cat,
        subcategory,
        surfaces: [...INTERIOR_COMMON_SURFACES, "cabinets", "countertop", "backsplash"],
        occluders: INTERIOR_COMMON_OCCLUDERS,
      };
    }
    // Default interior
    return {
      category: cat,
      subcategory,
      surfaces: INTERIOR_COMMON_SURFACES,
      occluders: [...new Set(["windows", "door"])],
    };
  }

  // Exterior
  return {
    category: "exterior",
    subcategory,
    surfaces: EXTERIOR_COMMON_SURFACES,
    occluders: EXTERIOR_COMMON_OCCLUDERS,
  };
}

export function defaultLayerOrder(profile: SceneProfile): SceneElementType[] {
  // Deterministic compositing order (back-to-front). Occluders are handled separately.
  if (profile.category === "interior") {
    return ["floor", "countertop", "backsplash", "walls", "cabinets", "ceiling"];
  }
  return ["roof", "siding", "trim", "driveway", "walkway", "deck", "patio", "fence", "landscaping", "pool"];
}
