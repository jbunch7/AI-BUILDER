"use client";

import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { BuilderModule, SceneGraph } from "@/lib/builder/types";

type Extras = Record<string, boolean>;

export type WizardSession = {
  sessionId: string;
  beforeSrc: string | null;
  /** Baseline image generated from the user's initial prompt ("prompted image") */
  promptedSrc: string | null;
  scanId: string | null;
  sceneGraph: SceneGraph | null;
  modules: BuilderModule[];
  selections: Record<string, string>;
  /** Optional per-element mask overrides (PNG data URLs) produced by user edits */
  maskOverrides: Record<string, string>;
  userPrompt: string;
  extras: Extras;
  scanStatus: "idle" | "scanning" | "ready" | "error";
  scanError?: string;
};

const STORAGE_KEY = "kv_builder_wizard_v1";

const defaultSession = (): WizardSession => ({
  sessionId: (globalThis.crypto?.randomUUID?.() ?? String(Date.now())) as string,
  beforeSrc: null,
  promptedSrc: null,
  scanId: null,
  sceneGraph: null,
  modules: [],
  selections: {},
  maskOverrides: {},
  userPrompt: "",
  extras: {},
  scanStatus: "idle",
});

type Ctx = {
  s: WizardSession;
  resetAll: () => void;
  setBeforeSrc: (src: string | null) => void;
  setPromptedSrc: (src: string | null) => void;
  startScan: (file: File) => Promise<void>;
  setUserPrompt: (v: string) => void;
  setExtras: (next: Extras) => void;
  setSelections: (next: Record<string, string>) => void;
  setMaskOverrides: (next: Record<string, string>) => void;
};

const WizardContext = createContext<Ctx | null>(null);

function safeParse<T>(raw: string | null): T | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export function WizardProvider({ children }: { children: React.ReactNode }) {
  const [s, setS] = useState<WizardSession>(() => {
    const existing = safeParse<WizardSession>(typeof window !== "undefined" ? localStorage.getItem(STORAGE_KEY) : null);
    // We don't trust stale scan payloads across deploys, but they help within a session.
    return existing ?? defaultSession();
  });

  const inflightScan = useRef<Promise<void> | null>(null);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
    } catch {
      // ignore quota
    }
  }, [s]);

  const resetAll = useCallback(() => {
    const fresh = defaultSession();
    setS(fresh);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(fresh));
    } catch {}
  }, []);

  const setBeforeSrc = useCallback((src: string | null) => {
    setS((p) => ({ ...p, beforeSrc: src }));
  }, []);

  const setPromptedSrc = useCallback((src: string | null) => {
    setS((p) => ({ ...p, promptedSrc: src }));
  }, []);

  const setUserPrompt = useCallback((v: string) => {
    setS((p) => ({ ...p, userPrompt: v }));
  }, []);

  const setExtras = useCallback((next: Extras) => {
    setS((p) => ({ ...p, extras: next }));
  }, []);

  const setSelections = useCallback((next: Record<string, string>) => {
    setS((p) => ({ ...p, selections: next }));
  }, []);

  const setMaskOverrides = useCallback((next: Record<string, string>) => {
    setS((p) => ({ ...p, maskOverrides: next }));
  }, []);

  const startScan = useCallback(async (file: File) => {
    if (inflightScan.current) return inflightScan.current;

    const run = (async () => {
      setS((p) => ({ ...p, scanStatus: "scanning", scanError: undefined, scanId: null, sceneGraph: null, modules: [], selections: {} }));
      try {
        const fd = new FormData();
        fd.append("image", file);

        const res = await fetch("/api/scan", { method: "POST", body: fd });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data?.error || data?.message || "Scan failed");

        const scanId = data.scanId as string;
        const sceneGraph = data.sceneGraph as SceneGraph;

        // Options (best-effort, but generally required)
        const res2 = await fetch("/api/options", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ scanId }),
        });
        const data2 = await res2.json().catch(() => ({}));
        if (!res2.ok) throw new Error(data2?.error || data2?.message || "Options failed");

        setS((p) => ({
          ...p,
          scanId,
          sceneGraph,
          modules: data2.modules || [],
          selections: data2.defaultSelections || {},
          scanStatus: "ready",
          scanError: undefined,
        }));
      } catch (e: any) {
        setS((p) => ({ ...p, scanStatus: "error", scanError: e?.message ?? "Scan failed" }));
      } finally {
        inflightScan.current = null;
      }
    })();

    inflightScan.current = run;
    return run;
  }, []);

  const value = useMemo<Ctx>(
    () => ({ s, resetAll, setBeforeSrc, setPromptedSrc, startScan, setUserPrompt, setExtras, setSelections, setMaskOverrides }),
    [s, resetAll, setBeforeSrc, setPromptedSrc, startScan, setUserPrompt, setExtras, setSelections, setMaskOverrides]
  );

  return <WizardContext.Provider value={value}>{children}</WizardContext.Provider>;
}

export function useWizard() {
  const ctx = useContext(WizardContext);
  if (!ctx) throw new Error("useWizard must be used within WizardProvider");
  return ctx;
}
