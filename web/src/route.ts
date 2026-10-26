import { useCallback, useEffect, useState } from "react";

/** Each customer's case lives at /accounts/:accountNumber; the account number is the main ID on screen. */
export const accountHref = (accountNumber: string) => `/accounts/${encodeURIComponent(accountNumber)}`;

/** The account number in an /accounts/:accountNumber path, or null for any other path. Old /visual links (the
 * at-a-glance page, now the case page itself) still work. */
export function accountFromPath(path: string): string | null {
  const m = /^\/accounts\/([^/]+)(?:\/visual)?\/?$/.exec(path);
  if (!m) return null;
  try { return decodeURIComponent(m[1]!); } catch { return null; }
}

/** The account number in an /accounts/:accountNumber/predictions path, or null. */
export function predictionsAccountFromPath(path: string): string | null {
  const m = /^\/accounts\/([^/]+)\/predictions\/?$/.exec(path);
  if (!m) return null;
  try { return decodeURIComponent(m[1]!); } catch { return null; }
}

/** True for clicks that should keep the browser's own behaviour (new tab, new window, download). */
export function isModifiedClick(e: { metaKey: boolean; ctrlKey: boolean; shiftKey: boolean; altKey: boolean; button: number }): boolean {
  return e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0;
}

export type Page = "outlook" | "classic" | "climate" | "areamap" | "insights" | "funnel" | "queue" | "case" | "admin" | "data" | "priority" | "casepage" | "riskmodel" | "outlookmodel" | "predictions";

/** The home page is the classic outlook; the grouped support workspace is the new outlook. */
export const QUEUE_PATH = "/queue";
export const FUNNEL_PATH = "/funnel";
export const CLIMATE_PATH = "/climate";
export const AREA_MAP_PATH = "/area-map";
export const INSIGHTS_PATH = "/insights";
/** The classic outlook (act-now and watch list) is the home page. */
export const CLASSIC_OUTLOOK_PATH = "/";
/** The grouped support workspace. */
export const NEW_OUTLOOK_PATH = "/outlook/new";

/** Behind-the-scenes pages, under the BTS menu. */
export const FLOWCHART_PATH = "/bts/flowchart";
export const DATA_SOURCES_PATH = "/bts/data-sources";
export const PRIORITY_MODEL_PATH = "/bts/priority-model";
export const CASE_PAGE_PATH = "/bts/case-page";
export const RISK_MODEL_PATH = "/bts/risk-model";
export const OUTLOOK_MODEL_PATH = "/bts/weather-outlook";

export function pageFromPath(path: string): Page {
  if (/^\/(bts\/flowchart|flowchart|admin)\/?$/.test(path)) return "admin"; // the Flowchart page; old /flowchart and /admin links still work
  if (/^\/bts\/data-sources\/?$/.test(path)) return "data";
  if (/^\/bts\/priority-model\/?$/.test(path)) return "priority";
  if (/^\/bts\/case-page\/?$/.test(path)) return "casepage";
  if (/^\/bts\/risk-model\/?$/.test(path)) return "riskmodel";
  if (/^\/bts\/weather-outlook\/?$/.test(path)) return "outlookmodel";
  if (predictionsAccountFromPath(path)) return "predictions";
  if (/^\/funnel\/?$/.test(path)) return "funnel";
  if (/^\/climate\/?$/.test(path)) return "climate";
  if (/^\/area-map\/?$/.test(path)) return "areamap";
  if (/^\/insights\/?$/.test(path)) return "insights";
  if (/^\/outlook\/new\/?$/.test(path)) return "outlook";
  if (accountFromPath(path)) return "case";
  return /^\/queue\/?$/.test(path) ? "queue" : "classic"; // "/", the old /outlook/classic link and anything unknown
}

/** Minimal path router: the classic outlook lives at "/", the queue at "/queue", each case at "/accounts/:accountNumber" and the BTS pages under "/bts/". */
export function useRoute() {
  const [path, setPath] = useState(() => window.location.pathname);
  useEffect(() => {
    const onPop = () => setPath(window.location.pathname);
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);
  const navigate = useCallback((to: string) => {
    if (to !== window.location.pathname) window.history.pushState(null, "", to);
    setPath(window.location.pathname);
    window.scrollTo(0, 0);
  }, []);
  return { accountNumber: accountFromPath(path), predictionsAccount: predictionsAccountFromPath(path), page: pageFromPath(path), navigate };
}
