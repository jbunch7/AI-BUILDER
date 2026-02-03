"use client";

import React, { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

type Stage = "scan" | "prompt" | "build";

export default function TransitionPage() {
  const router = useRouter();
  const params = useSearchParams();

  const to = params.get("to") || "/upload";
  const stage = (params.get("stage") || "scan") as Stage;

  const [tick, setTick] = useState(0);

  const copy = useMemo(() => {
    if (stage === "prompt") {
      return {
        title: "Warming up your design assistant…",
        subtitle: "We’re identifying the room and preparing smart suggestions.",
      };
    }
    if (stage === "build") {
      return {
        title: "Preparing your live remodel builder…",
        subtitle: "Loading instant options so you can mix and match in real time.",
      };
    }
    return {
      title: "Analyzing your photo…",
      subtitle: "Mapping surfaces with precision for a fast live preview.",
    };
  }, [stage]);

  useEffect(() => {
    // 3-second interstitial (requested) to smooth navigation and buy time for background tasks.
    const start = Date.now();
    const t = setInterval(() => setTick((v) => v + 1), 200);
    const go = setTimeout(() => {
      // Defensive: avoid infinite loop if someone passes /transition as target
      router.replace(to.startsWith("/transition") ? "/upload" : to);
    }, 3000);

    return () => {
      clearInterval(t);
      clearTimeout(go);
    };
  }, [router, to]);

  // Simple animated dots (no %)
  const dots = ".".repeat(((tick / 2) | 0) % 4);

  return (
    <div style={{ minHeight: "100vh", padding: "28px 16px", display: "grid", placeItems: "center" }}>
      <div className="kv-card kv-surface kv-app-card" style={{ width: "min(900px, 100%)", padding: 22 }}>
        <div className="kv-headline" style={{ fontSize: 22, fontWeight: 900 }}>
          {copy.title}
        </div>
        <div style={{ opacity: 0.86, marginTop: 8 }}>{copy.subtitle}</div>

        <div style={{ marginTop: 18, display: "flex", alignItems: "center", gap: 12 }}>
          <div
            style={{
              height: 44,
              width: 44,
              borderRadius: 999,
              border: "3px solid rgba(255,255,255,0.18)",
              borderTopColor: "rgba(212,175,55,0.95)",
              animation: "kv-spin 1s linear infinite",
            }}
          />
          <div style={{ opacity: 0.88, fontSize: 14 }}>Loading{dots}</div>
        </div>

        <div style={{ marginTop: 16, opacity: 0.7, fontSize: 12 }}>
          Tip: This is a short transition screen so background processing can keep running.
        </div>
      </div>
    </div>
  );
}
