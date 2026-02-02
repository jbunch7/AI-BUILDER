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

function materialOpt(id: string, label: string, previewHex: string, renderHint: string): BuilderOption {
  return {
    id,
    label,
    kind: "material",
    preview: { kind: "color", hex: previewHex },
    renderHint,
  };
}

export function buildModules(scene: SceneGraph): BuilderModule[] {
  const modules: BuilderModule[] = [];

  const isInterior = scene.meta?.category === "interior";
  const isExterior = scene.meta?.category === "exterior";

  // WALL PAINT
  if (hasElementType(scene, "walls")) {
    modules.push({
      featureId: "walls_paint",
      label: "Wall color",
      targetElementTypes: ["walls"],
      previewMode: "overlay",
      defaultOptionId: "wall_warm_white",
      options: [
        colorOpt("wall_warm_white", "Warm White", "#F4F1E8", "Warm white painted walls"),
        colorOpt("wall_soft_greige", "Soft Greige", "#CFC7BA", "Soft greige painted walls"),
        colorOpt("wall_misty_blue", "Misty Blue", "#B9C9D6", "Misty blue painted walls"),
        colorOpt("wall_sage", "Sage", "#A9B5A3", "Soft sage green painted walls"),
        colorOpt("wall_charcoal", "Charcoal", "#2B2D30", "Charcoal painted walls"),
      ],
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
      options: [
        colorOpt("ceil_bright_white", "Bright White", "#FAFAFA", "Bright white ceiling"),
        colorOpt("ceil_soft_white", "Soft White", "#F2F0EA", "Soft white ceiling"),
      ],
    });
  }

  // FLOORING
  if (hasElementType(scene, "floor")) {
    modules.push({
      featureId: "flooring",
      label: "Flooring",
      targetElementTypes: ["floor"],
      previewMode: "overlay",
      defaultOptionId: "floor_light_oak",
      options: [
        materialOpt(
          "floor_light_oak",
          "Light Oak",
          "#C9B08B",
          "Light natural oak flooring, matte finish, realistic grain, same plank direction as existing"
        ),
        materialOpt(
          "floor_medium_oak",
          "Medium Oak",
          "#A9825A",
          "Medium oak flooring, matte finish, realistic grain, same plank direction as existing"
        ),
        materialOpt(
          "floor_dark_walnut",
          "Dark Walnut",
          "#5A3B2B",
          "Dark walnut wood flooring, satin-matte finish, realistic grain, same plank direction as existing"
        ),
        materialOpt(
          "floor_warm_tile",
          "Warm Tile",
          "#C7B8A7",
          "Warm neutral porcelain tile flooring, realistic grout lines, same tile scale as existing"
        ),
        materialOpt(
          "floor_concrete",
          "Polished Concrete",
          "#9AA0A6",
          "Polished concrete floor, subtle mottling, low-gloss sheen"
        ),
      ],
    });
  }

  // CABINETS (interior only)
  if (isInterior && hasElementType(scene, "cabinets")) {
    modules.push({
      featureId: "cabinets_color",
      label: "Cabinet color",
      targetElementTypes: ["cabinets"],
      previewMode: "overlay",
      defaultOptionId: "cab_warm_white",
      options: [
        colorOpt("cab_warm_white", "Warm White", "#F5F2EA", "Warm white cabinets"),
        colorOpt("cab_soft_greige", "Greige", "#BEB6AA", "Soft greige cabinets"),
        colorOpt("cab_sage", "Sage", "#8E9C8A", "Sage green cabinets"),
        colorOpt("cab_navy", "Deep Navy", "#1F2A44", "Deep navy cabinets"),
        colorOpt("cab_charcoal", "Charcoal", "#2B2D30", "Charcoal cabinets"),
      ],
    });
  }

  // EXTERIOR: SIDING / TRIM / DOOR
  if (isExterior && hasElementType(scene, "siding")) {
    modules.push({
      featureId: "siding_color",
      label: "Siding color",
      targetElementTypes: ["siding"],
      previewMode: "overlay",
      defaultOptionId: "siding_warm_white",
      options: [
        colorOpt("siding_warm_white", "Warm White", "#F2EFE7", "Warm white exterior siding"),
        colorOpt("siding_light_greige", "Light Greige", "#D3CEC3", "Light greige exterior siding"),
        colorOpt("siding_slate", "Slate", "#5A6772", "Slate blue-gray exterior siding"),
        colorOpt("siding_charcoal", "Charcoal", "#2E3136", "Charcoal exterior siding"),
      ],
    });
  }

  if (isExterior && hasElementType(scene, "trim")) {
    modules.push({
      featureId: "trim_color",
      label: "Trim color",
      targetElementTypes: ["trim"],
      previewMode: "overlay",
      defaultOptionId: "trim_bright_white",
      options: [
        colorOpt("trim_bright_white", "Bright White", "#FAFAFA", "Bright white exterior trim"),
        colorOpt("trim_soft_white", "Soft White", "#F2F0EA", "Soft white exterior trim"),
        colorOpt("trim_black", "Black", "#1A1A1A", "Black exterior trim"),
      ],
    });
  }

  if (isExterior && hasElementType(scene, "door")) {
    modules.push({
      featureId: "front_door_color",
      label: "Door color",
      targetElementTypes: ["door"],
      previewMode: "overlay",
      defaultOptionId: "door_black",
      options: [
        colorOpt("door_black", "Black", "#1A1A1A", "Black front door"),
        colorOpt("door_navy", "Navy", "#1F2A44", "Navy front door"),
        colorOpt("door_red", "Classic Red", "#7B1E1E", "Classic red front door"),
        colorOpt("door_wood", "Natural Wood", "#7A5537", "Natural wood stained front door"),
      ],
    });
  }

  // If the scan was weak and no modules were detected, fall back to a minimal palette.
  if (modules.length === 0) {
    // Universal fallback: try walls and floor even if not detected.
    modules.push({
      featureId: "beautify",
      label: "Overall refresh",
      targetElementTypes: ["other"],
      previewMode: "final_only",
      options: [
        {
          id: "beautify_soft",
          label: "Soft refresh",
          kind: "style",
          preview: null,
          renderHint:
            "A subtle refresh: improved lighting, cleaner color balance, slight declutter, no layout changes",
        },
        {
          id: "beautify_premium",
          label: "Premium refresh",
          kind: "style",
          preview: null,
          renderHint:
            "A premium refresh: improved lighting, clean modern finishes, tasteful upgrades, no layout changes",
        },
      ],
    });
  }

  return modules;
}
