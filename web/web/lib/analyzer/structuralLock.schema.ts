export const structuralLockSchema = {
  name: "visual_structural_lock",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    required: [
      "meta",
      "camera",
      "global_structure",
      "interior_structure",
      "exterior_structure",
      "openings",
      "stairs",
      "fixtures",
      "cabinetry",
      "materials",
      "lighting",
      "clearances",
      "branding_constraints",
      "analysis_integrity"
    ],
    properties: {
      meta: {
        type: "object",
        required: [
          "category",
          "subcategory",
          "scope",
          "camera_view",
          "image_orientation",
          "confidence"
        ],
        properties: {
          category: { enum: ["interior", "exterior"] },
          subcategory: {
            enum: [
              "kitchen",
              "bathroom",
              "bedroom",
              "living_room",
              "stairs",
              "hallway",
              "garage",
              "front_of_house",
              "side_of_house",
              "back_of_house",
              "porch",
              "deck",
              "other"
            ]
          },
          scope: {
            enum: [
              "single_room",
              "multi_room",
              "partial_structure",
              "full_structure"
            ]
          },
          camera_view: {
            enum: ["straight_on", "angled", "wide", "close_up", "elevation"]
          },
          image_orientation: { enum: ["landscape", "portrait"] },
          confidence: { enum: ["high", "medium", "low"] }
        }
      },

      camera: {
        type: "object",
        required: [
          "locked",
          "height_in",
          "distance_ft",
          "lens",
          "vanishing_points"
        ],
        properties: {
          locked: { const: true },
          height_in: { type: ["number", "null"] },
          distance_ft: { type: ["number", "null"] },
          lens: { enum: ["wide", "normal", "telephoto", "unknown"] },
          vanishing_points: {
            type: "object",
            required: ["horizontal", "vertical"],
            properties: {
              horizontal: { type: "boolean" },
              vertical: { type: "boolean" }
            }
          }
        }
      },

      global_structure: {
        type: "object",
        required: [
          "floor_visible",
          "ceiling_visible",
          "wall_count",
          "ceiling_height_in",
          "symmetry"
        ],
        properties: {
          floor_visible: { type: "boolean" },
          ceiling_visible: { type: "boolean" },
          wall_count: { type: "number" },
          ceiling_height_in: { type: ["number", "null"] },
          symmetry: { enum: ["symmetrical", "asymmetrical", "unknown"] }
        }
      },

      exterior_structure: {
        type: "object",
        required: ["stories", "roof", "siding", "foundation_visible", "grade"],
        properties: {
          stories: { type: ["number", "null"] },
          roof: {
            type: "object",
            required: ["type", "pitch"],
            properties: {
              type: {
                enum: ["gable", "hip", "flat", "shed", "gambrel", "unknown"]
              },
              pitch: { enum: ["low", "medium", "steep", "unknown"] }
            }
          },
          siding: {
            type: "object",
            required: ["material", "orientation"],
            properties: {
              material: {
                enum: [
                  "vinyl",
                  "brick",
                  "stucco",
                  "wood",
                  "fiber_cement",
                  "stone",
                  "mixed",
                  "unknown"
                ]
              },
              orientation: {
                enum: ["horizontal", "vertical", "mixed", "unknown"]
              }
            }
          },
          foundation_visible: { type: "boolean" },
          grade: { enum: ["flat", "sloped", "unknown"] }
        }
      },

      interior_structure: {
        type: "object",
        required: ["room_shape", "open_concept", "adjacent_rooms_visible"],
        properties: {
          room_shape: {
            enum: ["rectangular", "square", "L_shaped", "irregular", "unknown"]
          },
          open_concept: { type: "boolean" },
          adjacent_rooms_visible: { type: "boolean" }
        }
      },

      openings: {
        type: "object",
        required: ["windows", "doors"],
        properties: {
          windows: {
            type: "array",
            items: {
              type: "object",
              required: [
                "count",
                "placement",
                "width_in",
                "height_in",
                "sill_height_in",
                "trim"
              ],
              properties: {
                count: { type: "number" },
                placement: {
                  enum: ["centered", "offset", "corner", "unknown"]
                },
                width_in: { type: ["number", "null"] },
                height_in: { type: ["number", "null"] },
                sill_height_in: { type: ["number", "null"] },
                trim: {
                  enum: ["flat", "decorative", "none", "unknown"]
                }
              }
            }
          },
          doors: {
            type: "array",
            items: {
              type: "object",
              required: ["type", "style", "swing", "width_in", "height_in"],
              properties: {
                type: { enum: ["interior", "exterior", "garage"] },
                style: {
                  enum: ["swing", "sliding", "folding", "overhead", "unknown"]
                },
                swing: { enum: ["left", "right", "unknown"] },
                width_in: { type: ["number", "null"] },
                height_in: { type: ["number", "null"] }
              }
            }
          }
        }
      },

      stairs: {
        type: "object",
        required: ["present", "direction", "width_in", "railing"],
        properties: {
          present: { type: "boolean" },
          direction: { enum: ["up", "down", "unknown"] },
          width_in: { type: ["number", "null"] },
          railing: { type: "boolean" }
        }
      },

      fixtures: {
        type: "object",
        required: ["kitchen", "bathroom"],
        properties: {
          kitchen: {
            type: "object",
            required: ["sink", "dishwasher", "range", "refrigerator"],
            properties: {
              sink: {
                type: "object",
                required: ["present", "location", "base_width_in"],
                properties: {
                  present: { type: "boolean" },
                  location: {
                    enum: ["under_window", "island", "wall", "unknown"]
                  },
                  base_width_in: { type: ["number", "null"] }
                }
              },
              dishwasher: {
                type: "object",
                required: ["present", "position"],
                properties: {
                  present: { type: "boolean" },
                  position: {
                    enum: ["left_of_sink", "right_of_sink", "unknown"]
                  }
                }
              },
              range: {
                type: "object",
                required: ["present", "type", "position"],
                properties: {
                  present: { type: "boolean" },
                  type: {
                    enum: ["freestanding", "slide_in", "cooktop", "unknown"]
                  },
                  position: { enum: ["wall", "island", "unknown"] }
                }
              },
              refrigerator: {
                type: "object",
                required: ["present", "position"],
                properties: {
                  present: { type: "boolean" },
                  position: { enum: ["left", "right", "end", "unknown"] }
                }
              }
            }
          },
          bathroom: {
            type: "object",
            required: ["toilet", "vanity_width_in", "shower"],
            properties: {
              toilet: { type: "boolean" },
              vanity_width_in: { type: ["number", "null"] },
              shower: {
                enum: ["tub", "walk_in", "tub_shower_combo", "unknown"]
              }
            }
          }
        }
      },

      cabinetry: {
        type: "object",
        required: ["upper", "lower", "tall"],
        properties: {
          upper: {
            type: "object",
            required: ["present", "count_left", "count_right", "door_style"],
            properties: {
              present: { type: "boolean" },
              count_left: { type: ["number", "null"] },
              count_right: { type: ["number", "null"] },
              door_style: {
                enum: ["shaker", "slab", "raised", "unknown"]
              }
            }
          },
          lower: {
            type: "object",
            required: ["drawer_stacks", "sink_base"],
            properties: {
              drawer_stacks: { type: "boolean" },
              sink_base: { type: "boolean" }
            }
          },
          tall: {
            type: "object",
            required: ["pantry", "location"],
            properties: {
              pantry: { type: "boolean" },
              location: { enum: ["left", "right", "unknown"] }
            }
          }
        }
      },

      materials: {
        type: "object",
        required: ["flooring", "countertops", "backsplash", "paint"],
        properties: {
          flooring: {
            type: "object",
            required: ["material", "orientation"],
            properties: {
              material: {
                enum: [
                  "tile",
                  "hardwood",
                  "lvp",
                  "carpet",
                  "concrete",
                  "unknown"
                ]
              },
              orientation: {
                enum: ["horizontal", "vertical", "diagonal", "unknown"]
              }
            }
          },
          countertops: {
            type: "object",
            required: ["material", "thickness_in"],
            properties: {
              material: {
                enum: [
                  "quartz",
                  "granite",
                  "laminate",
                  "solid_surface",
                  "unknown"
                ]
              },
              thickness_in: { type: ["number", "null"] }
            }
          },
          backsplash: {
            type: "object",
            required: ["present", "tile_size", "pattern"],
            properties: {
              present: { type: "boolean" },
              tile_size: { type: ["string", "null"] },
              pattern: {
                enum: ["subway", "stacked", "herringbone", "unknown"]
              }
            }
          },
          paint: {
            type: "object",
            required: ["walls", "cabinets"],
            properties: {
              walls: { enum: ["light", "medium", "dark", "unknown"] },
              cabinets: { enum: ["light", "medium", "dark", "unknown"] }
            }
          }
        }
      },

      lighting: {
        type: "object",
        required: ["natural_sources", "ceiling", "under_cabinet"],
        properties: {
          natural_sources: {
            type: "array",
            items: { enum: ["window", "door"] }
          },
          ceiling: {
            type: "array",
            items: {
              type: "object",
              required: ["type", "count"],
              properties: {
                type: {
                  enum: [
                    "recessed",
                    "flush",
                    "pendant",
                    "chandelier",
                    "unknown"
                  ]
                },
                count: { type: ["number", "null"] }
              }
            }
          },
          under_cabinet: { type: "boolean" }
        }
      },

      clearances: {
        type: "object",
        required: [
          "walkway_depth_in",
          "counter_clearance_in",
          "appliance_clearance_valid"
        ],
        properties: {
          walkway_depth_in: { type: ["number", "null"] },
          counter_clearance_in: { type: ["number", "null"] },
          appliance_clearance_valid: { type: "boolean" }
        }
      },

      branding_constraints: {
        type: "object",
        required: ["zone", "max_width_percent", "opacity", "exclusions"],
        properties: {
          zone: { const: "bottom_right" },
          max_width_percent: { const: 22 },
          opacity: { const: 0.7 },
          exclusions: {
            type: "array",
            items: {
              enum: [
                "faces",
                "appliances",
                "windows",
                "doors",
                "primary_focal_points"
              ]
            }
          }
        }
      },

      analysis_integrity: {
        type: "object",
        required: ["layout_locked", "geometry_confidence", "uncertainty_notes"],
        properties: {
          layout_locked: { const: true },
          geometry_confidence: {
            enum: ["high", "medium", "low"]
          },
          uncertainty_notes: { type: ["string", "null"] }
        }
      }
    }
  }
} as const;
