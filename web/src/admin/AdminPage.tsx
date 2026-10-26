import { useEffect, useMemo, useRef, useState } from "react";
import type { FlowKind } from "@greenspark/shared";
import type { ApiClient, FlowCounts } from "../data/api";
import { FLOW_COLUMNS, FlowBoard, type FlowColumn } from "./FlowBoard";
import { FlowDetail } from "./FlowDetail";
import { FlowSettings } from "./FlowSettings";
import { FlowHowTo } from "./FlowHowTo";
import { DATA_SOURCE_GROUPS } from "./dataSources";
import { UTILITY_LABEL, buildIndex, entityOf, nodeKey, search, trace, type Ref } from "./flowModel";
import { useFlow } from "./useFlow";
import { useFlowMode } from "./editMode";
import "./admin.css";

export function AdminPage({ client }: { client: ApiClient }) {
  const flow = useFlow(client);
  const { doc } = flow;
  // Demo (the default) and View only never edit; Edit is chosen in the settings. The file's own problems also switch editing off.
  const mode = useFlowMode();
  const editMode = mode === "edit", demo = mode === "demo";
  const readOnly = flow.readOnly || !editMode;
  const [selected, setSelected] = useState<Ref | null>(null);
  const [creating, setCreating] = useState<FlowKind | null>(null);
  const [utility, setUtility] = useState("all");
  const [showAllLinks, setShowAllLinks] = useState(true);
  const [strongOnly, setStrongOnly] = useState(false);
  const [hiddenColumns, setHiddenColumns] = useState<Set<FlowColumn>>(() => {
    try { return new Set(JSON.parse(localStorage.getItem("flow-hidden-columns") ?? "[]") as FlowColumn[]); } catch { return new Set(); }
  });
  const toggleColumn = (c: FlowColumn, show: boolean) => setHiddenColumns((h) => {
    const next = new Set(h);
    if (show) next.delete(c); else next.add(c);
    if (FLOW_COLUMNS.every((x) => next.has(x.id))) return h; // keep at least one column
    try { localStorage.setItem("flow-hidden-columns", JSON.stringify([...next])); } catch { /* per-browser preference only */ }
    return next;
  });
  const [query, setQuery] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [undoError, setUndoError] = useState<string | null>(null);
  const scrollTo = useRef<string | null>(null);

  const index = useMemo(() => (doc ? buildIndex(doc) : null), [doc]);
  const [howOpen, setHowOpen] = useState(false);
  // The demo panel's big tile: how many customers the chosen box applies to.
  const [counts, setCounts] = useState<FlowCounts | null>(null);
  useEffect(() => {
    if (!demo || !client.flowCounts) return;
    let live = true;
    client.flowCounts().then((c) => { if (live) setCounts(c); }, () => undefined);
    return () => { live = false; };
  }, [client, demo]);
  const tracing = useMemo(() => (index && selected && entityOf(index, selected) ? trace(index, selected) : null), [index, selected]);
  const hits = useMemo(() => (doc ? search(doc, query) : []), [doc, query]);
  const matches = useMemo(() => new Set(query.trim() ? hits.map((h) => nodeKey(h.ref.kind, h.ref.id)) : []), [hits, query]);

  useEffect(() => { if (demo) setUtility("electricity"); }, [demo]);
  // In demo mode Escape clears the selection and shows every box again.
  useEffect(() => {
    if (!demo) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setSelected(null); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [demo]);
  // If the selected item is deleted (by you or somebody else), clear the selection.
  useEffect(() => { if (index && selected && !entityOf(index, selected)) setSelected(null); }, [index, selected]);

  useEffect(() => { document.title = "Flowchart · ERVEI"; }, []);

  // Bring a chosen node into view once it is on screen.
  useEffect(() => {
    if (!scrollTo.current) return;
    const key = scrollTo.current;
    scrollTo.current = null;
    requestAnimationFrame(() => document.querySelector(`[data-node="${CSS.escape(key)}"]`)?.scrollIntoView({ block: "center", behavior: "smooth" }));
  }, [selected]);

  const select = (ref: Ref | null) => {
    setCreating(null);
    setUndoError(null);
    setSelected(ref);
    if (ref) scrollTo.current = nodeKey(ref.kind, ref.id);
  };

  const download = () => {
    if (!doc) return;
    const blob = new Blob([JSON.stringify(doc, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "utility_hardship_mapping.json";
    a.click();
    URL.revokeObjectURL(a.href);
  };

  if (flow.loadError && !doc) {
    return (
      <main id="queue" className="admin" tabIndex={-1}>
        <div className="empty" role="alert"><h1>We couldn’t load the flow</h1><p>{flow.loadError}</p><button type="button" className="btn" onClick={() => void flow.reload()}>Try again</button></div>
      </main>
    );
  }
  if (!doc && flow.problems.length) {
    return (
      <main id="queue" className="admin" tabIndex={-1}>
        <div className="empty" role="alert"><h1>The flow file can’t be read</h1><ul className="problems">{flow.problems.map((p) => <li key={p}>{p}</li>)}</ul><p>Fix the JSON file, then reload.</p><button type="button" className="btn" onClick={() => void flow.reload()}>Reload</button></div>
      </main>
    );
  }
  if (!doc || !index) {
    return <main id="queue" className="admin" tabIndex={-1}><div className="empty" role="status"><p>Loading the flow…</p></div></main>;
  }

  const last = flow.undoStack[flow.undoStack.length - 1];
  const sheet = !demo && (selected !== null || creating !== null);

  return (
    <main id="queue" className={`admin${sheet ? " sheet-open" : ""}${demo ? " is-demo" : ""}`} tabIndex={-1}>
      <header className="admin-head">
        <div>
          <p className="eyebrow">Flowchart · {doc.meta.region}</p>
          <h1>Utility hardship flow</h1>
          <p className="sub">{doc.meta.title} · last verified {doc.meta.last_verified} · {doc.meta.counts.signals} signals, {doc.meta.counts.circumstances} circumstances, {doc.meta.counts.solutions} solutions, {doc.meta.counts.links} links</p>
        </div>
        <div className="admin-actions">
          <span hidden={demo} className={`savestate ${flow.save.state}`} role="status" aria-live="polite">
            {flow.save.state === "saving" ? "Saving to the file…" : flow.save.state === "saved" ? "All changes saved to the file" : flow.save.state === "error" ? `Couldn’t save: ${flow.save.message}. Showing the file as it is now.` : "Changes save to the file as you make them"}
          </span>
          <button type="button" className="btn" hidden={!editMode} disabled={!last || flow.readOnly} title={last ? `Undo ${last.label}` : "Nothing to undo"} onClick={() => { const r = flow.undo(); setUndoError(r.ok ? null : r.error); }}>
            Undo{last ? `: ${last.label}` : ""}
          </button>
          {editMode ? <button type="button" className="btn" onClick={() => setSettingsOpen(true)}>Settings</button> : null}
          {demo ? null : <button type="button" className="btn" onClick={download}>Download JSON</button>}
        </div>
      </header>

      {mode === "view" ? <div className="notice" role="note"><p><strong>View only.</strong> To change the flowchart, set Flowchart mode to Edit in the settings (the gear, top right).</p></div> : null}
      {flow.problems.length ? (
        <div className="notice notice-error" role="alert">
          <div><p>The JSON file has problems, so editing is switched off until they are fixed:</p><ul className="problems">{flow.problems.map((p) => <li key={p}>{p}</li>)}</ul></div>
          <button type="button" className="btn btn-small" onClick={() => void flow.reload()}>Reload</button>
        </div>
      ) : null}
      {undoError ? <div className="notice notice-error" role="alert"><p>{undoError}</p></div> : null}

      <div className="admin-controls" hidden={demo}>
        <div className="search flow-search">
          <label className="sr-only" htmlFor="flow-q">Find a signal, circumstance or solution</label>
          <input
            id="flow-q" type="search" placeholder="Find a signal, circumstance or solution" autoComplete="off" value={query}
            onChange={(e) => { setQuery(e.target.value); setSearchOpen(true); }} onFocus={() => setSearchOpen(true)} onBlur={() => window.setTimeout(() => setSearchOpen(false), 150)}
            onKeyDown={(e) => { if (e.key === "Escape") setSearchOpen(false); if (e.key === "Enter" && hits[0]) { e.preventDefault(); select(hits[0].ref); setSearchOpen(false); } }}
          />
          {searchOpen && query.trim() ? (
            <ul className="results" aria-label="Search results">
              {hits.length === 0 ? <li className="none">Nothing matches “{query.trim()}”.</li> : hits.map((h) => (
                <li key={nodeKey(h.ref.kind, h.ref.id)}><button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => { select(h.ref); setSearchOpen(false); }}><span className="k">{h.detail}</span>{h.name}</button></li>
              ))}
            </ul>
          ) : null}
        </div>
        <fieldset className="seg">
          <legend>Utility</legend>
          {["all", ...doc.meta.utilities].map((u) => (
            <span key={u}>
              <input type="radio" name="utility" id={`u-${u}`} value={u} checked={utility === u} onChange={() => setUtility(u)} />
              <label htmlFor={`u-${u}`}>{u === "all" ? "All" : UTILITY_LABEL[u] ?? u}</label>
            </span>
          ))}
        </fieldset>
        <div className="toggles">
          <label><input type="checkbox" checked={showAllLinks} onChange={(e) => setShowAllLinks(e.target.checked)} /> Show all links</label>
          <label><input type="checkbox" checked={strongOnly} onChange={(e) => setStrongOnly(e.target.checked)} /> Strong signals only</label>
        </div>
        <fieldset className="col-toggles">
          <legend className="sr-only">Columns to show</legend>
          <span className="seg-label" aria-hidden="true">Columns</span>
          {FLOW_COLUMNS.map((c) => (
            <label key={c.id}>
              <input type="checkbox" checked={!hiddenColumns.has(c.id)} onChange={(e) => toggleColumn(c.id, e.target.checked)} /> {c.label}
            </label>
          ))}
        </fieldset>
      </div>

      <div className="legend" aria-label="Legend">
        <span><svg viewBox="0 0 26 10" aria-hidden="true"><path d="M1 5H25" stroke="var(--moderate)" strokeWidth="1.8" /></svg>Strong signal</span>
        <span><svg viewBox="0 0 26 10" aria-hidden="true"><path d="M1 5H25" stroke="var(--moderate)" strokeWidth="1.8" strokeDasharray="3 3" /></svg>Supporting signal</span>
        <span><i className="mk acct" aria-hidden="true" />From account data</span>
        <span><i className="mk ask" aria-hidden="true" />Asked of the customer</span>
        <span><i className="mk wx" aria-hidden="true" />From weather forecasts</span>
        <span><i className="mk area" aria-hidden="true" />From area statistics</span>
        <span><i className="dot sensitive" aria-hidden="true" />Sensitive</span>
        <span><i className="dot safety" aria-hidden="true" />Safety</span>
        <span hidden={demo}><span className="ut"><i className="y">E</i><i className="y">G</i><i className="y">W</i><i className="y">P</i></span>Electricity, gas, water, phone/internet</span>
      </div>

      <div className="flow-layout">
        <div>
          <p className="swipe">Swipe sideways to see all the columns.</p>
          <div className="board-scroll">
            <FlowBoard
              doc={doc} index={index} selected={selected} trace={tracing} utility={utility} showAllLinks={showAllLinks} strongOnly={strongOnly}
              matches={matches} readOnly={readOnly} hideAdd={!editMode} hideNoData={demo} only={demo && selected && tracing ? tracing.nodes : null} onSelect={select} onAdd={(kind) => { setSelected(null); setCreating(kind); }}
              sources={DATA_SOURCE_GROUPS} onSourceSelect={() => select(null)} hidden={hiddenColumns}
            />
          </div>
        </div>
        {demo && !selected ? null : <div className={demo ? "flow-float" : undefined}>{demo ? <button type="button" className="flow-float-close" aria-label="Close the panel" onClick={() => setSelected(null)}>✕</button> : null}<FlowDetail
          doc={doc} index={index} selected={selected} creating={creating} readOnly={readOnly} compact={demo} counts={counts} dispatch={flow.dispatch}
          onSelect={select} onCloseCreate={() => setCreating(null)}
        /></div>}
      </div>

      <p className="flow-foot"><button type="button" className="link-btn" onClick={() => setHowOpen(true)}>How to read this flowchart</button></p>
      {howOpen ? <FlowHowTo doc={doc} onClose={() => setHowOpen(false)} /> : null}
      {settingsOpen && editMode ? <FlowSettings doc={doc} dispatch={flow.dispatch} onClose={() => setSettingsOpen(false)} /> : null}
    </main>
  );
}
