"use client";

import React, { useMemo } from "react";
import { useRouter } from "next/navigation";
import { useWizard } from "../providers";

function suggestMissing(prompt: string) {
  const p = prompt.toLowerCase();
  const missing: string[] = [];
  const hasFloor = /(floor|flooring|lvp|hardwood|tile)/.test(p);
  const hasWall = /(wall|paint|color|colour)/.test(p);
  const hasCab = /(cabinet|cabinets)/.test(p);
  const hasLight = /(light|lighting|fixture|pendant|chandelier)/.test(p);
  const hasBacksplash = /(backsplash|subway|tile)/.test(p);
  if (!hasWall) missing.push("Wall color");
  if (!hasFloor) missing.push("Flooring");
  if (!hasCab) missing.push("Cabinets");
  if (!hasLight) missing.push("Lighting");
  if (!hasBacksplash) missing.push("Backsplash");
  return missing;
}

const EXTRA_LIST: Array<{ key: string; label: string; help: string }> = [
  { key: "updateAppliances", label: "Update appliances", help: "Modernize range, dishwasher, and finishes." },
  { key: "updateLightFixtures", label: "Update light fixtures", help: "Swap fixtures where appropriate." },
  { key: "addBacksplash", label: "Add / update backsplash", help: "Refresh backsplash tile for kitchens." },
  { key: "updateCountertops", label: "Update countertops", help: "Suggest quartz/granite style upgrades." },
  { key: "updateHardware", label: "Update cabinet hardware", help: "New pulls/knobs that match the style." },
  { key: "addGarden", label: "Add garden / curb appeal", help: "Exterior only: tidy beds, fresh plants, greener grass." },
];

export default function PromptPage() {
  const router = useRouter();
  const { s, setUserPrompt, setExtras } = useWizard();

  const missing = useMemo(() => suggestMissing(s.userPrompt || ""), [s.userPrompt]);

  const canNext = !!s.beforeSrc;

  return (
    <div style={{ minHeight: "100vh", padding: "28px 16px", display: "grid", placeItems: "center" }}>
      <div className="kv-card kv-surface kv-app-card" style={{ width: "min(900px, 100%)", padding: 20 }}>
        <div className="kv-headline" style={{ fontSize: 22, fontWeight: 900 }}>
          Describe your vision
        </div>
        <div style={{ opacity: 0.85, marginTop: 8 }}>
          Tell us the vibe you want. We’ll suggest missing elements and prep options for your live builder.
        </div>

        <div style={{ marginTop: 16 }}>
          <textarea
            className="kv-input"
            value={s.userPrompt}
            onChange={(e) => setUserPrompt(e.target.value)}
            placeholder={
              "Example: Make this kitchen bright and modern with warm white cabinets, a light quartz counter, and dark walnut floors. Keep layout the same."
            }
            rows={5}
            style={{ width: "100%", resize: "vertical", padding: 12 }}
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
            Check anything you want us to include in the final photoreal remodel.
          </div>

          <div style={{ marginTop: 10, display: "grid", gap: 10 }}>
            {EXTRA_LIST.map((x) => {
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

        <div style={{ marginTop: 16, display: "flex", gap: 12, justifyContent: "space-between", flexWrap: "wrap" }}>
          <button className="kv-btn-secondary" onClick={() => router.push("/contact")}>Back</button>
          <button className="kv-btn" onClick={() => router.push("/build")} disabled={!canNext}>
            Build my remodel
          </button>
        </div>
      </div>
    </div>
  );
}
