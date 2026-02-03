import type { BuilderModule, BuilderOption, SceneGraph, SceneElementType } from "@/lib/builder/types";

function hasElementType(scene: SceneGraph, t: SceneElementType) {
  return Array.isArray(scene.elements) && scene.elements.some((e) => e?.type === t);
}

function colorOpt(id: string, label: string, hex: string, renderHint?: string): BuilderOption {
  return {
    id,
    label,
    kind: "color",
    preview: { kind: "color", hex },
    renderHint: renderHint ?? `${label} (${hex})`,
  };
}

function materialImgOpt(id: string, label: string, src: string, renderHint: string): BuilderOption {
  return {
    id,
    label,
    kind: "material",
    preview: { kind: "image", src },
    renderHint,
  };
}

// -----------------------------------------------------------------------------
// Curated palettes (mix-and-match safe)
// -----------------------------------------------------------------------------
const PALETTES = {
  walls: {
    bright: [
      colorOpt("wall_warm_white", "Warm White", "#F4F1E8", "Warm white painted walls"),
      colorOpt("wall_soft_white", "Soft White", "#F2F0EA", "Soft white painted walls"),
      colorOpt("wall_light_greige", "Light Greige", "#D3CEC3", "Light greige painted walls"),
      colorOpt("wall_soft_greige", "Soft Greige", "#CFC7BA", "Soft greige painted walls"),
    ],
    modern: [
      colorOpt("wall_misty_blue", "Misty Blue", "#B9C9D6", "Misty blue painted walls"),
      colorOpt("wall_sage", "Soft Sage", "#A9B5A3", "Soft sage painted walls"),
      colorOpt("wall_taupe", "Warm Taupe", "#C7B9A6", "Warm taupe painted walls"),
    ],
    moody: [
      colorOpt("wall_charcoal", "Charcoal", "#2B2D30", "Charcoal painted walls"),
      colorOpt("wall_deep_navy", "Deep Navy", "#1F2A44", "Deep navy painted walls"),
    ],
  },
  ceilings: [
    colorOpt("ceil_bright_white", "Bright White", "#FAFAFA", "Bright white ceiling"),
    colorOpt("ceil_soft_white", "Soft White", "#F2F0EA", "Soft white ceiling"),
  ],
  cabinets: {
    kitchen: [
      colorOpt("cab_warm_white", "Warm White", "#F5F2EA", "Warm white cabinets"),
      colorOpt("cab_greige", "Greige", "#BEB6AA", "Soft greige cabinets"),
      colorOpt("cab_sage", "Sage", "#8E9C8A", "Sage green cabinets"),
      colorOpt("cab_navy", "Deep Navy", "#1F2A44", "Deep navy cabinets"),
      colorOpt("cab_charcoal", "Charcoal", "#2B2D30", "Charcoal cabinets"),
    ],
    bath: [
      colorOpt("vanity_white", "Warm White", "#F5F2EA", "Warm white vanity"),
      colorOpt("vanity_greige", "Greige", "#BEB6AA", "Greige vanity"),
      colorOpt("vanity_black", "Black", "#1A1A1A", "Black vanity"),
    ],
  },
  flooring: {
    wood: [
      materialImgOpt(
        "floor_dark_walnut",
        "Dark Walnut",
        "/textures/wood_walnut.jpg",
        "Dark walnut wood flooring, satin-matte finish, realistic grain, keep plank direction consistent"
      ),
      materialImgOpt(
        "floor_light_oak",
        "Light Oak",
        "/textures/wood_oak_light.jpg",
        "Light natural oak flooring, matte finish, realistic grain, keep plank direction consistent"
      ),
      materialImgOpt(
        "floor_mid_oak",
        "Natural Oak",
        "/textures/wood_oak_medium.jpg",
        "Natural oak flooring, matte finish, realistic grain"
      ),
    ],
    tile: [
      materialImgOpt(
        "floor_light_tile",
        "Light Tile",
        "/textures/tile_light.jpg",
        "Light neutral tile flooring, realistic grout, consistent scale"
      ),
      materialImgOpt(
        "floor_gray_tile",
        "Soft Gray Tile",
        "/textures/tile_gray.jpg",
        "Soft gray tile flooring, realistic grout, consistent scale"
      ),
      materialImgOpt(
        "floor_marble_white",
        "White Marble",
        "/textures/marble_white.jpg",
        "White marble tile flooring, subtle veining, realistic scale"
      ),
    ],
  },
  countertops: {
    kitchen: [
      materialImgOpt(
        "ct_quartz_white",
        "White Quartz",
        "/textures/marble_white.jpg",
        "Bright white quartz countertop, subtle veining, clean modern finish"
      ),
      materialImgOpt(
        "ct_dark_stone",
        "Dark Stone",
        "/textures/stone_dark.jpg",
        "Dark stone countertop (soapstone/granite feel), matte finish"
      ),
      materialImgOpt(
        "ct_butcherblock",
        "Butcher Block",
        "/textures/wood_walnut.jpg",
        "Walnut butcher block countertop, satin finish, realistic grain"
      ),
    ],
    bath: [
      materialImgOpt(
        "ct_bath_quartz",
        "White Quartz",
        "/textures/marble_white.jpg",
        "Bright white quartz vanity top, subtle veining"
      ),
      materialImgOpt(
        "ct_bath_dark",
        "Dark Stone",
        "/textures/stone_dark.jpg",
        "Dark stone vanity top, matte finish"
      ),
    ],
  },
  backsplash: [
    materialImgOpt(
      "bs_white_subway",
      "White Subway",
      "/textures/tile_subway_white.jpg",
      "White subway tile backsplash, clean grout, realistic scale"
    ),
    materialImgOpt(
      "bs_marble",
      "Marble",
      "/textures/marble_white.jpg",
      "White marble backsplash with subtle veining"
    ),
    materialImgOpt(
      "bs_soft_gray",
      "Soft Gray",
      "/textures/tile_gray.jpg",
      "Soft gray tile backsplash, clean grout"
    ),
  ],
  exterior: {
    siding: [
      colorOpt("siding_warm_white", "Warm White", "#F2EFE7", "Warm white exterior siding"),
      colorOpt("siding_light_greige", "Light Greige", "#D3CEC3", "Light greige exterior siding"),
      colorOpt("siding_slate", "Slate", "#5A6772", "Slate blue-gray exterior siding"),
      colorOpt("siding_charcoal", "Charcoal", "#2E3136", "Charcoal exterior siding"),
    ],
    trim: [
      colorOpt("trim_bright_white", "Bright White", "#FAFAFA", "Bright white exterior trim"),
      colorOpt("trim_soft_white", "Soft White", "#F2F0EA", "Soft white exterior trim"),
      colorOpt("trim_black", "Black", "#1A1A1A", "Black exterior trim"),
    ],
    door: [
      colorOpt("door_black", "Black", "#1A1A1A", "Black front door"),
      colorOpt("door_navy", "Navy", "#1F2A44", "Navy front door"),
      colorOpt("door_red", "Classic Red", "#7B1E1E", "Classic red front door"),
      colorOpt("door_wood", "Natural Wood", "#7A5537", "Natural wood stained front door"),
    ],
  },
} as const;

function pickWallPalette(scene: SceneGraph) {
  const sub = scene.meta?.subcategory || "other";
  if (["bedroom", "living_room", "dining_room", "office"].includes(sub)) return [...PALETTES.walls.bright, ...PALETTES.walls.modern];
  if (["hallway", "stairs", "laundry", "garage"].includes(sub)) return [...PALETTES.walls.bright];
  if (["kitchen", "bathroom"].includes(sub)) return [...PALETTES.walls.bright, ...PALETTES.walls.modern];
  return [...PALETTES.walls.bright, ...PALETTES.walls.modern, ...PALETTES.walls.moody];
}

function pickFloorPalette(scene: SceneGraph) {
  const sub = scene.meta?.subcategory || "other";
  if (sub === "bathroom" || sub === "laundry") return [...PALETTES.flooring.tile, ...PALETTES.flooring.wood];
  if (sub === "kitchen") return [...PALETTES.flooring.wood, ...PALETTES.flooring.tile];
  return [...PALETTES.flooring.wood];
}

function pickCountertopPalette(scene: SceneGraph) {
  const sub = scene.meta?.subcategory || "other";
  if (sub === "bathroom") return [...PALETTES.countertops.bath];
  return [...PALETTES.countertops.kitchen];
}

export function buildModules(
  scene: SceneGraph,
  _extras: Record<string, boolean> = {}
): BuilderModule[] {
  const modules: BuilderModule[] = [];

  const isInterior = scene.meta?.category === "interior";
  const isExterior = scene.meta?.category === "exterior";
  const sub = scene.meta?.subcategory || "other";

  // Standard upgrades (directly controlled in builder)

  // WALLS
  if (hasElementType(scene, "walls")) {
    modules.push({
      featureId: "walls_paint",
      label: "Wall color",
      targetElementTypes: ["walls"],
      previewMode: "overlay",
      defaultOptionId: pickWallPalette(scene)[0]?.id,
      options: pickWallPalette(scene),
    });
  }

  // CEILING
  if (hasElementType(scene, "ceiling")) {
    modules.push({
      featureId: "ceiling_paint",
      label: "Ceiling color",
      targetElementTypes: ["ceiling"],
      previewMode: "overlay",
      defaultOptionId: "ceil_bright_white",
      options: [...PALETTES.ceilings],
    });
  }

  // FLOORING
  if (hasElementType(scene, "floor")) {
    modules.push({
      featureId: "flooring",
      label: "Flooring",
      targetElementTypes: ["floor"],
      previewMode: "overlay",
      defaultOptionId: pickFloorPalette(scene)[0]?.id,
      options: pickFloorPalette(scene),
    });
  }

  // CABINETS / VANITY
  if (isInterior && hasElementType(scene, "cabinets")) {
    const opts = sub === "bathroom" ? PALETTES.cabinets.bath : PALETTES.cabinets.kitchen;
    modules.push({
      featureId: "cabinets_color",
      label: sub === "bathroom" ? "Vanity / cabinets" : "Cabinet color",
      targetElementTypes: ["cabinets"],
      previewMode: "overlay",
      defaultOptionId: opts[0]?.id,
      options: [...opts],
    });
  }

  // COUNTERTOPS (kitchen/bath)
  if (isInterior && hasElementType(scene, "countertop")) {
    const opts = pickCountertopPalette(scene);
    modules.push({
      featureId: "countertop",
      label: sub === "bathroom" ? "Vanity top" : "Countertops",
      targetElementTypes: ["countertop"],
      previewMode: "overlay",
      defaultOptionId: opts[0]?.id,
      options: opts,
    });
  }

  // BACKSPLASH (kitchen)
  if (isInterior && sub === "kitchen" && hasElementType(scene, "backsplash")) {
    modules.push({
      featureId: "backsplash",
      label: "Backsplash",
      targetElementTypes: ["backsplash"],
      previewMode: "overlay",
      defaultOptionId: PALETTES.backsplash[0]?.id,
      options: [...PALETTES.backsplash],
    });
  }

  // EXTERIOR
  if (isExterior && hasElementType(scene, "siding")) {
    modules.push({
      featureId: "siding_color",
      label: "Siding color",
      targetElementTypes: ["siding"],
      previewMode: "overlay",
      defaultOptionId: "siding_warm_white",
      options: [...PALETTES.exterior.siding],
    });
  }

  if (isExterior && hasElementType(scene, "trim")) {
    modules.push({
      featureId: "trim_color",
      label: "Trim color",
      targetElementTypes: ["trim"],
      previewMode: "overlay",
      defaultOptionId: "trim_bright_white",
      options: [...PALETTES.exterior.trim],
    });
  }

  if (isExterior && hasElementType(scene, "door")) {
    modules.push({
      featureId: "front_door_color",
      label: "Door color",
      targetElementTypes: ["door"],
      previewMode: "overlay",
      defaultOptionId: "door_black",
      options: [...PALETTES.exterior.door],
    });
  }

  return modules;
}
