import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { AiConfig, AiProvider } from "./plan";

const root = fileURLToPath(new URL("../../", import.meta.url));

// GREENSPARK_DATASET=all uses the full import (every open account; scripts/generate-all-cases.mts) when its files
// are present, and falls back to the 200 scenario cases otherwise (the files are too big for Git).
const ALL_FIXTURE = `${root}data/synthetic/case-queue.all.json`;
const ALL_ACCOUNTS = `${root}data/synthetic/accounts.all.jsonl`;
const wantAll = process.env.GREENSPARK_DATASET === "all";
const haveAll = existsSync(ALL_FIXTURE) && existsSync(ALL_ACCOUNTS);
if (wantAll && !haveAll) console.warn("GREENSPARK_DATASET=all, but the full import files are missing; using the 200 scenario cases.");
const useAll = wantAll && haveAll;
export const FIXTURE_PATH = process.env.GREENSPARK_FIXTURE ?? (useAll ? ALL_FIXTURE : `${root}data/synthetic/case-queue.v1.json`);
export const DB_PATH = process.env.GREENSPARK_DB ?? `${root}data/runtime/greenspark.sqlite`;
// The utility hardship flow file edited on the Admin page. Changes are written straight back to it.
// Optional JSON Lines file of { personId, account } for a fixture whose accounts are not inline (the full import).
export const ACCOUNTS_PATH = process.env.GREENSPARK_ACCOUNTS || (useAll ? ALL_ACCOUNTS : null);
export const FLOW_FILE = process.env.GREENSPARK_FLOW_FILE ?? `${root}data/admin/utility_hardship_mapping.json`;
export const PORT = Number(process.env.PORT ?? 3001);


// Built web app, served by this process when present (single-process hosting, e.g. Render).
const webDist = process.env.GREENSPARK_WEB_DIST ?? `${root}web/dist`;
export const WEB_DIST = existsSync(`${webDist}/index.html`) ? webDist : null;

// Optional "user:password" gate for shared demo hosting. Unset locally.
export const BASIC_AUTH = process.env.GREENSPARK_BASIC_AUTH || null;

// The AI summaries on each case: Claude (Anthropic) or Gemini (Google). AI_PROVIDER picks one; unset, Claude is used
// when ANTHROPIC_API_KEY is set, otherwise Gemini. The chosen service's key unset: the summaries are switched off.
const provider: AiProvider = process.env.AI_PROVIDER === "gemini" || (process.env.AI_PROVIDER !== "claude" && !process.env.ANTHROPIC_API_KEY)
  ? "gemini" : "claude";
export const AI: AiConfig = provider === "claude"
  ? {
    provider,
    apiKey: process.env.ANTHROPIC_API_KEY || null,
    // Haiku: fast and the cheapest Claude model, plenty for one-paragraph summaries. CLAUDE_MODEL / CLAUDE_SIGNALS_MODEL override it.
    models: { support: process.env.CLAUDE_MODEL || "claude-haiku-5-5", signals: process.env.CLAUDE_SIGNALS_MODEL || "claude-haiku-5-5" },
  }
  : {
    provider,
    apiKey: process.env.GEMINI_API_KEY || null,
    // Flash-Lite for both: it is far less often overloaded than Flash. GEMINI_MODEL / GEMINI_SIGNALS_MODEL override it.
    models: { support: process.env.GEMINI_MODEL || "gemini-flash-lite-latest", signals: process.env.GEMINI_SIGNALS_MODEL || "gemini-flash-lite-latest" },
  };

// Weather signals: "demo" (the default) uses a built-in sample heatwave, "live" fetches Bureau of Meteorology
// forecasts hourly, "off" turns them off. This is the mode at start-up; it can be switched on the Data sources page.
export const WEATHER_MODE = (["live", "demo", "off"].includes(process.env.WEATHER_MODE ?? "") ? process.env.WEATHER_MODE : "demo") as "live" | "demo" | "off";

// The 90-day risk model and its scores, from scripts/train-risk-model.mts. Missing files turn predictions off.
export const RISK_MODEL_PATH = process.env.GREENSPARK_RISK_MODEL ?? `${root}data/models/risk-model.v1.json`;
export const CLIMATE_PATH = process.env.GREENSPARK_CLIMATE ?? `${root}data/climate/heat-by-postcode.v1.json`;
export const PREDICTIONS_PATH = process.env.GREENSPARK_PREDICTIONS ?? `${root}data/synthetic/predictions.v1.json`;

// Both services' keys, so the demo settings can switch the AI model while the server runs.
export const AI_KEYS: Partial<Record<AiProvider, string>> = {
  ...(process.env.ANTHROPIC_API_KEY ? { claude: process.env.ANTHROPIC_API_KEY } : {}),
  ...(process.env.GEMINI_API_KEY ? { gemini: process.env.GEMINI_API_KEY } : {}),
};
