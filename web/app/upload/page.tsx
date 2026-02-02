"use client";

import React, { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useWizard } from "../providers";

async function fileToDataUrl(file: File): Promise<string> {
  return await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("Failed to read file"));
    reader.readAsDataURL(file);
  });
}

export default function UploadPage() {
  const router = useRouter();
  const { s, resetAll, setBeforeSrc, setPromptedSrc, startScan } = useWizard();
  const [localFile, setLocalFile] = useState<File | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);

  // If a session exists, keep it. User can reset.
  useEffect(() => {
    setLocalError(null);
  }, [s.sessionId]);

  const onPick = async (f: File) => {
    setLocalError(null);
    setLocalFile(f);
    const dataUrl = await fileToDataUrl(f);
    setBeforeSrc(dataUrl);
    setPromptedSrc(null);
    // Start scanning immediately to buy time while user proceeds through wizard.
    void startScan(f);
  };

  const canNext = !!s.beforeSrc;

  return (
    <div style={{ minHeight: "100vh", padding: "28px 16px", display: "grid", placeItems: "center" }}>
      <div className="kv-card kv-surface kv-app-card" style={{ width: "min(900px, 100%)", padding: 20 }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
          <div>
            <div className="kv-headline" style={{ fontSize: 24, fontWeight: 900 }}>
              Upload your photo
            </div>
            <div style={{ opacity: 0.85, marginTop: 8 }}>
              We’ll map your space in the background so your live preview feels instant.
            </div>
          </div>
          <button className="kv-btn-secondary" onClick={resetAll}>
            Reset
          </button>
        </div>

        {localError ? (
          <div
            style={{ marginTop: 14, padding: 12, borderRadius: 12, background: "rgba(255,0,0,0.10)", border: "1px solid rgba(255,0,0,0.25)" }}
          >
            {localError}
          </div>
        ) : null}

        <div style={{ marginTop: 16, display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
          <input
            className="kv-input"
            type="file"
            accept="image/*"
            onChange={(e) => {
              const f = e.target.files?.[0] || null;
              if (!f) return;
              void onPick(f).catch((err) => setLocalError(err?.message ?? "Failed to load image"));
            }}
            style={{ maxWidth: 460 }}
          />
          <button
            className="kv-btn"
            onClick={() => router.push("/contact")}
            disabled={!canNext}
            title={!canNext ? "Upload a photo first" : "Continue"}
          >
            Next
          </button>
          <div style={{ opacity: 0.8, fontSize: 13 }}>
            {s.scanStatus === "scanning" ? "Scanning in background…" : s.scanStatus === "ready" ? "Scan ready ✓" : ""}
          </div>
        </div>

        {s.beforeSrc ? (
          <div style={{ marginTop: 16, borderRadius: 16, overflow: "hidden", border: "1px solid rgba(255,255,255,0.10)" }}>
            <img src={s.beforeSrc} alt="Uploaded" style={{ width: "100%", display: "block" }} />
          </div>
        ) : (
          <div style={{ marginTop: 16, padding: 18, borderRadius: 16, border: "1px dashed rgba(255,255,255,0.14)", opacity: 0.8 }}>
            Tip: use a well-lit, wide photo. Don’t worry if it’s imperfect — we’ll enhance it.
          </div>
        )}
      </div>
    </div>
  );
}
