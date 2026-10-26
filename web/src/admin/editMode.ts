import { useEffect, useState } from "react";

/**
 * The flowchart has three modes, set in the demo settings and kept per browser:
 *   demo: view only, a clean presentation with one example path highlighted (the default)
 *   view: view only, with the search, filters and detail panel
 *   edit: everything, including changing the flowchart
 */
export type FlowMode = "demo" | "view" | "edit";
export const FLOW_MODES: { id: FlowMode; label: string }[] = [{ id: "demo", label: "Demo" }, { id: "view", label: "View only" }, { id: "edit", label: "Edit" }];
const KEY = "flow-mode";
const OLD_KEY = "flow-edit-mode";
const EVENT = "flow-mode-change";

export function readFlowMode(): FlowMode {
  try {
    const v = localStorage.getItem(KEY);
    if (v === "demo" || v === "view" || v === "edit") return v;
    return localStorage.getItem(OLD_KEY) === "on" ? "edit" : "demo";
  } catch { return "demo"; }
}
export function setFlowMode(mode: FlowMode): void {
  try { localStorage.setItem(KEY, mode); } catch { /* per-browser preference only */ }
  window.dispatchEvent(new CustomEvent(EVENT, { detail: mode }));
}
export function useFlowMode(): FlowMode {
  const [mode, setMode] = useState(readFlowMode);
  useEffect(() => {
    const change = () => setMode(readFlowMode());
    window.addEventListener(EVENT, change);
    window.addEventListener("storage", change);
    return () => { window.removeEventListener(EVENT, change); window.removeEventListener("storage", change); };
  }, []);
  return mode;
}
