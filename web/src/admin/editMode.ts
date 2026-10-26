import { useEffect, useState } from "react";

/** The flowchart opens view only. Edit mode is switched on in the demo settings, per browser. */
const KEY = "flow-edit-mode";
const EVENT = "flow-edit-mode-change";

export const readEditMode = (): boolean => { try { return localStorage.getItem(KEY) === "on"; } catch { return false; } };
export function setEditMode(on: boolean): void {
  try { localStorage.setItem(KEY, on ? "on" : "off"); } catch { /* per-browser preference only */ }
  window.dispatchEvent(new CustomEvent(EVENT, { detail: on }));
}
export function useEditMode(): boolean {
  const [on, setOn] = useState(readEditMode);
  useEffect(() => {
    const change = () => setOn(readEditMode());
    window.addEventListener(EVENT, change);
    window.addEventListener("storage", change);
    return () => { window.removeEventListener(EVENT, change); window.removeEventListener("storage", change); };
  }, []);
  return on;
}
