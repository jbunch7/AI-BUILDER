"use client";

import React from "react";
import { useWizard } from "../providers";

export default function ContactPage() {
  const { s, go } = useWizard();

  const canNext = !!s.beforeSrc;

  return (
    <div style={{ minHeight: "100vh", padding: "28px 16px", display: "grid", placeItems: "center" }}>
      <div className="kv-card kv-surface kv-app-card" style={{ width: "min(900px, 100%)", padding: 20 }}>
        <div className="kv-headline" style={{ fontSize: 22, fontWeight: 900 }}>
          Contact info
        </div>
        <div style={{ opacity: 0.85, marginTop: 8 }}>
          (Verification is disabled for testing.) While you fill this out, we’re preparing your live preview in the background.
        </div>

        <div style={{ marginTop: 14, display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
          <div style={{ opacity: 0.85, fontSize: 13 }}>
            Background status: {s.scanStatus === "ready" ? "Scan ready ✓" : s.scanStatus === "scanning" ? "Scanning…" : s.scanStatus === "error" ? `Error: ${s.scanError}` : "Waiting"}
          </div>
        </div>

        <div style={{ marginTop: 16, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <input className="kv-input" placeholder="First name" disabled />
          <input className="kv-input" placeholder="Last name" disabled />
          <input className="kv-input" placeholder="Email" disabled style={{ gridColumn: "1 / -1" }} />
          <input className="kv-input" placeholder="Phone" disabled style={{ gridColumn: "1 / -1" }} />
        </div>

        <div style={{ marginTop: 16, display: "flex", gap: 12, justifyContent: "space-between", flexWrap: "wrap" }}>
          <button
            className="kv-btn-secondary"
            onClick={() =>
              void go("/upload", { message: "Returning to your photo…", submessage: "", minMs: 3000 })
            }
          >
            Back
          </button>
          <button
            className="kv-btn"
            onClick={() =>
              void go("/prompt", {
                message: "Preparing your prompt…",
                submessage: "We’re finalizing the detected room type and suggestions.",
                minMs: 3000,
              })
            }
            disabled={!canNext}
          >
            Next
          </button>
        </div>
      </div>
    </div>
  );
}
