// One-paragraph AI summaries drafted by Claude or Google Gemini (see AiConfig) for two parts of a case:
//   support: the plan from the flagged circumstances (Support areas and why), plus the order of the
//            Solutions to offer, in one call so the plan and the order agree;
//   signals: what the account signals say together (Account signals).
// Only circumstances, signals, solutions and contact settings are sent: never names or contact details.
import { detectAccountSignals, type WeatherSignal, type CircumstanceDefinition, type Person, type QueueCase, type RecommendationDefinition } from "@greenspark/shared";
import Anthropic from "@anthropic-ai/sdk";
import { ApiError } from "./errors";

/**
 * `order` (support only): every solution id, most important first, each with a short reason, the date to act by
 * (worked out here from the AI's number of working days) and how to contact the customer about it.
 */
export interface PlanStep { id: string; reason: string; due: string; method: Method }
export interface SupportPlan { text: string; model: string; generatedAt: string; order?: PlanStep[]; interpreter?: boolean }

export type Method = "phone" | "sms" | "email" | "letter";
const METHODS: Method[] = ["phone", "sms", "email", "letter"];

/** What the customer's contact settings allow. */
export interface ContactRules { preferred: string; sms: boolean; email: boolean; doNotCall: boolean; interpreter: boolean }
const OPEN: ContactRules = { preferred: "phone", sms: true, email: true, doNotCall: false, interpreter: false };

export const allowedMethods = (r: ContactRules): Method[] =>
  METHODS.filter((m) => (m === "phone" ? !r.doNotCall : m === "sms" ? r.sms : m === "email" ? r.email : true));

/** The AI's method if the settings allow it; otherwise the preferred channel, or a letter. */
export function checkMethod(m: string, r: ContactRules): Method {
  const allowed = allowedMethods(r);
  if (allowed.includes(m as Method)) return m as Method;
  const preferred = (r.preferred === "post" ? "letter" : r.preferred) as Method;
  return allowed.includes(preferred) ? preferred : "letter";
}

/** Today's date in Perth, where the customers are. */
const PERTH_DAY = new Intl.DateTimeFormat("en-CA", { timeZone: "Australia/Perth" });
export const perthToday = (now: Date) => PERTH_DAY.format(now);

/** The date `n` working days after `today` (0 is today, or the next weekday if today is a weekend). */
export function addWorkingDays(today: string, n: number): string {
  const d = new Date(`${today}T00:00:00Z`);
  const weekend = () => d.getUTCDay() === 0 || d.getUTCDay() === 6;
  while (weekend()) d.setUTCDate(d.getUTCDate() + 1);
  for (let left = Math.max(0, Math.min(60, Math.round(n))); left > 0;) {
    d.setUTCDate(d.getUTCDate() + 1);
    if (!weekend()) left--;
  }
  return d.toISOString().slice(0, 10);
}

interface Catalog { circumstances: CircumstanceDefinition[]; recommendations: RecommendationDefinition[]; supportAreas: { id: string; label: string }[] }

export type PlanKind = "support" | "signals";
export const PLAN_KINDS: PlanKind[] = ["support", "signals"];

const COMMON = [
  "You help staff at an Australian electricity retailer support customers who may be in hardship.",
  "Write for the support worker. Use only the facts given; do not invent amounts, dates or programs.",
  "Plain, kind, practical language. Never judge the customer. No headings or lists. Write dates like 10 Oct 2026.",
  "\"Safety\" has one meaning here: a circumstance the facts mark as safety (such as family violence or abuse), which must be passed to trained staff, not handled in the call. " +
    "Never call anything else (weather, health, money or supply problems, or any signal) a safety issue, and don't use the word safety unless a circumstance is marked safety.",
].join(" ");

const TASK: Record<PlanKind, string> = {
  support: "In 60 to 100 words, as 2 or 3 short paragraphs of one or two sentences each, separated by a blank line: what seems to be going on; what to offer first and why; and anything to handle with care. Speak to the worker (\"Start by…\"). " +
    "Describe the situation accurately: if supply is already disconnected, talk about reconnecting, not preventing disconnection. " +
    "Also order EVERY solution id in the list by priority and impact for this customer (stopping harm such as being without power, or circumstances marked safety, first, then the biggest, quickest relief). " +
    "The order must match the summary: anything the summary says to do first or the same day must be near the top. " +
    "Give each a reason of at most 12 words, about THIS customer's circumstances and signals only; never mention eligibility groups or situations from a solution's key facts that the case does not show. " +
    "For each solution also give dueInWorkingDays (0 = today; anything urgent, for a circumstance marked safety, or about being without power is 0) and a sensible sequence " +
    "(for example a grant that needs other options tried first comes after them), and the method to contact the customer about it, " +
    "chosen only from the allowed methods in the facts, preferring their preferred channel unless another suits the step better; use phone for anything due today when phone is allowed. " +
    "Answer as JSON: {\"summary\": string, \"order\": [{\"id\": string, \"reason\": string, \"dueInWorkingDays\": number, \"method\": string}]}.",
  signals: "In ONE short paragraph of 40 to 70 words: summarise what these account signals show together about the customer's situation and which stand out. " +
    "Only describe the signals: give no suggestions, advice, next steps or questions to ask, and do not address the worker.",
};

const ISO = /\b(\d{4})-(\d{2})-(\d{2})\b/g;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const readable = (t: string) => t.replace(ISO, (_m, y: string, mo: string, d: string) => `${Number(d)} ${MONTHS[Number(mo) - 1]} ${y}`);

/** The facts for one kind of summary, as plain text; empty when there is nothing to summarise. */
export function planFacts(kind: PlanKind, c: QueueCase, person: Person | null, cat: Catalog, asOf: string, weather: WeatherSignal[] = []): string {
  if (kind === "signals") {
    const signals = [...(person?.account ? detectAccountSignals(person.account, asOf) : []), ...weather];
    return readable(signals.map((s) => `Signal: ${s.name} — ${s.evidence}`).join("\n"));
  }
  return readable(supportFacts(c, person, cat));
}

function supportFacts(c: QueueCase, person: Person | null, cat: Catalog): string {
  const def = (id: string) => cat.circumstances.find((d) => d.id === id);
  const lines: string[] = [];
  if (c.modelAssessment.priority) lines.push(`Priority: ${c.modelAssessment.priority.score}/100 (${c.modelAssessment.priority.label}), trend ${c.modelAssessment.trend ?? "unknown"}.`);
  for (const x of c.circumstances) {
    const d = def(x.circumstanceId);
    const area = cat.supportAreas.find((a) => a.id === d?.supportAreaId)?.label;
    lines.push(`Circumstance: ${d?.label ?? x.circumstanceId}${area ? ` (${area})` : ""}${d?.sensitivity && d.sensitivity !== "standard" ? `, ${d.sensitivity}` : ""}.`);
    if (d?.handling) lines.push(`  Handling: ${d.handling}`);
    for (const s of x.signals ?? []) lines.push(`  Signal (${s.strength}): ${s.name}${s.evidence ? ` — ${s.evidence}` : ""}`);
  }
  for (const r of c.recommendations) {
    const d = cat.recommendations.find((x) => x.id === r.recommendationId);
    const forNames = r.circumstanceIds.map((id) => def(id)?.label ?? id).join(", ");
    lines.push(`Solution [id ${r.recommendationId}]: ${d?.label ?? r.recommendationId} (for ${forNames})`);
    if (d?.description) lines.push(`  Key facts: ${d.description}`);
    if (d?.howToAccess) lines.push(`  How to access: ${d.howToAccess}`);
    if (r.eligibility) {
      const failed = r.eligibility.criteria.filter((x) => !x.met);
      lines.push(`  HUGS eligibility (from the account): ${failed.length ? `not met — ${failed.map((x) => x.label).join(", ")}` : "met"}`);
    }
  }
  const a = person?.account;
  if (a) {
    const cp = a.contactPreferences;
    lines.push(`Contact: prefers ${cp.preferredChannel}${cp.doNotCall ? ", do not call" : ""}, SMS ${cp.smsOptIn ? "on" : "off"}, email ${cp.emailOptIn ? "on" : "off"}${a.interpreterRequired ? ", interpreter required" : ""}${a.lifeSupport ? ", life support registered" : ""}.`);
  }
  return lines.join("\n");
}

// The same answer shape twice: Gemini uses its own schema dialect, Claude standard JSON Schema.
const ORDER_SCHEMA = {
  type: "OBJECT",
  properties: {
    summary: { type: "STRING" },
    order: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: { id: { type: "STRING" }, reason: { type: "STRING" }, dueInWorkingDays: { type: "INTEGER" }, method: { type: "STRING", enum: METHODS } },
        required: ["id", "reason", "dueInWorkingDays", "method"],
      },
    },
  },
  required: ["summary", "order"],
};

const CLAUDE_ORDER_SCHEMA = {
  type: "object",
  properties: {
    summary: { type: "string" },
    order: {
      type: "array",
      items: {
        type: "object",
        properties: { id: { type: "string" }, reason: { type: "string" }, dueInWorkingDays: { type: "integer" }, method: { type: "string", enum: METHODS } },
        required: ["id", "reason", "dueInWorkingDays", "method"],
        additionalProperties: false,
      },
    },
  },
  required: ["summary", "order"],
  additionalProperties: false,
};

/** Which AI service drafts the summaries, its key and the model for each kind. No key turns the summaries off. */
export interface AiConfig { provider: AiProvider; apiKey: string | null; models: Record<PlanKind, string> }
export type AiProvider = "claude" | "gemini";
const NAMES: Record<AiProvider, string> = { claude: "Claude", gemini: "Gemini" };

/**
 * Asks the configured AI service. Throws an ApiError the page can show when the key is missing or the call fails.
 * For the support plan, `ids` are the case's solutions: the order is kept only if it has exactly those, each once.
 * Dates count from `today` (Perth), and each method is checked against the customer's contact settings.
 */
export async function draftPlan(
  kind: PlanKind, facts: string, ai: AiConfig | null,
  ids: string[] = [], contact: ContactRules = OPEN, today = perthToday(new Date()),
): Promise<SupportPlan> {
  if (!ai?.apiKey) throw new ApiError("unavailable", "AI plans are switched off: no AI API key is set on the server.");
  const name = NAMES[ai.provider];
  const model = ai.models[kind];
  const system = `${COMMON} ${TASK[kind]}`;
  const prompt = kind === "support" ? `${facts}\nAllowed methods: ${allowedMethods(contact).join(", ")}.` : facts;
  const text = await (ai.provider === "claude" ? askClaude : askGemini)(kind, system, prompt, ai.apiKey, model);
  if (!text) throw new ApiError("unavailable", `${name} returned no text.`);
  const generatedAt = new Date().toISOString();
  if (kind !== "support") return { text, model, generatedAt };
  let parsed: { summary?: unknown; order?: { id?: unknown; reason?: unknown; dueInWorkingDays?: unknown; method?: unknown }[] };
  try { parsed = JSON.parse(text); } catch { throw new ApiError("unavailable", `${name}'s answer could not be read.`); }
  if (typeof parsed.summary !== "string" || !parsed.summary.trim()) throw new ApiError("unavailable", `${name} returned no summary.`);
  const order: PlanStep[] = (Array.isArray(parsed.order) ? parsed.order : []).map((o) => ({
    id: String(o.id ?? ""), reason: String(o.reason ?? "").trim(),
    due: addWorkingDays(today, Number(o.dueInWorkingDays) || 0),
    // Same-day (urgent) steps are a phone call whenever calling is allowed, whatever the preferred channel.
    method: (Number(o.dueInWorkingDays) || 0) <= 0 && !contact.doNotCall ? "phone" : checkMethod(String(o.method ?? ""), contact),
  }));
  const valid = order.length === ids.length && new Set(order.map((o) => o.id)).size === ids.length && order.every((o) => ids.includes(o.id));
  return { text: parsed.summary.trim(), model, generatedAt, interpreter: contact.interpreter, ...(valid ? { order } : {}) };
}

/** One plain-text answer from the configured model, for the help chat. */
export async function askModel(ai: AiConfig, system: string, prompt: string): Promise<string> {
  if (!ai.apiKey) throw new ApiError("unavailable", "No AI key is set on the server.");
  const text = await (ai.provider === "claude" ? askClaude : askGemini)("signals", system, prompt, ai.apiKey, ai.models.support);
  if (!text) throw new ApiError("unavailable", "The AI returned no answer. Try again.");
  return text;
}

type Ask = (kind: PlanKind, system: string, prompt: string, apiKey: string, model: string) => Promise<string | undefined>;

/** Anthropic's Claude. The SDK retries a busy (429) or server error (5xx) once by itself. */
const askClaude: Ask = async (kind, system, prompt, apiKey, model) => {
  const client = new Anthropic({ apiKey, timeout: 30_000, maxRetries: 1 });
  let msg: Anthropic.Message;
  try {
    msg = await client.messages.create({
      model, max_tokens: 4000, system, messages: [{ role: "user", content: prompt }],
      // Low effort: short summaries need little thinking, and it keeps answers quick and cheap.
      output_config: { effort: "low", ...(kind === "support" ? { format: { type: "json_schema", schema: CLAUDE_ORDER_SCHEMA } } : {}) },
    });
  } catch (e) {
    if (e instanceof Anthropic.RateLimitError) throw new ApiError("unavailable", "Claude's rate limit was reached. Try again in a minute.");
    if (e instanceof Anthropic.APIConnectionError) throw new ApiError("unavailable", "Could not reach Claude. Try again in a moment.");
    if (e instanceof Anthropic.APIError) throw new ApiError("unavailable", `Claude returned an error (${e.status ?? "no status"}): ${e.message}.`);
    throw e;
  }
  if (msg.stop_reason === "refusal") throw new ApiError("unavailable", "Claude declined to write this summary.");
  if (msg.stop_reason === "max_tokens") throw new ApiError("unavailable", "Claude's answer was cut off. Try again in a moment.");
  return msg.content.map((b) => (b.type === "text" ? b.text : "")).join("").trim();
};

/** Google's Gemini. Its busy (503) and server errors are usually brief: try once more after a short wait. */
const askGemini: Ask = async (kind, system, prompt, apiKey, model) => {
  const call = () => fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": apiKey },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: system }] },
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.3, ...(kind === "support" ? { responseMimeType: "application/json", responseSchema: ORDER_SCHEMA } : {}) },
      }),
      signal: AbortSignal.timeout(30_000),
    });
  let res: Response | null = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    if (attempt) await new Promise((r) => setTimeout(r, 3000));
    try { res = await call(); } catch { res = null; continue; }
    if (res.status < 500) break;
  }
  if (!res) throw new ApiError("unavailable", "Could not reach Gemini. Try again in a moment.");
  if (res.status === 429) throw new ApiError("unavailable", "Gemini's free limit was reached. Try again in a minute.");
  const json = (await res.json().catch(() => null)) as { candidates?: { content?: { parts?: { text?: string }[] } }[]; error?: { message?: string } } | null;
  if (!res.ok) throw new ApiError("unavailable", `Gemini returned an error (${res.status})${json?.error?.message ? `: ${json.error.message}` : ""}.`);
  return json?.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("").trim();
};
