import type { FlowCircumstance, FlowDoc, FlowEntity, FlowKind, FlowSignal, FlowSolution, Strength } from "@greenspark/shared";

export interface Ref { kind: FlowKind; id: string }
export const nodeKey = (kind: FlowKind, id: string) => `${kind}:${id}`;
export const refKey = (r: Ref) => nodeKey(r.kind, r.id);

export const UTILITY_LABEL: Record<string, string> = { electricity: "Electricity", gas: "Gas", water: "Water", telco: "Phone/internet" };
export const UTILITY_LETTER: Record<string, string> = { electricity: "E", gas: "G", water: "W", telco: "P" };
export const KIND_LABEL: Record<FlowKind, string> = { signal: "Signal", circumstance: "Circumstance", solution: "Solution" };
export const SOURCE_LABEL: Record<string, string> = { account: "From account data", self_report: "Asked of the customer", weather: "From weather forecasts", area: "From area statistics" };

export interface LinkRef { from: string; to: string; strength: Strength | null; kind: "signal-circumstance" | "circumstance-solution"; key: string }

export interface FlowIndex {
  signals: Map<string, FlowSignal>;
  circumstances: Map<string, FlowCircumstance>;
  solutions: Map<string, FlowSolution>;
  /** circumstances a signal points to, with the strength of each link */
  circumstancesOfSignal: Map<string, { id: string; strength: Strength }[]>;
  /** circumstances that use a solution */
  circumstancesOfSolution: Map<string, string[]>;
  links: LinkRef[];
}

/** Everything is derived from the circumstances, which are the source of truth for links. */
export function buildIndex(doc: FlowDoc): FlowIndex {
  const idx: FlowIndex = {
    signals: new Map(doc.signals.map((s) => [s.id, s])),
    circumstances: new Map(doc.circumstances.map((c) => [c.id, c])),
    solutions: new Map(doc.solutions.map((s) => [s.id, s])),
    circumstancesOfSignal: new Map(), circumstancesOfSolution: new Map(), links: [],
  };
  for (const c of doc.circumstances) {
    for (const l of c.signals) {
      if (!idx.signals.has(l.id)) continue;
      idx.circumstancesOfSignal.set(l.id, [...(idx.circumstancesOfSignal.get(l.id) ?? []), { id: c.id, strength: l.strength }]);
      idx.links.push({ from: nodeKey("signal", l.id), to: nodeKey("circumstance", c.id), strength: l.strength, kind: "signal-circumstance", key: `s>c:${l.id}>${c.id}` });
    }
    for (const id of c.solutions) {
      if (!idx.solutions.has(id)) continue;
      idx.circumstancesOfSolution.set(id, [...(idx.circumstancesOfSolution.get(id) ?? []), c.id]);
      idx.links.push({ from: nodeKey("circumstance", c.id), to: nodeKey("solution", id), strength: null, kind: "circumstance-solution", key: `c>o:${c.id}>${id}` });
    }
  }
  return idx;
}

export function entityOf(idx: FlowIndex, ref: Ref): FlowEntity | undefined {
  return ref.kind === "signal" ? idx.signals.get(ref.id) : ref.kind === "circumstance" ? idx.circumstances.get(ref.id) : idx.solutions.get(ref.id);
}

export interface Trace { nodes: Set<string>; links: Set<string> }

/** The path through the flow that passes through one node: signal -> circumstance -> solution. */
export function trace(idx: FlowIndex, ref: Ref): Trace {
  const nodes = new Set<string>([refKey(ref)]);
  const links = new Set<string>();
  const addCircumstance = (c: FlowCircumstance, { signals, solutions }: { signals: boolean; solutions: boolean }) => {
    nodes.add(nodeKey("circumstance", c.id));
    if (signals) for (const l of c.signals) if (idx.signals.has(l.id)) { nodes.add(nodeKey("signal", l.id)); links.add(`s>c:${l.id}>${c.id}`); }
    if (solutions) for (const id of c.solutions) if (idx.solutions.has(id)) { nodes.add(nodeKey("solution", id)); links.add(`c>o:${c.id}>${id}`); }
  };
  if (ref.kind === "circumstance") {
    const c = idx.circumstances.get(ref.id);
    if (c) addCircumstance(c, { signals: true, solutions: true });
  } else if (ref.kind === "signal") {
    for (const l of idx.circumstancesOfSignal.get(ref.id) ?? []) {
      const c = idx.circumstances.get(l.id)!;
      links.add(`s>c:${ref.id}>${c.id}`);
      addCircumstance(c, { signals: false, solutions: true });
    }
  } else {
    for (const cid of idx.circumstancesOfSolution.get(ref.id) ?? []) {
      const c = idx.circumstances.get(cid)!;
      links.add(`c>o:${cid}>${ref.id}`);
      addCircumstance(c, { signals: true, solutions: false });
    }
  }
  return trace_clean(nodes, links);
}
const trace_clean = (nodes: Set<string>, links: Set<string>): Trace => ({ nodes, links });

export const appliesTo = (e: { utilities: string[] }, utility: string) => utility === "all" || e.utilities.includes(utility);

export interface Group<T> { id: string; label: string; items: T[] }

export function groupSignals(doc: FlowDoc, utility: string): Group<FlowSignal>[] {
  return ["account", "self_report", "weather", "area"].map((source) => ({ id: source, label: SOURCE_LABEL[source]!, items: doc.signals.filter((s) => s.source === source && appliesTo(s, utility)) })).filter((g) => g.items.length > 0);
}

export function groupCircumstances(doc: FlowDoc, utility: string): Group<FlowCircumstance>[] {
  return doc.categories.map((cat) => ({ id: cat.id, label: cat.name, items: doc.circumstances.filter((c) => c.category === cat.id && appliesTo(c, utility)) })).filter((g) => g.items.length > 0);
}

export function groupSolutions(doc: FlowDoc, utility: string): Group<FlowSolution>[] {
  const types: string[] = [];
  for (const s of doc.solutions) if (!types.includes(s.type)) types.push(s.type);
  return types.map((t) => ({ id: t, label: t, items: doc.solutions.filter((s) => s.type === t && appliesTo(s, utility)) })).filter((g) => g.items.length > 0);
}

export interface SearchHit { ref: Ref; name: string; detail: string }

/** Matches names first, then ids and descriptions. */
export function search(doc: FlowDoc, query: string, limit = 12): SearchHit[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const all: { ref: Ref; name: string; id: string; text: string }[] = [
    ...doc.signals.map((s) => ({ ref: { kind: "signal" as const, id: s.id }, name: s.name, id: s.id, text: s.detect })),
    ...doc.circumstances.map((c) => ({ ref: { kind: "circumstance" as const, id: c.id }, name: c.name, id: c.id, text: c.description })),
    ...doc.solutions.map((s) => ({ ref: { kind: "solution" as const, id: s.id }, name: s.name, id: s.id, text: `${s.provider} ${s.key_facts}` })),
  ];
  const score = (e: (typeof all)[number]) => (e.name.toLowerCase().startsWith(q) ? 0 : e.name.toLowerCase().includes(q) ? 1 : e.id.includes(q) ? 2 : e.text.toLowerCase().includes(q) ? 3 : 9);
  return all.map((e) => ({ e, s: score(e) })).filter((x) => x.s < 9).sort((a, b) => a.s - b.s).slice(0, limit)
    .map(({ e }) => ({ ref: e.ref, name: e.name, detail: KIND_LABEL[e.ref.kind] }));
}
