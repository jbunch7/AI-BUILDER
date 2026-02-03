"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useWizard } from "../providers";

type Subcat =
  | "kitchen" | "bathroom" | "bedroom" | "living_room" | "dining_room" | "hallway" | "stairs" | "garage" | "laundry" | "office"
  | "front_of_house" | "back_of_house" | "side_of_house" | "porch" | "deck" | "patio" | "yard" | "other";

function ctxFromSubcategory(subcategory: string | undefined) {
  const sc = (subcategory || "other") as Subcat;

  const common = {
    title: "Describe your vision",
    helper: "Tell us the vibe you want. We’ll suggest missing elements and prep options for your live builder.",
  };

  const contexts: Record<Subcat, { placeholder: string; keywords: { floor: RegExp; walls: RegExp; cabinets: RegExp; lighting: RegExp; exterior: RegExp }; extras: Array<{ key: string; label: string; help: string }> }> = {
    kitchen: {
      placeholder:
        "Example: Bright modern kitchen. Warm white cabinets, light quartz counters, matte black hardware, white subway backsplash, and dark walnut floors. Keep layout the same.",
      keywords: {
        floor: /(floor|flooring|lvp|hardwood|tile)/,
        walls: /(wall|paint|color|colour)/,
        cabinets: /(cabinet|cabinets)/,
        lighting: /(light|lighting|fixture|pendant|chandelier|recessed)/,
        exterior: /(siding|trim|roof|door|curb|landscape)/,
      },
      extras: [
        { key: "appliances", label: "Update appliances", help: "Modernize appliance finishes (stainless / black / white)." },
        { key: "lighting", label: "Update light fixtures", help: "Add/swap fixtures for a premium look." },
        { key: "hardware", label: "Update cabinet hardware", help: "New pulls/knobs that match the style." },
      ],
    },
    bathroom: {
      placeholder:
        "Example: Clean spa-style bathroom. Bright walls, modern vanity tone, updated lighting, and fresh tile feel. Keep layout the same.",
      keywords: {
        floor: /(floor|tile|flooring)/,
        walls: /(wall|paint|color|tile)/,
        cabinets: /(vanity|cabinet|cabinets)/,
        lighting: /(light|lighting|fixture|sconce)/,
        exterior: /(siding|trim|roof|door|curb|landscape)/,
      },
      extras: [
        { key: "lighting", label: "Update light fixtures", help: "Modern vanity lights / sconces." },
        { key: "hardware", label: "Update hardware", help: "Faucet + hardware style suggestions." },
      ],
    },
    living_room: {
      placeholder:
        "Example: Make this living room brighter and more modern with warm white walls, clean trim, updated lighting, and a cohesive floor tone. Keep layout the same.",
      keywords: {
        floor: /(floor|flooring|lvp|hardwood|carpet|rug)/,
        walls: /(wall|paint|color|colour)/,
        cabinets: /(built-in|built in|cabinet|shelf|shelving)/,
        lighting: /(light|lighting|fixture|lamp|recessed)/,
        exterior: /(siding|trim|roof|door|curb|landscape)/,
      },
      extras: [
        { key: "lighting", label: "Update lighting", help: "Improve fixture style + brightness." },
        { key: "decor", label: "Modernize details", help: "Tasteful decor touches (subtle, not cluttered)." },
      ],
    },
    bedroom: {
      placeholder:
        "Example: Calm modern bedroom with soft neutral walls, brighter lighting, and a clean floor tone. Keep layout the same.",
      keywords: {
        floor: /(floor|flooring|lvp|hardwood|carpet)/,
        walls: /(wall|paint|color|colour)/,
        cabinets: /(closet|built-in|cabinet)/,
        lighting: /(light|lighting|fixture|lamp)/,
        exterior: /(siding|trim|roof|door|curb|landscape)/,
      },
      extras: [
        { key: "lighting", label: "Update lighting", help: "Modern fixture style + clean brightness." },
        { key: "decor", label: "Modernize details", help: "Simple, premium touches." },
      ],
    },
    dining_room: {
      placeholder:
        "Example: Updated dining space with warm neutral walls, brighter lighting, and a cohesive floor tone. Keep layout the same.",
      keywords: {
        floor: /(floor|flooring|lvp|hardwood|tile)/,
        walls: /(wall|paint|color|colour)/,
        cabinets: /(built-in|cabinet|buffet)/,
        lighting: /(light|lighting|fixture|chandelier|pendant)/,
        exterior: /(siding|trim|roof|door|curb|landscape)/,
      },
      extras: [
        { key: "lighting", label: "Update lighting", help: "Modern chandelier/pendant option." },
      ],
    },
    hallway: {
      placeholder:
        "Example: Bright, clean hallway with fresh paint, updated trim, and a cohesive floor tone. Keep layout the same.",
      keywords: {
        floor: /(floor|flooring|lvp|hardwood|tile)/,
        walls: /(wall|paint|color|colour)/,
        cabinets: /(cabinet|built-in)/,
        lighting: /(light|lighting|fixture)/,
        exterior: /(siding|trim|roof|door|curb|landscape)/,
      },
      extras: [
        { key: "lighting", label: "Update lighting", help: "Cleaner brighter lights." },
      ],
    },
    stairs: {
      placeholder:
        "Example: Modernize these stairs with a clean railing look, brighter paint, and updated tread tone. Keep layout the same.",
      keywords: {
        floor: /(stair|stairs|tread|carpet|runner|wood)/,
        walls: /(wall|paint|color|rail)/,
        cabinets: /(cabinet|built-in)/,
        lighting: /(light|lighting|fixture)/,
        exterior: /(siding|trim|roof|door|curb|landscape)/,
      },
      extras: [
        { key: "lighting", label: "Update lighting", help: "Brighter, cleaner lighting." },
      ],
    },
    garage: {
      placeholder:
        "Example: Clean, organized garage look with brighter lighting, a fresher floor finish, and a tidy modern feel. Keep layout the same.",
      keywords: {
        floor: /(floor|epoxy|concrete)/,
        walls: /(wall|paint|color)/,
        cabinets: /(cabinet|storage)/,
        lighting: /(light|lighting|fixture)/,
        exterior: /(door|driveway|curb|landscape)/,
      },
      extras: [
        { key: "lighting", label: "Update lighting", help: "Brighter, cleaner lights." },
      ],
    },
    laundry: {
      placeholder:
        "Example: Bright modern laundry room with fresh paint, clean cabinetry tone, and updated lighting. Keep layout the same.",
      keywords: {
        floor: /(floor|tile|flooring)/,
        walls: /(wall|paint|color)/,
        cabinets: /(cabinet|cabinets)/,
        lighting: /(light|lighting|fixture)/,
        exterior: /(siding|trim|roof|door|curb|landscape)/,
      },
      extras: [
        { key: "lighting", label: "Update lighting", help: "Cleaner brighter fixture." },
      ],
    },
    office: {
      placeholder:
        "Example: Modern home office with neutral walls, brighter lighting, and a cohesive floor tone. Keep layout the same.",
      keywords: {
        floor: /(floor|flooring|lvp|hardwood|carpet)/,
        walls: /(wall|paint|color)/,
        cabinets: /(built-in|shelf|cabinet)/,
        lighting: /(light|lighting|fixture)/,
        exterior: /(siding|trim|roof|door|curb|landscape)/,
      },
      extras: [
        { key: "lighting", label: "Update lighting", help: "Cleaner brighter lighting." },
        { key: "decor", label: "Modernize details", help: "Tasteful styling touches." },
      ],
    },

    front_of_house: {
      placeholder:
        "Example: Modern curb appeal. Fresh siding/paint, crisp trim, a bold front door color, improved lighting, and greener landscaping. Keep structure the same.",
      keywords: {
        floor: /(driveway|pavers|concrete|walkway)/,
        walls: /(siding|paint|color|brick|stucco)/,
        cabinets: /(door|garage|shutter)/,
        lighting: /(light|lighting|sconce)/,
        exterior: /(siding|trim|roof|door|landscape|curb|lawn)/,
      },
      extras: [
        { key: "lighting", label: "Update exterior lighting", help: "Modern sconces / fixtures." },
        { key: "landscaping", label: "Beautify lawn & landscaping", help: "Greener grass, tidy beds, fresh plants." },
      ],
    },
    back_of_house: {
      placeholder:
        "Example: Upgrade the backyard view with fresher paint/trim, improved lighting, and cleaner landscaping. Keep structure the same.",
      keywords: {
        floor: /(patio|deck|concrete|pavers)/,
        walls: /(siding|paint|color|brick|stucco)/,
        cabinets: /(door|fence|gate)/,
        lighting: /(light|lighting|string|sconce)/,
        exterior: /(siding|trim|roof|door|landscape|yard|deck|patio)/,
      },
      extras: [
        { key: "lighting", label: "Update exterior lighting", help: "Cleaner, brighter outdoor lighting." },
        { key: "landscaping", label: "Beautify yard", help: "Greener grass + tidy landscaping." },
      ],
    },
    side_of_house: {
      placeholder:
        "Example: Freshen this side of the home with updated siding/paint, crisp trim, and improved landscaping. Keep structure the same.",
      keywords: {
        floor: /(walkway|gravel|concrete)/,
        walls: /(siding|paint|color|brick|stucco)/,
        cabinets: /(door|gate|fence)/,
        lighting: /(light|lighting|sconce)/,
        exterior: /(siding|trim|roof|door|landscape)/,
      },
      extras: [
        { key: "landscaping", label: "Beautify landscaping", help: "Greener grass + tidy beds." },
      ],
    },
    porch: {
      placeholder:
        "Example: Modern porch with fresh paint/trim, updated lighting, and improved curb appeal. Keep structure the same.",
      keywords: {
        floor: /(porch|floor|deck|wood|concrete)/,
        walls: /(paint|color|siding|trim)/,
        cabinets: /(door|railing)/,
        lighting: /(light|lighting|sconce)/,
        exterior: /(porch|door|trim|siding|landscape)/,
      },
      extras: [
        { key: "lighting", label: "Update lighting", help: "Modern porch light." },
        { key: "landscaping", label: "Beautify landscaping", help: "Tidy + fresh plants." },
      ],
    },
    deck: {
      placeholder:
        "Example: Refresh this deck/patio with a cleaner stain color, improved lighting, and tidier landscaping. Keep structure the same.",
      keywords: {
        floor: /(deck|patio|wood|stain|pavers)/,
        walls: /(siding|paint|trim)/,
        cabinets: /(railing|fence)/,
        lighting: /(light|lighting|string)/,
        exterior: /(deck|patio|yard|landscape)/,
      },
      extras: [
        { key: "landscaping", label: "Beautify yard", help: "Greener grass + tidy landscaping." },
      ],
    },
    patio: {
      placeholder:
        "Example: Clean modern patio with updated finishes and tidier landscaping. Keep structure the same.",
      keywords: {
        floor: /(patio|pavers|concrete|deck)/,
        walls: /(siding|paint|trim)/,
        cabinets: /(door|fence)/,
        lighting: /(light|lighting|string)/,
        exterior: /(patio|yard|landscape)/,
      },
      extras: [
        { key: "landscaping", label: "Beautify yard", help: "Greener grass + tidy landscaping." },
      ],
    },
    yard: {
      placeholder:
        "Example: Beautify this yard with greener grass, cleaner landscaping beds, and a polished outdoor look.",
      keywords: {
        floor: /(grass|lawn|yard)/,
        walls: /(fence|house|siding)/,
        cabinets: /(fence|gate)/,
        lighting: /(light|lighting)/,
        exterior: /(yard|grass|lawn|landscape)/,
      },
      extras: [
        { key: "landscaping", label: "Beautify lawn & landscaping", help: "Greener grass + tidy beds." },
      ],
    },
    other: {
      placeholder:
        "Example: Modernize this space with fresher colors, improved lighting, and a cohesive premium finish. Keep layout the same.",
      keywords: {
        floor: /(floor|flooring|tile|wood|lvp|carpet)/,
        walls: /(wall|paint|color|siding|trim)/,
        cabinets: /(cabinet|cabinets|built-in|vanity)/,
        lighting: /(light|lighting|fixture)/,
        exterior: /(siding|trim|roof|door|curb|landscape|yard)/,
      },
      extras: [
        { key: "lighting", label: "Update lighting", help: "Cleaner brighter fixture." },
        { key: "decor", label: "Modernize details", help: "Tasteful premium touches." },
        { key: "landscaping", label: "Beautify landscaping", help: "If exterior, greener grass + tidy beds." },
      ],
    },
  };

  return { ...common, ...contexts[sc] };
}

function suggestMissing(prompt: string, subcategory: string | undefined) {
  const p = (prompt || "").toLowerCase();
  const ctx = ctxFromSubcategory(subcategory);
  const missing: string[] = [];

  // For exterior-ish prompts, steer toward siding/trim/door/landscaping.
  const looksExterior = ctx.keywords.exterior.test(p) || ["front_of_house","back_of_house","side_of_house","porch","deck","patio","yard"].includes((subcategory||""));

  const hasFloor = ctx.keywords.floor.test(p);
  const hasWall = ctx.keywords.walls.test(p);
  const hasCab = ctx.keywords.cabinets.test(p);
  const hasLight = ctx.keywords.lighting.test(p);

  if (looksExterior) {
    if (!hasWall) missing.push("Siding / paint");
    if (!hasLight) missing.push("Exterior lighting");
    if (!/(trim)/.test(p)) missing.push("Trim color");
    if (!/(door)/.test(p)) missing.push("Door color");
    if (!/(landscape|lawn|yard|grass|plants|garden)/.test(p)) missing.push("Landscaping");
    return missing;
  }

  if (!hasWall) missing.push("Wall color");
  if (!hasFloor) missing.push("Flooring");
  if (!hasCab) missing.push("Cabinets / built-ins");
  if (!hasLight) missing.push("Lighting");
  if (!/(counter|countertop|backsplash|tile)/.test(p) && subcategory === "kitchen") missing.push("Countertops / backsplash");

  return missing;
}

export default function PromptPage() {
  const router = useRouter();
  const { s, setUserPrompt, setExtras, setPromptedSrc } = useWizard();
  const [loading, setLoading] = useState(false);
  const [loadingMsg, setLoadingMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  // Keep latest overlay state available inside async flows.
  // Pin generics to avoid TS inferring a narrower literal union.
  const overlayStatusRef = useRef<typeof s.overlayStatus>(s.overlayStatus);
  const overlayProgressRef = useRef<number>(s.overlayProgress);
  useEffect(() => {
    overlayStatusRef.current = s.overlayStatus;
    overlayProgressRef.current = s.overlayProgress;
  }, [s.overlayStatus, s.overlayProgress]);

  const subcategory = s.sceneGraph?.meta?.subcategory;
  const ctx = useMemo(() => ctxFromSubcategory(subcategory), [subcategory]);
  const missing = useMemo(() => suggestMissing(s.userPrompt || "", subcategory), [s.userPrompt, subcategory]);

  const canNext = !!s.beforeSrc && !!s.scanId;

  async function generatePromptedAndContinue() {
    if (!canNext || loading) return;
    setErr(null);
    setLoading(true);
    setLoadingMsg("Generating your baseline remodel…");
    try {
      const res = await fetch("/api/prompt-image", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ scanId: s.scanId, userPrompt: s.userPrompt, extras: s.extras || {} }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || data?.message || "Failed to generate prompted image");

      const b64 = data?.imageBase64 as string | undefined;
      if (!b64) throw new Error("Prompted image generation returned no image");

      setPromptedSrc(`data:image/png;base64,${b64}`);

      // If overlays are still building, give them a short head start so the build page feels instant.
      if (overlayStatusRef.current !== "ready") {
        setLoadingMsg(
          `Preparing instant options… ${Math.round((overlayProgressRef.current || 0) * 100)}%`
        );
        const start = Date.now();
        const maxWaitMs = 8000;
        while (overlayStatusRef.current !== "ready" && Date.now() - start < maxWaitMs) {
          await new Promise((r) => setTimeout(r, 250));
          setLoadingMsg(
            `Preparing instant options… ${Math.round((overlayProgressRef.current || 0) * 100)}%`
          );
        }
      }

      router.push("/build");
    } catch (e: any) {
      setErr(e?.message ?? "Failed to generate prompted image");
    } finally {
      setLoading(false);
      setLoadingMsg(null);
    }
  }

  return (
    <div style={{ minHeight: "100vh", padding: "28px 16px", display: "grid", placeItems: "center" }}>
      <div className="kv-card kv-surface kv-app-card" style={{ width: "min(900px, 100%)", padding: 20 }}>
        <div className="kv-headline" style={{ fontSize: 22, fontWeight: 900 }}>
          {ctx.title}
        </div>
        <div style={{ opacity: 0.85, marginTop: 8 }}>{ctx.helper}</div>

        {subcategory ? (
          <div style={{ opacity: 0.75, marginTop: 8, fontSize: 12 }}>
            Detected: <b>{subcategory.replaceAll("_", " ")}</b>
          </div>
        ) : null}

        {s.scanStatus === "ready" ? (
          <div style={{ opacity: 0.75, marginTop: 6, fontSize: 12 }}>
            Instant options: {s.overlayStatus === "ready" ? "Ready ✓" : s.overlayStatus === "building" ? `Preparing… ${Math.round((s.overlayProgress || 0) * 100)}%` : s.overlayStatus === "error" ? `Error: ${s.overlayError || "failed"}` : "Queued"}
          </div>
        ) : null}

        <div style={{ marginTop: 16 }}>
          <textarea
            className="kv-input"
            value={s.userPrompt}
            onChange={(e) => setUserPrompt(e.target.value)}
            placeholder={ctx.placeholder}
            rows={5}
            style={{ width: "100%", resize: "vertical", padding: 12 }}
            disabled={loading}
          />
        </div>

        {missing.length ? (
          <div
            style={{ marginTop: 12, padding: 12, borderRadius: 12, background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.10)" }}
          >
            <div style={{ fontWeight: 800 }}>Suggestions</div>
            <div style={{ opacity: 0.85, marginTop: 6, fontSize: 13 }}>
              You didn’t mention: <b>{missing.join(", ")}</b>. (No worries — you can pick these in the builder.)
            </div>
          </div>
        ) : null}

        <div style={{ marginTop: 16, borderTop: "1px solid rgba(255,255,255,0.10)", paddingTop: 14 }}>
          <div style={{ fontWeight: 900 }}>Optional upgrades</div>
          <div style={{ opacity: 0.8, marginTop: 6, fontSize: 13 }}>
            Check anything you want us to include in your **prompted baseline** and the final photoreal remodel.
          </div>

          <div style={{ marginTop: 10, display: "grid", gap: 10 }}>
            {ctx.extras.map((x) => {
              const checked = !!s.extras?.[x.key];
              return (
                <label
                  key={x.key}
                  style={{ display: "flex", gap: 10, alignItems: "flex-start", cursor: "pointer", padding: 10, borderRadius: 12, border: "1px solid rgba(255,255,255,0.10)", background: "rgba(0,0,0,0.18)" }}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={(e) => {
                      setExtras({ ...(s.extras || {}), [x.key]: e.target.checked });
                    }}
                    style={{ marginTop: 2 }}
                    disabled={loading}
                  />
                  <div>
                    <div style={{ fontWeight: 800 }}>{x.label}</div>
                    <div style={{ opacity: 0.78, fontSize: 12, marginTop: 2 }}>{x.help}</div>
                  </div>
                </label>
              );
            })}
          </div>
        </div>

        {err ? (
          <div style={{ marginTop: 12, padding: 12, borderRadius: 12, background: "rgba(255,0,0,0.10)", border: "1px solid rgba(255,0,0,0.25)" }}>
            <div style={{ fontWeight: 900 }}>Error</div>
            <div style={{ opacity: 0.9, marginTop: 6 }}>{err}</div>
          </div>
        ) : null}

        <div style={{ marginTop: 16, display: "flex", gap: 12, justifyContent: "space-between", flexWrap: "wrap" }}>
          <button className="kv-btn-secondary" onClick={() => router.push("/contact")} disabled={loading}>
            Back
          </button>
          <button className="kv-btn" onClick={generatePromptedAndContinue} disabled={!canNext || loading}>
            {loading ? "Generating your remodel…" : "Build my remodel"}
          </button>
        </div>

        {loading ? (
          <div style={{ marginTop: 14, opacity: 0.85, fontSize: 13 }}>
            {loadingMsg || "Preparing your baseline remodel and options…"}
          </div>
        ) : null}
      </div>
    </div>
  );
}
