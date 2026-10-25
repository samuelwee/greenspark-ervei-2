// Utility hardship flow: signals -> circumstances -> solutions.
// This module is the single definition of the JSON document, what a valid edit is, and how to undo it.
// The API applies edits to the file with it and the Flowchart page applies the same edits locally.
//
// Links are stored in two directions in the JSON file. The circumstance is the source of truth:
//   circumstance.signals   [{ id, strength }]   (signal -> circumstance)
//   circumstance.solutions [id]                 (circumstance -> solution)
// signal.points_to, solution.used_for and meta.counts are rebuilt from those after every edit,
// so the two directions can never drift apart.

export type FlowKind = "signal" | "circumstance" | "solution";
export type Strength = "strong" | "supporting";
export type Sensitivity = "standard" | "sensitive" | "safety";

export interface FlowLink { id: string; strength: Strength }

export interface FlowSignal {
  id: string; name: string; source: string; detect: string; example_rule: string;
  utilities: string[]; sensitive: boolean; points_to: FlowLink[];
}
export interface FlowCircumstance {
  id: string; name: string; type: string; category: string; description: string;
  utilities: string[]; sensitivity: Sensitivity; handling: string | null;
  signals: FlowLink[]; solutions: string[];
}
export interface FlowSolution {
  id: string; name: string; type: string; utilities: string[]; provider: string; how_to_access: string;
  contact: string; key_facts: string; source_url: string | null; verified: boolean; last_verified: string | null;
  used_for: string[];
}
export interface FlowScoring { flag_when: string; sensitive_rule: string; strong: string; supporting: string; safety_rule: string }
export interface FlowMeta {
  title: string; region: string; utilities: string[]; last_verified: string; flow: string; how_it_works: string;
  scoring: FlowScoring; guardrails: string[];
  counts: { signals: number; circumstances: number; solutions: number; links: number };
}
export interface FlowCircumstanceType { id: string; name: string; meaning: string; who_acts: string }
export interface FlowCategory { id: string; name: string }
export interface FlowDoc {
  meta: FlowMeta;
  circumstance_types: FlowCircumstanceType[];
  categories: FlowCategory[];
  signals: FlowSignal[];
  circumstances: FlowCircumstance[];
  solutions: FlowSolution[];
}

export type FlowEntity = FlowSignal | FlowCircumstance | FlowSolution;

export const SIGNAL_SOURCES = ["account", "self_report", "weather", "area"] as const;
export const SENSITIVITIES: Sensitivity[] = ["standard", "sensitive", "safety"];
export const STRENGTHS: Strength[] = ["strong", "supporting"];

export const EDITABLE_FIELDS: Record<FlowKind, string[]> = {
  signal: ["name", "source", "detect", "example_rule", "utilities", "sensitive"],
  circumstance: ["name", "type", "category", "description", "utilities", "sensitivity", "handling"],
  solution: ["name", "type", "utilities", "provider", "how_to_access", "contact", "key_facts", "source_url", "verified", "last_verified"],
};

export type MetaPatch = Partial<Pick<FlowMeta, "title" | "region" | "flow" | "how_it_works" | "last_verified" | "guardrails">> & {
  scoring?: Partial<FlowScoring>;
};

export type FlowOp =
  | { type: "addEntity"; kind: FlowKind; entity: Record<string, unknown>; index?: number }
  | { type: "updateEntity"; kind: FlowKind; id: string; patch: Record<string, unknown> }
  | { type: "deleteEntity"; kind: FlowKind; id: string }
  | { type: "setLink"; signalId: string; circumstanceId: string; strength: Strength }
  | { type: "removeSignalLink"; signalId: string; circumstanceId: string }
  | { type: "addSolutionLink"; circumstanceId: string; solutionId: string }
  | { type: "removeSolutionLink"; circumstanceId: string; solutionId: string }
  | { type: "updateMeta"; patch: MetaPatch }
  | { type: "upsertCategory"; category: FlowCategory; index?: number }
  | { type: "deleteCategory"; id: string }
  | { type: "upsertCircumstanceType"; item: FlowCircumstanceType; index?: number }
  | { type: "deleteCircumstanceType"; id: string }
  | { type: "batch"; ops: FlowOp[] };

export class FlowError extends Error {
  constructor(message: string, readonly details: string[] = []) {
    super(message);
    this.name = "FlowError";
  }
}

const ID_PATTERN = /^[a-z0-9][a-z0-9_]{1,63}$/;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
export const MAX_ENTITIES = 2000;
const MAX_BATCH = 200;

// ---------- small helpers ----------

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const clone = <T,>(v: T): T => structuredClone(v);

function listFor(doc: FlowDoc, kind: FlowKind): FlowEntity[] {
  return kind === "signal" ? doc.signals : kind === "circumstance" ? doc.circumstances : doc.solutions;
}

export function findEntity(doc: FlowDoc, kind: FlowKind, id: string): FlowEntity | undefined {
  return listFor(doc, kind).find((e) => e.id === id);
}

function kindOfId(doc: FlowDoc, id: string): FlowKind | null {
  if (doc.signals.some((s) => s.id === id)) return "signal";
  if (doc.circumstances.some((c) => c.id === id)) return "circumstance";
  if (doc.solutions.some((s) => s.id === id)) return "solution";
  return null;
}

/** A readable, unique id from a name, such as "Bill overdue" -> "bill_overdue". */
export function slugId(name: string, taken: Set<string>, prefix = ""): string {
  const base = (prefix + name).toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 56) || "item";
  let id = base.length < 2 ? `${base}_1` : base;
  for (let n = 2; taken.has(id); n++) id = `${base}_${n}`.slice(0, 64);
  return id;
}

// ---------- field validation ----------

function text(v: unknown, field: string, opts: { max?: number; required?: boolean } = {}): string {
  if (v === undefined) v = "";
  if (typeof v !== "string") throw new FlowError(`${field} must be text.`);
  const t = v.trim();
  if (opts.required && !t) throw new FlowError(`${field} can't be empty.`);
  const max = opts.max ?? 2000;
  if (t.length > max) throw new FlowError(`${field} is too long (the limit is ${max} characters).`);
  return t;
}

function oneOf<T extends string>(v: unknown, allowed: readonly T[], field: string): T {
  if (typeof v !== "string" || !allowed.includes(v as T)) throw new FlowError(`${field} must be one of: ${allowed.join(", ")}.`);
  return v as T;
}

function utilitiesValue(doc: FlowDoc, v: unknown): string[] {
  if (!Array.isArray(v) || v.some((u) => typeof u !== "string")) throw new FlowError("utilities must be a list.");
  const set = new Set(v as string[]);
  for (const u of set) if (!doc.meta.utilities.includes(u)) throw new FlowError(`Unknown utility "${u}". Use: ${doc.meta.utilities.join(", ")}.`);
  if (set.size === 0) throw new FlowError("Choose at least one utility.");
  return doc.meta.utilities.filter((u) => set.has(u)); // keep the file's order
}

function dateValue(v: unknown, field: string, allowNull: boolean): string | null {
  if (v === null || v === "") {
    if (allowNull) return null;
    throw new FlowError(`${field} can't be empty.`);
  }
  if (typeof v !== "string" || !DATE_PATTERN.test(v) || Number.isNaN(Date.parse(`${v}T00:00:00Z`))) throw new FlowError(`${field} must be a date like 2026-10-19.`);
  return v;
}

/** A web address, or null for "no link" (an empty box is stored as null, as in the file). */
function urlValue(v: unknown): string | null {
  if (v === null) return null;
  const t = text(v, "source_url", { max: 500 });
  if (!t) return null;
  let url: URL;
  try { url = new URL(t); } catch { throw new FlowError("source_url must be a web address starting with http:// or https://."); }
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new FlowError("source_url must start with http:// or https://.");
  return t;
}

/** Validates and normalises one field of an entity. Returns the value to store. */
function fieldValue(doc: FlowDoc, kind: FlowKind, field: string, v: unknown): unknown {
  switch (field) {
    case "name": return text(v, "name", { required: true, max: 200 });
    case "utilities": return utilitiesValue(doc, v);
    case "source": return oneOf(v, SIGNAL_SOURCES, "source");
    case "detect": return text(v, "detect");
    case "example_rule": return text(v, "example_rule", { max: 500 });
    case "sensitive": if (typeof v !== "boolean") throw new FlowError("sensitive must be true or false."); return v;
    case "type":
      if (kind === "circumstance") {
        const t = text(v, "type", { required: true, max: 64 });
        if (!doc.circumstance_types.some((x) => x.id === t)) throw new FlowError(`Unknown circumstance type "${t}".`);
        return t;
      }
      return text(v, "type", { required: true, max: 100 });
    case "category": {
      const c = text(v, "category", { required: true, max: 64 });
      if (!doc.categories.some((x) => x.id === c)) throw new FlowError(`Unknown category "${c}".`);
      return c;
    }
    case "description": return text(v, "description");
    case "sensitivity": return oneOf(v, SENSITIVITIES, "sensitivity");
    case "handling": { if (v === null) return null; const t = text(v, "handling"); return t || null; }
    case "provider": return text(v, "provider", { max: 300 });
    case "how_to_access": return text(v, "how_to_access");
    case "contact": return text(v, "contact", { max: 500 });
    case "key_facts": return text(v, "key_facts");
    case "source_url": return urlValue(v);
    case "verified": if (typeof v !== "boolean") throw new FlowError("verified must be true or false."); return v;
    case "last_verified": return dateValue(v, "last_verified", true);
    default: throw new FlowError(`"${field}" can't be edited.`);
  }
}

function newEntity(doc: FlowDoc, kind: FlowKind, raw: Record<string, unknown>): FlowEntity {
  const id = text(raw.id, "id", { required: true, max: 64 });
  if (!ID_PATTERN.test(id)) throw new FlowError("id must be 2–64 characters: lowercase letters, numbers and underscores.");
  if (kindOfId(doc, id)) throw new FlowError(`The id "${id}" is already used.`);
  const allowed = new Set([...EDITABLE_FIELDS[kind], "id", kind === "signal" ? "points_to" : kind === "solution" ? "used_for" : "signals", "solutions"]);
  for (const k of Object.keys(raw)) if (!allowed.has(k)) throw new FlowError(`"${k}" isn't a field of a ${kind}.`);
  const v = (field: string, fallback: unknown) => fieldValue(doc, kind, field, raw[field] === undefined ? fallback : raw[field]);
  if (kind === "signal") {
    return { id, name: v("name", undefined) as string, source: v("source", "account") as string, detect: v("detect", "") as string, example_rule: v("example_rule", "") as string, utilities: v("utilities", doc.meta.utilities) as string[], sensitive: v("sensitive", false) as boolean, points_to: [] };
  }
  if (kind === "circumstance") {
    return {
      id, name: v("name", undefined) as string, type: v("type", doc.circumstance_types[0]?.id) as string, category: v("category", doc.categories[0]?.id) as string,
      description: v("description", "") as string, utilities: v("utilities", doc.meta.utilities) as string[], sensitivity: v("sensitivity", "standard") as Sensitivity,
      handling: v("handling", null) as string | null, signals: [], solutions: [],
    };
  }
  return {
    id, name: v("name", undefined) as string, type: v("type", "Referral") as string, utilities: v("utilities", doc.meta.utilities) as string[], provider: v("provider", "") as string,
    how_to_access: v("how_to_access", "") as string, contact: v("contact", "") as string, key_facts: v("key_facts", "") as string, source_url: v("source_url", null) as string | null,
    verified: v("verified", false) as boolean, last_verified: v("last_verified", null) as string | null, used_for: [],
  };
}

// ---------- normalising and validating the document ----------

/** Rebuilds the derived link lists and counts from the circumstances. Mutates and returns the document. */
export function normalizeDoc(doc: FlowDoc): FlowDoc {
  const signalIds = new Set(doc.signals.map((s) => s.id));
  const solutionIds = new Set(doc.solutions.map((s) => s.id));
  const fromSignals = new Map<string, FlowLink[]>();
  const fromSolutions = new Map<string, string[]>();
  for (const c of doc.circumstances) {
    const seen = new Set<string>();
    c.signals = (c.signals ?? []).filter((l) => signalIds.has(l.id) && !seen.has(l.id) && seen.add(l.id));
    const seenSol = new Set<string>();
    c.solutions = (c.solutions ?? []).filter((id) => solutionIds.has(id) && !seenSol.has(id) && seenSol.add(id));
    for (const l of c.signals) fromSignals.set(l.id, [...(fromSignals.get(l.id) ?? []), { id: c.id, strength: l.strength }]);
    for (const id of c.solutions) fromSolutions.set(id, [...(fromSolutions.get(id) ?? []), c.id]);
  }
  // Keep each derived list in its existing order where possible, so saving doesn't reshuffle the file.
  for (const s of doc.signals) {
    const fresh = fromSignals.get(s.id) ?? [];
    const byId = new Map(fresh.map((l) => [l.id, l]));
    const kept = (s.points_to ?? []).filter((l) => byId.has(l.id)).map((l) => byId.get(l.id)!);
    const keptIds = new Set(kept.map((l) => l.id));
    s.points_to = [...kept.filter((l, i) => kept.findIndex((k) => k.id === l.id) === i), ...fresh.filter((l) => !keptIds.has(l.id))];
  }
  for (const s of doc.solutions) {
    const fresh = fromSolutions.get(s.id) ?? [];
    const set = new Set(fresh);
    const kept = (s.used_for ?? []).filter((id, i, a) => set.has(id) && a.indexOf(id) === i);
    s.used_for = [...kept, ...fresh.filter((id) => !kept.includes(id))];
  }
  const links = doc.circumstances.reduce((n, c) => n + c.signals.length + c.solutions.length, 0);
  doc.meta.counts = { signals: doc.signals.length, circumstances: doc.circumstances.length, solutions: doc.solutions.length, links };
  return doc;
}

/** Problems that make the document unsafe to edit. An empty list means it is fine. */
export function validateDoc(raw: unknown): string[] {
  const problems: string[] = [];
  if (!isObject(raw)) return ["The file is not a JSON object."];
  for (const key of ["signals", "circumstances", "solutions", "categories", "circumstance_types"]) {
    if (!Array.isArray(raw[key])) problems.push(`"${key}" is missing or not a list.`);
  }
  if (!isObject(raw.meta)) problems.push('"meta" is missing.');
  else if (!Array.isArray(raw.meta.utilities)) problems.push('"meta.utilities" is missing.');
  if (problems.length) return problems;
  const doc = raw as unknown as FlowDoc;
  const ids = new Map<string, FlowKind>();
  const register = (kind: FlowKind, list: unknown[]) => {
    list.forEach((e, i) => {
      if (!isObject(e) || typeof e.id !== "string" || !e.id) { problems.push(`A ${kind} (number ${i + 1}) has no id.`); return; }
      if (typeof e.name !== "string" || !e.name.trim()) problems.push(`${kind} "${e.id}" has no name.`);
      if (ids.has(e.id)) problems.push(`The id "${e.id}" is used more than once.`);
      ids.set(e.id, kind);
    });
  };
  register("signal", doc.signals); register("circumstance", doc.circumstances); register("solution", doc.solutions);
  if (problems.length) return problems;
  const categories = new Set(doc.categories.map((c) => c.id));
  const types = new Set(doc.circumstance_types.map((t) => t.id));
  for (const c of doc.circumstances) {
    if (!categories.has(c.category)) problems.push(`Circumstance "${c.id}" uses an unknown category "${c.category}".`);
    if (!types.has(c.type)) problems.push(`Circumstance "${c.id}" uses an unknown type "${c.type}".`);
    if (!SENSITIVITIES.includes(c.sensitivity)) problems.push(`Circumstance "${c.id}" has an unknown sensitivity "${c.sensitivity}".`);
    if (!Array.isArray(c.signals) || !Array.isArray(c.solutions)) { problems.push(`Circumstance "${c.id}" needs "signals" and "solutions" lists.`); continue; }
    for (const l of c.signals) {
      if (ids.get(l.id) !== "signal") problems.push(`Circumstance "${c.id}" links to "${l.id}", which is not a signal.`);
      if (!STRENGTHS.includes(l.strength)) problems.push(`The link from "${l.id}" to "${c.id}" has an unknown strength "${l.strength}".`);
    }
    for (const id of c.solutions) if (ids.get(id) !== "solution") problems.push(`Circumstance "${c.id}" links to "${id}", which is not a solution.`);
  }
  for (const s of doc.signals) if (!SIGNAL_SOURCES.includes(s.source as (typeof SIGNAL_SOURCES)[number])) problems.push(`Signal "${s.id}" has an unknown source "${s.source}".`);
  return problems.slice(0, 50);
}

// ---------- applying edits (with the matching undo) ----------

export interface Applied { doc: FlowDoc; inverse: FlowOp }

const NOOP: FlowOp = { type: "batch", ops: [] };

function requireEntity(doc: FlowDoc, kind: FlowKind, id: string): FlowEntity {
  const e = findEntity(doc, kind, id);
  if (!e) throw new FlowError(`There is no ${kind} with the id "${id}".`);
  return e;
}

/** Applies one edit to a copy of the document. Throws FlowError if it isn't valid. */
export function applyWithInverse(input: FlowDoc, op: FlowOp): Applied {
  const doc = clone(input);
  const inverse = apply(doc, op);
  normalizeDoc(doc);
  return { doc, inverse };
}

export function applyOp(doc: FlowDoc, op: FlowOp): FlowDoc {
  return applyWithInverse(doc, op).doc;
}

function apply(doc: FlowDoc, op: FlowOp): FlowOp {
  switch (op.type) {
    case "addEntity": {
      if (doc.signals.length + doc.circumstances.length + doc.solutions.length >= MAX_ENTITIES) throw new FlowError("This flow has reached its size limit.");
      const entity = newEntity(doc, op.kind, op.entity);
      const raw = op.entity;
      const list = listFor(doc, op.kind);
      const at = op.index === undefined ? list.length : Math.max(0, Math.min(list.length, Math.trunc(op.index)));
      // Initial links, written in the circumstance (the source of truth).
      if (op.kind === "circumstance") {
        const c = entity as FlowCircumstance;
        for (const l of (Array.isArray(raw.signals) ? raw.signals : []) as FlowLink[]) {
          if (!findEntity(doc, "signal", l.id)) throw new FlowError(`There is no signal "${l.id}".`);
          oneOf(l.strength, STRENGTHS, "strength");
          c.signals.push({ id: l.id, strength: l.strength });
        }
        for (const id of (Array.isArray(raw.solutions) ? raw.solutions : []) as string[]) {
          if (!findEntity(doc, "solution", id)) throw new FlowError(`There is no solution "${id}".`);
          c.solutions.push(id);
        }
      }
      list.splice(at, 0, entity as never);
      if (op.kind === "signal") {
        for (const l of (Array.isArray(raw.points_to) ? raw.points_to : []) as FlowLink[]) {
          const c = requireEntity(doc, "circumstance", l.id) as FlowCircumstance;
          c.signals.push({ id: entity.id, strength: oneOf(l.strength, STRENGTHS, "strength") });
        }
      }
      if (op.kind === "solution") {
        for (const id of (Array.isArray(raw.used_for) ? raw.used_for : []) as string[]) (requireEntity(doc, "circumstance", id) as FlowCircumstance).solutions.push(entity.id);
      }
      return { type: "deleteEntity", kind: op.kind, id: entity.id };
    }

    case "updateEntity": {
      const e = requireEntity(doc, op.kind, op.id) as unknown as Record<string, unknown>;
      if (!isObject(op.patch) || Object.keys(op.patch).length === 0) throw new FlowError("There is nothing to change.");
      const old: Record<string, unknown> = {};
      for (const [field, value] of Object.entries(op.patch)) {
        if (!EDITABLE_FIELDS[op.kind].includes(field)) throw new FlowError(`"${field}" can't be edited on a ${op.kind}.`);
        const next = fieldValue(doc, op.kind, field, value);
        old[field] = clone(e[field]);
        e[field] = next;
      }
      return { type: "updateEntity", kind: op.kind, id: op.id, patch: old };
    }

    case "deleteEntity": {
      const list = listFor(doc, op.kind);
      const index = list.findIndex((e) => e.id === op.id);
      if (index < 0) throw new FlowError(`There is no ${op.kind} with the id "${op.id}".`);
      const removed = clone(list[index]!);
      const restore: FlowOp[] = [];
      if (op.kind === "signal") {
        for (const c of doc.circumstances) {
          const link = c.signals.find((l) => l.id === op.id);
          if (link) { restore.push({ type: "setLink", signalId: op.id, circumstanceId: c.id, strength: link.strength }); c.signals = c.signals.filter((l) => l.id !== op.id); }
        }
        const { points_to: _derived, ...entity } = removed as FlowSignal;
        void _derived;
        list.splice(index, 1);
        return { type: "batch", ops: [{ type: "addEntity", kind: "signal", entity, index }, ...restore] };
      }
      if (op.kind === "solution") {
        for (const c of doc.circumstances) {
          if (c.solutions.includes(op.id)) { restore.push({ type: "addSolutionLink", circumstanceId: c.id, solutionId: op.id }); c.solutions = c.solutions.filter((id) => id !== op.id); }
        }
        const { used_for: _derived, ...entity } = removed as FlowSolution;
        void _derived;
        list.splice(index, 1);
        return { type: "batch", ops: [{ type: "addEntity", kind: "solution", entity, index }, ...restore] };
      }
      list.splice(index, 1);
      return { type: "addEntity", kind: "circumstance", entity: removed as unknown as Record<string, unknown>, index }; // carries its own links
    }

    case "setLink": {
      requireEntity(doc, "signal", op.signalId);
      const c = requireEntity(doc, "circumstance", op.circumstanceId) as FlowCircumstance;
      const strength = oneOf(op.strength, STRENGTHS, "strength");
      const existing = c.signals.find((l) => l.id === op.signalId);
      if (!existing) { c.signals.push({ id: op.signalId, strength }); return { type: "removeSignalLink", signalId: op.signalId, circumstanceId: c.id }; }
      if (existing.strength === strength) return NOOP;
      const before = existing.strength;
      existing.strength = strength;
      return { type: "setLink", signalId: op.signalId, circumstanceId: c.id, strength: before };
    }
    case "removeSignalLink": {
      const c = requireEntity(doc, "circumstance", op.circumstanceId) as FlowCircumstance;
      const existing = c.signals.find((l) => l.id === op.signalId);
      if (!existing) return NOOP;
      c.signals = c.signals.filter((l) => l.id !== op.signalId);
      return { type: "setLink", signalId: op.signalId, circumstanceId: c.id, strength: existing.strength };
    }
    case "addSolutionLink": {
      requireEntity(doc, "solution", op.solutionId);
      const c = requireEntity(doc, "circumstance", op.circumstanceId) as FlowCircumstance;
      if (c.solutions.includes(op.solutionId)) return NOOP;
      c.solutions.push(op.solutionId);
      return { type: "removeSolutionLink", circumstanceId: c.id, solutionId: op.solutionId };
    }
    case "removeSolutionLink": {
      const c = requireEntity(doc, "circumstance", op.circumstanceId) as FlowCircumstance;
      if (!c.solutions.includes(op.solutionId)) return NOOP;
      c.solutions = c.solutions.filter((id) => id !== op.solutionId);
      return { type: "addSolutionLink", circumstanceId: c.id, solutionId: op.solutionId };
    }

    case "updateMeta": {
      const patch = op.patch;
      if (!isObject(patch) || Object.keys(patch).length === 0) throw new FlowError("There is nothing to change.");
      const old: MetaPatch = {};
      const meta = doc.meta;
      for (const [key, value] of Object.entries(patch)) {
        switch (key) {
          case "title": old.title = meta.title; meta.title = text(value, "title", { required: true, max: 200 }); break;
          case "region": old.region = meta.region; meta.region = text(value, "region", { required: true, max: 200 }); break;
          case "flow": old.flow = meta.flow; meta.flow = text(value, "flow", { required: true, max: 200 }); break;
          case "how_it_works": old.how_it_works = meta.how_it_works; meta.how_it_works = text(value, "how_it_works"); break;
          case "last_verified": old.last_verified = meta.last_verified; meta.last_verified = dateValue(value, "last_verified", false)!; break;
          case "guardrails": {
            if (!Array.isArray(value) || value.length > 50) throw new FlowError("guardrails must be a list of at most 50 items.");
            old.guardrails = clone(meta.guardrails);
            meta.guardrails = (value as unknown[]).map((g, i) => text(g, `Guardrail ${i + 1}`, { required: true, max: 1000 }));
            break;
          }
          case "scoring": {
            if (!isObject(value)) throw new FlowError("scoring must be an object.");
            old.scoring = {};
            for (const [k, v] of Object.entries(value)) {
              if (!["flag_when", "sensitive_rule", "strong", "supporting", "safety_rule"].includes(k)) throw new FlowError(`"${k}" isn't a scoring field.`);
              (old.scoring as Record<string, string>)[k] = meta.scoring[k as keyof FlowScoring];
              meta.scoring[k as keyof FlowScoring] = text(v, `scoring.${k}`, { required: true });
            }
            break;
          }
          default: throw new FlowError(`"${key}" can't be edited in the settings.`);
        }
      }
      return { type: "updateMeta", patch: old };
    }

    case "upsertCategory": {
      const id = text(op.category?.id, "id", { required: true, max: 64 });
      if (!ID_PATTERN.test(id)) throw new FlowError("id must be 2–64 characters: lowercase letters, numbers and underscores.");
      const name = text(op.category?.name, "name", { required: true, max: 200 });
      const index = doc.categories.findIndex((c) => c.id === id);
      if (index >= 0) { const old = clone(doc.categories[index]!); doc.categories[index] = { ...doc.categories[index]!, name }; return { type: "upsertCategory", category: old }; }
      doc.categories.splice(op.index === undefined ? doc.categories.length : Math.max(0, Math.min(doc.categories.length, Math.trunc(op.index))), 0, { id, name });
      return { type: "deleteCategory", id };
    }
    case "deleteCategory": {
      const index = doc.categories.findIndex((c) => c.id === op.id);
      if (index < 0) throw new FlowError(`There is no category "${op.id}".`);
      const used = doc.circumstances.filter((c) => c.category === op.id).length;
      if (used) throw new FlowError(`${used} circumstance${used === 1 ? " uses" : "s use"} this category. Move ${used === 1 ? "it" : "them"} to another category first.`);
      const old = clone(doc.categories[index]!);
      doc.categories.splice(index, 1);
      return { type: "upsertCategory", category: old, index };
    }
    case "upsertCircumstanceType": {
      const id = text(op.item?.id, "id", { required: true, max: 64 });
      if (!ID_PATTERN.test(id)) throw new FlowError("id must be 2–64 characters: lowercase letters, numbers and underscores.");
      const item = { id, name: text(op.item?.name, "name", { required: true, max: 200 }), meaning: text(op.item?.meaning, "meaning"), who_acts: text(op.item?.who_acts, "who_acts") };
      const index = doc.circumstance_types.findIndex((t) => t.id === id);
      if (index >= 0) { const old = clone(doc.circumstance_types[index]!); doc.circumstance_types[index] = item; return { type: "upsertCircumstanceType", item: old }; }
      doc.circumstance_types.splice(op.index === undefined ? doc.circumstance_types.length : Math.max(0, Math.min(doc.circumstance_types.length, Math.trunc(op.index))), 0, item);
      return { type: "deleteCircumstanceType", id };
    }
    case "deleteCircumstanceType": {
      const index = doc.circumstance_types.findIndex((t) => t.id === op.id);
      if (index < 0) throw new FlowError(`There is no circumstance type "${op.id}".`);
      const used = doc.circumstances.filter((c) => c.type === op.id).length;
      if (used) throw new FlowError(`${used} circumstance${used === 1 ? " uses" : "s use"} this type. Move ${used === 1 ? "it" : "them"} to another type first.`);
      const old = clone(doc.circumstance_types[index]!);
      doc.circumstance_types.splice(index, 1);
      return { type: "upsertCircumstanceType", item: old, index };
    }

    case "batch": {
      if (!Array.isArray(op.ops) || op.ops.length > MAX_BATCH) throw new FlowError(`A batch can hold at most ${MAX_BATCH} edits.`);
      const inverses: FlowOp[] = [];
      for (const sub of op.ops) {
        normalizeDoc(doc);
        inverses.unshift(apply(doc, sub));
      }
      return { type: "batch", ops: inverses };
    }

    default:
      throw new FlowError("That edit isn't recognised.");
  }
}

/** Checks the shape of an edit received over the network before it is applied. Semantics are checked by applyOp. */
export function parseOp(raw: unknown, depth = 0): FlowOp {
  if (!isObject(raw) || typeof raw.type !== "string") throw new FlowError("Each edit needs a type.");
  const str = (k: string) => { if (typeof raw[k] !== "string") throw new FlowError(`${raw.type}: "${k}" must be text.`); return raw[k] as string; };
  const kind = (): FlowKind => oneOf(raw.kind, ["signal", "circumstance", "solution"] as const, "kind");
  switch (raw.type) {
    case "addEntity": {
      if (!isObject(raw.entity)) throw new FlowError("addEntity needs an entity.");
      return { type: "addEntity", kind: kind(), entity: raw.entity, ...(typeof raw.index === "number" ? { index: raw.index } : {}) };
    }
    case "updateEntity": {
      if (!isObject(raw.patch)) throw new FlowError("updateEntity needs a patch.");
      return { type: "updateEntity", kind: kind(), id: str("id"), patch: raw.patch };
    }
    case "deleteEntity": return { type: "deleteEntity", kind: kind(), id: str("id") };
    case "setLink": return { type: "setLink", signalId: str("signalId"), circumstanceId: str("circumstanceId"), strength: oneOf(raw.strength, STRENGTHS, "strength") };
    case "removeSignalLink": return { type: "removeSignalLink", signalId: str("signalId"), circumstanceId: str("circumstanceId") };
    case "addSolutionLink": return { type: "addSolutionLink", circumstanceId: str("circumstanceId"), solutionId: str("solutionId") };
    case "removeSolutionLink": return { type: "removeSolutionLink", circumstanceId: str("circumstanceId"), solutionId: str("solutionId") };
    case "updateMeta": {
      if (!isObject(raw.patch)) throw new FlowError("updateMeta needs a patch.");
      return { type: "updateMeta", patch: raw.patch as MetaPatch };
    }
    case "upsertCategory": {
      if (!isObject(raw.category)) throw new FlowError("upsertCategory needs a category.");
      return { type: "upsertCategory", category: raw.category as unknown as FlowCategory, ...(typeof raw.index === "number" ? { index: raw.index } : {}) };
    }
    case "deleteCategory": return { type: "deleteCategory", id: str("id") };
    case "upsertCircumstanceType": {
      if (!isObject(raw.item)) throw new FlowError("upsertCircumstanceType needs an item.");
      return { type: "upsertCircumstanceType", item: raw.item as unknown as FlowCircumstanceType, ...(typeof raw.index === "number" ? { index: raw.index } : {}) };
    }
    case "deleteCircumstanceType": return { type: "deleteCircumstanceType", id: str("id") };
    case "batch": {
      if (depth >= 1) throw new FlowError("Batches can't be nested.");
      if (!Array.isArray(raw.ops) || raw.ops.length > MAX_BATCH) throw new FlowError(`A batch can hold at most ${MAX_BATCH} edits.`);
      return { type: "batch", ops: raw.ops.map((o) => parseOp(o, depth + 1)) };
    }
    default: throw new FlowError(`"${raw.type}" isn't a recognised edit.`);
  }
}

/** True when an inverse does nothing, so it shouldn't be put on an undo stack. */
export const isNoop = (op: FlowOp) => op.type === "batch" && op.ops.length === 0;
