import type { BuilderModule, BuilderOption, SceneGraph, SceneElementType } from "@/lib/builder/types";

/**
 * Configurator options (MVP)
 * ---------------------------------------------------------------------------
 * Design rules:
 * - Exactly 3 options per surface
 * - Curated to mix-and-match well for remodel concepts
 * - No pre-selected defaults (prompted baseline is shown first)
 */

function hasElementType(scene: SceneGraph, t: SceneElementType) {
  return Array.isArray(scene.elements) && scene.elements.some((e) => e?.type === t);
}

function colorOpt(id: string, label: string, hex: string, renderHint: string): BuilderOption {
  return {
    id,
    label,
    kind: "color",
    preview: { kind: "color", hex },
    renderHint,
  };
}

function materialOpt(id: string, label: string, src: string, renderHint: string): BuilderOption {
  return {
    id,
    label,
    kind: "material",
    preview: { kind: "image", src },
    renderHint,
  };
}

// -----------------------------------------------------------------------------
// Curated Light / Neutral / Dark sets
// -----------------------------------------------------------------------------

function wallOptions(): BuilderOption[] {
  return [
    colorOpt("walls_light", "Light", "#F4F1E8", "Warm white painted walls (light)"),
    colorOpt("walls_neutral", "Neutral", "#D3CEC3", "Soft greige painted walls (neutral)"),
    colorOpt("walls_dark", "Dark", "#2B2D30", "Charcoal painted walls (dark)"),
  ];
}

function floorOptions(scene: SceneGraph): BuilderOption[] {
  const sub = scene.meta?.subcategory || "other";
  const preferTile = sub === "bathroom" || sub === "laundry";

  if (preferTile) {
    return [
      materialOpt(
        "floor_light",
        "Light",
        "/textures/tile_light.jpg",
        "Light neutral tile flooring (light), realistic grout, consistent scale"
      ),
      materialOpt(
        "floor_neutral",
        "Neutral",
        "/textures/tile_gray.jpg",
        "Soft gray tile flooring (neutral), realistic grout, consistent scale"
      ),
      materialOpt(
        "floor_dark",
        "Dark",
        "/textures/stone_dark.jpg",
        "Dark stone / slate flooring (dark), matte finish, realistic scale"
      ),
    ];
  }

  return [
    materialOpt(
      "floor_light",
      "Light",
      "/textures/wood_oak_light.jpg",
      "Light natural oak flooring (light), matte finish, realistic grain, keep plank direction consistent"
    ),
    materialOpt(
      "floor_neutral",
      "Neutral",
      "/textures/wood_oak_medium.jpg",
      "Natural oak flooring (neutral), matte finish, realistic grain"
    ),
    materialOpt(
      "floor_dark",
      "Dark",
      "/textures/wood_walnut.jpg",
      "Dark walnut flooring (dark), satin-matte finish, realistic grain, keep plank direction consistent"
    ),
  ];
}

function cabinetOptions(scene: SceneGraph): BuilderOption[] {
  const sub = scene.meta?.subcategory || "other";
  const isBath = sub === "bathroom";
  return [
    colorOpt(
      "cabinets_light",
      "Light",
      "#F5F2EA",
      isBath ? "Warm white vanity/cabinets (light)" : "Warm white kitchen cabinets (light)"
    ),
    colorOpt(
      "cabinets_neutral",
      "Neutral",
      "#BEB6AA",
      isBath ? "Greige vanity/cabinets (neutral)" : "Greige kitchen cabinets (neutral)"
    ),
    colorOpt(
      "cabinets_dark",
      "Dark",
      "#2B2D30",
      isBath ? "Charcoal vanity/cabinets (dark)" : "Charcoal kitchen cabinets (dark)"
    ),
  ];
}

function countertopOptions(scene: SceneGraph): BuilderOption[] {
  const sub = scene.meta?.subcategory || "other";
  const isBath = sub === "bathroom";
  return [
    materialOpt(
      "ct_light",
      "Light",
      "/textures/marble_white.jpg",
      isBath
        ? "Bright white quartz vanity top (light), subtle veining"
        : "Bright white quartz countertop (light), subtle veining, clean modern finish"
    ),
    materialOpt(
      "ct_neutral",
      "Neutral",
      "/textures/wood_oak_medium.jpg",
      isBath
        ? "Warm wood vanity top look (neutral), clean premium finish"
        : "Butcher block countertop (neutral), warm natural wood, satin finish"
    ),
    materialOpt(
      "ct_dark",
      "Dark",
      "/textures/stone_dark.jpg",
      isBath ? "Dark stone vanity top (dark), matte finish" : "Dark stone / soapstone countertop (dark), matte finish"
    ),
  ];
}

function backsplashOptions(): BuilderOption[] {
  return [
    materialOpt(
      "bs_light",
      "Light",
      "/textures/tile_subway_white.jpg",
      "White subway tile backsplash (light), clean grout, realistic scale"
    ),
    materialOpt(
      "bs_neutral",
      "Neutral",
      "/textures/tile_light.jpg",
      "Warm light stone/tile backsplash (neutral), clean grout, realistic scale"
    ),
    materialOpt(
      "bs_dark",
      "Dark",
      "/textures/tile_gray.jpg",
      "Charcoal / dark gray tile backsplash (dark), clean grout, realistic scale"
    ),
  ];
}

function sidingOptions(): BuilderOption[] {
  return [
    colorOpt("siding_light", "Light", "#F2EFE7", "Warm white exterior siding (light)"),
    colorOpt("siding_neutral", "Neutral", "#D3CEC3", "Light greige exterior siding (neutral)"),
    colorOpt("siding_dark", "Dark", "#2E3136", "Charcoal exterior siding (dark)"),
  ];
}

function trimOptions(): BuilderOption[] {
  return [
    colorOpt("trim_light", "Light", "#FAFAFA", "Bright white exterior trim (light)"),
    colorOpt("trim_neutral", "Neutral", "#D9D9D9", "Soft gray exterior trim (neutral)"),
    colorOpt("trim_dark", "Dark", "#1A1A1A", "Black exterior trim (dark)"),
  ];
}

function doorOptions(): BuilderOption[] {
  return [
    colorOpt("door_light", "Light", "#7A5537", "Natural wood stained front door (light)"),
    colorOpt("door_neutral", "Neutral", "#1F2A44", "Navy front door (neutral)"),
    colorOpt("door_dark", "Dark", "#1A1A1A", "Black front door (dark)"),
  ];
}

export function buildModules(scene: SceneGraph, _extras: Record<string, boolean> = {}): BuilderModule[] {
  const modules: BuilderModule[] = [];

  const isInterior = scene.meta?.category === "interior";
  const isExterior = scene.meta?.category === "exterior";
  const sub = scene.meta?.subcategory || "other";

  // ---- Interior
  if (isInterior) {
    if (hasElementType(scene, "walls")) {
      modules.push({
        featureId: "walls_paint",
        label: "Wall color",
        targetElementTypes: ["walls"],
        previewMode: "overlay",
        options: wallOptions(),
      });
    }

    if (hasElementType(scene, "floor")) {
      modules.push({
        featureId: "flooring",
        label: "Flooring",
        targetElementTypes: ["floor"],
        previewMode: "overlay",
        options: floorOptions(scene),
      });
    }

    if (hasElementType(scene, "cabinets")) {
      modules.push({
        featureId: "cabinets_color",
        label: sub === "bathroom" ? "Vanity / cabinets" : "Cabinet color",
        targetElementTypes: ["cabinets"],
        previewMode: "overlay",
        options: cabinetOptions(scene),
      });
    }

    if (hasElementType(scene, "countertop")) {
      modules.push({
        featureId: "countertop",
        label: sub === "bathroom" ? "Vanity top" : "Countertops",
        targetElementTypes: ["countertop"],
        previewMode: "overlay",
        options: countertopOptions(scene),
      });
    }

    if (sub === "kitchen" && hasElementType(scene, "backsplash")) {
      modules.push({
        featureId: "backsplash",
        label: "Backsplash",
        targetElementTypes: ["backsplash"],
        previewMode: "overlay",
        options: backsplashOptions(),
      });
    }
  }

  // ---- Exterior
  if (isExterior) {
    if (hasElementType(scene, "siding")) {
      modules.push({
        featureId: "siding_color",
        label: "Siding color",
        targetElementTypes: ["siding"],
        previewMode: "overlay",
        options: sidingOptions(),
      });
    }

    if (hasElementType(scene, "trim")) {
      modules.push({
        featureId: "trim_color",
        label: "Trim color",
        targetElementTypes: ["trim"],
        previewMode: "overlay",
        options: trimOptions(),
      });
    }

    if (hasElementType(scene, "door")) {
      modules.push({
        featureId: "front_door_color",
        label: "Door color",
        targetElementTypes: ["door"],
        previewMode: "overlay",
        options: doorOptions(),
      });
    }
  }

  return modules;
}
