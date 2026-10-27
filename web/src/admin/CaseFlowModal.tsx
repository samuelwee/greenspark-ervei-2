import { useEffect, useMemo, useRef, useState } from "react";
import { caseSignals, type FlowDoc, type Person, type QueueCase, type WeatherSignal } from "@greenspark/shared";
import type { ApiClient, Catalog } from "../data/api";
import { readableDates } from "../domain/format";
import { FlowBoard } from "./FlowBoard";
import { DATA_SOURCE_GROUPS } from "./dataSources";
import { SOURCE_LABEL, buildIndex, nodeKey, trace as traceOf, type FlowIndex, type Ref, type Trace } from "./flowModel";
import "./admin.css";

interface Props { client: ApiClient; data: Catalog; c: QueueCase; person: Person | null; weather: WeatherSignal[]; onClose: () => void }

/** One case's path through the flowchart: the signals seen, the circumstances flagged and the solutions offered. */
function casePath(c: QueueCase, person: Person | null, data: Catalog, doc: FlowDoc, index: FlowIndex, weather: WeatherSignal[]) {
  const seen = new Map(caseSignals(c, person, data, doc, weather).map((s) => [s.id, s]));
  const flagged = new Map(c.circumstances.map((x) => [x.circumstanceId, x]));
  const offered = new Map(c.recommendations.map((r) => [r.recommendationId, r]));
  const nodes = new Set<string>();
  const links = new Set<string>();
  for (const id of seen.keys()) if (index.signals.has(id)) nodes.add(nodeKey("signal", id));
  for (const x of c.circumstances) {
    nodes.add(nodeKey("circumstance", x.circumstanceId));
    for (const s of x.signals ?? []) links.add(`s>c:${s.id}>${x.circumstanceId}`);
  }
  for (const r of c.recommendations) {
    nodes.add(nodeKey("solution", r.recommendationId));
    for (const cid of r.circumstanceIds) links.add(`c>o:${cid}>${r.recommendationId}`);
  }
  return { seen, flagged, offered, trace: { nodes, links } satisfies Trace };
}

type Path = ReturnType<typeof casePath>;

function Panel({ refr, path, index, onSelect }: { refr: Ref | null; path: Path; index: FlowIndex; onSelect: (r: Ref | null) => void }) {
  const signalName = (id: string) => index.signals.get(id)?.name ?? id;
  const circName = (id: string) => index.circumstances.get(id)?.name ?? id;
  const solName = (id: string) => index.solutions.get(id)?.name ?? id;
  const pick = (kind: Ref["kind"], id: string, label: string) => <button type="button" className="linkish" onClick={() => onSelect({ kind, id })}>{label}</button>;

  if (!refr) {
    return (
      <>
        <h3>This case’s path</h3>
        <p className="hint">These are the boxes on this case’s path. Click any box to highlight its links and see its details.</p>
        <p className="block-label">Signals seen <span className="pill">{path.seen.size}</span></p>
        {path.seen.size ? (
          <ul className="plain cf-list">
            {[...path.seen.values()].map((s) => <li key={s.id}>{pick("signal", s.id, s.name)}<span className="sub">{readableDates(s.evidence)}</span></li>)}
          </ul>
        ) : <p className="muted">No signals.</p>}
        <p className="block-label">Circumstances flagged <span className="pill">{path.flagged.size}</span></p>
        {path.flagged.size ? <ul className="plain cf-list">{[...path.flagged.keys()].map((id) => <li key={id}>{pick("circumstance", id, circName(id))}</li>)}</ul> : <p className="muted">None flagged.</p>}
        <p className="block-label">Solutions to offer <span className="pill">{path.offered.size}</span></p>
        {path.offered.size ? <ul className="plain cf-list">{[...path.offered.keys()].map((id) => <li key={id}>{pick("solution", id, solName(id))}</li>)}</ul> : <p className="muted">None.</p>}
      </>
    );
  }

  const back = <button type="button" className="btn btn-small" onClick={() => onSelect(null)}>Back to this case’s path</button>;

  if (refr.kind === "signal") {
    const def = index.signals.get(refr.id);
    const s = path.seen.get(refr.id);
    const targets = index.circumstancesOfSignal.get(refr.id) ?? [];
    const flaggedTargets = targets.filter((t) => path.flagged.has(t.id));
    return (
      <>
        {back}
        <p className="kind">Signal · {def ? SOURCE_LABEL[def.source] ?? def.source : ""}</p>
        <h3>{signalName(refr.id)}</h3>
        <p className={s ? "cf-yes" : "cf-no"}>{s ? "Seen for this case" : "Not seen for this case"}</p>
        {s ? <p>{readableDates(s.evidence)}</p> : null}
        {def?.detect ? <p className="hint">{def.detect}</p> : null}
        {flaggedTargets.length ? <p className="block-label">Points to</p> : null}
        <ul className="plain cf-list">
          {flaggedTargets.map((t) => (
            <li key={t.id}>{pick("circumstance", t.id, circName(t.id))} <span className="sub">{t.strength === "strong" ? "Strong" : "Supporting"} · flagged for this case</span></li>
          ))}
        </ul>
      </>
    );
  }

  if (refr.kind === "circumstance") {
    const def = index.circumstances.get(refr.id);
    const x = path.flagged.get(refr.id);
    const links = def?.signals ?? [];
    // Area signals never count towards flagging (see evaluateCase), so they are left out of the count.
    const seenLinks = links.filter((l) => path.seen.has(l.id) && path.seen.get(l.id)!.source !== "area");
    const strong = seenLinks.filter((l) => l.strength === "strong").length;
    return (
      <>
        {back}
        <p className="kind">Circumstance{def && def.sensitivity !== "standard" ? ` · ${def.sensitivity === "safety" ? "Safety" : "Sensitive"}` : ""}</p>
        <h3>{circName(refr.id)}</h3>
        <p className={x ? "cf-yes" : "cf-no"}>
          {x ? "Flagged for this case" : "Not flagged for this case"}: {strong} strong and {seenLinks.length - strong} supporting signal{seenLinks.length - strong === 1 ? "" : "s"} seen.
          {" "}{def?.sensitivity === "standard" ? "Needs 1 strong or 2 supporting." : "Needs a strong signal."}
        </p>
        <p className="block-label">Signals</p>
        {/* Only the signals seen for this case: the ones that were not seen are left out. */}
        {links.some((l) => path.seen.has(l.id)) ? (
          <ul className="plain cf-list">
            {links.filter((l) => path.seen.has(l.id)).map((l) => <li key={l.id}>{pick("signal", l.id, signalName(l.id))} <span className="sub">{l.strength === "strong" ? "Strong" : "Supporting"} · {readableDates(path.seen.get(l.id)!.evidence)}</span></li>)}
          </ul>
        ) : <p className="muted">None seen.</p>}
        <p className="block-label">Solutions</p>
        <ul className="plain cf-list">{(def?.solutions ?? []).map((id) => <li key={id}>{pick("solution", id, solName(id))}</li>)}</ul>
      </>
    );
  }

  const def = index.solutions.get(refr.id);
  const r = path.offered.get(refr.id);
  return (
    <>
      {back}
      <p className="kind">Solution · {def?.type}</p>
      <h3>{solName(refr.id)}</h3>
      <p className={r ? "cf-yes" : "cf-no"}>{r ? "Offered for this case" : "Not offered for this case"}</p>
      {r ? <><p className="block-label">Because of</p><ul className="plain cf-list">{r.circumstanceIds.map((id) => <li key={id}>{pick("circumstance", id, circName(id))}</li>)}</ul></> : null}
      {def?.provider ? <><p className="block-label">Who</p><p>{def.provider}</p></> : null}
      {def?.how_to_access ? <><p className="block-label">What to do</p><p>{def.how_to_access}</p></> : null}
      {def?.key_facts ? <><p className="block-label">Good to know</p><p>{def.key_facts}</p></> : null}
    </>
  );
}

export function CaseFlowModal({ client, data, c, person, weather, onClose }: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  const [doc, setDoc] = useState<FlowDoc | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Ref | null>(null);

  useEffect(() => { ref.current?.showModal(); }, []);
  useEffect(() => {
    let live = true;
    client.flow().then((snap) => live && setDoc(snap.doc), (e: unknown) => live && setError(e instanceof Error ? e.message : "Could not load the flowchart."));
    return () => { live = false; };
  }, [client]);

  const index = useMemo(() => (doc ? buildIndex(doc) : null), [doc]);
  const path = useMemo(() => (doc && index ? casePath(c, person, data, doc, index, weather) : null), [c, person, data, doc, index, weather]);
  // Nothing is highlighted until a box is chosen; then its links within this case's path light up.
  const highlight = useMemo((): Trace | null => {
    if (!index || !path || !selected) return null;
    const t = traceOf(index, selected);
    return { nodes: new Set([...t.nodes].filter((k) => path.trace.nodes.has(k))), links: new Set([...t.links].filter((k) => path.trace.links.has(k))) };
  }, [index, path, selected]);

  return (
    <dialog ref={ref} className="case-flow cf-demo" aria-labelledby="cf-title" onClose={onClose}>
      <header className="cf-head">
        <div>
          <p className="eyebrow">Flowchart for this case</p>
          <h2 id="cf-title">{person?.displayName ?? c.id}{person?.accountNumber ? <span className="cf-acct"> · {person.accountNumber}</span> : null}</h2>
          {path ? <p className="sub">{path.seen.size} signals seen → {path.flagged.size} circumstances flagged → {path.offered.size} solutions</p> : null}
        </div>
        <div className="cf-actions">
          <button type="button" className="btn" onClick={() => ref.current?.close()}>Close</button>
        </div>
      </header>
      {error ? <p className="notice notice-error" role="alert">{error}</p> : !doc || !index || !path ? <p className="muted cf-loading">Loading the flowchart…</p> : (
        <div className="cf-body" onClick={(e) => { if (selected && !(e.target as Element).closest("[data-node], .cf-panel, button, a")) setSelected(null); }}>
          <div className="board-scroll">
            <FlowBoard
              doc={doc} index={index} selected={selected} trace={highlight} utility="electricity" showAllLinks strongOnly={false}
              matches={new Set()} readOnly hideAdd only={path.trace.nodes} onSelect={setSelected} onAdd={() => {}}
              sources={DATA_SOURCE_GROUPS} onSourceSelect={() => setSelected(null)}
            />
          </div>
          <aside className="cf-panel" aria-label="Case details for the flowchart">
            <Panel refr={selected} path={path} index={index} onSelect={setSelected} />
          </aside>
        </div>
      )}
    </dialog>
  );
}
