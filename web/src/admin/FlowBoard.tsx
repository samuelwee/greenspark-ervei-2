import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { signalHasData, type FlowCircumstance, type FlowDoc, type FlowKind, type FlowSignal, type FlowSolution } from "@greenspark/shared";
import { UTILITY_LETTER, groupCircumstances, groupSignals, groupSolutions, nodeKey, trace as traceOf, type FlowIndex, type Group, type Ref, type Trace } from "./flowModel";
import { sourceKey, sourceLinkKey, type DataSourceGroup } from "./dataSources";

interface Props {
  doc: FlowDoc;
  index: FlowIndex;
  selected: Ref | null;
  trace: Trace | null;
  utility: string;
  showAllLinks: boolean;
  strongOnly: boolean;
  matches: Set<string>;
  readOnly: boolean;
  onSelect: (ref: Ref) => void;
  onAdd: (kind: FlowKind) => void;
  /** When set, only these nodes (nodeKey) are shown, e.g. one case's path. */
  only?: Set<string> | null;
  /** Leaves out signals the demo data can't feed (the ones marked "No data"). */
  hideNoData?: boolean;
  /** Hides the + Add buttons (read-only views). */
  hideAdd?: boolean;
  /** When set, a Data sources column comes first, linked to the signals each source feeds. */
  sources?: DataSourceGroup[] | null;
  /** Called when a data source is chosen, so the page can clear its own selection. */
  onSourceSelect?: () => void;
  /** Columns to leave out. Links are only drawn between columns that are both shown. */
  hidden?: ReadonlySet<FlowColumn>;
}

export type FlowColumn = "sources" | "signals" | "circumstances" | "solutions";
export const FLOW_COLUMNS: { id: FlowColumn; label: string }[] = [
  { id: "sources", label: "Data sources" }, { id: "signals", label: "Signals" }, { id: "circumstances", label: "Circumstances" }, { id: "solutions", label: "Solutions" },
];
const COLUMN_WIDTH: Record<FlowColumn, [min: number, track: string]> = {
  sources: [200, "minmax(200px, .85fr)"], signals: [240, "minmax(240px, 1fr)"], circumstances: [260, "minmax(260px, 1.1fr)"], solutions: [260, "minmax(260px, 1.1fr)"],
};

interface Path { key: string; d: string; supporting: boolean; kind: "source-signal" | "signal-circumstance" | "circumstance-solution" }

function Utilities({ utilities, all }: { utilities: string[]; all: string[] }) {
  return (
    <span className="ut" role="img" aria-label={`Applies to: ${utilities.join(", ")}`}>
      {all.map((u) => <i key={u} className={utilities.includes(u) ? "y" : undefined} aria-hidden="true">{UTILITY_LETTER[u] ?? u[0]!.toUpperCase()}</i>)}
    </span>
  );
}

const Node = memo(function Node(props: { kind: FlowKind; id: string; label: string; selected: boolean; on: boolean; match: boolean; onSelect: (ref: Ref) => void; children?: React.ReactNode; className?: string }) {
  return (
    <button
      type="button"
      className={`fnode ${props.className ?? ""}${props.on ? " on" : ""}${props.selected ? " is-sel" : ""}${props.match ? " match" : ""}`}
      data-node={nodeKey(props.kind, props.id)}
      data-testid={`node-${props.kind}-${props.id}`}
      aria-pressed={props.selected}
      onClick={() => props.onSelect({ kind: props.kind, id: props.id })}
    >
      {props.children}
      <span className="sr-only">{props.label}</span>
    </button>
  );
});

function Lane<T extends { id: string }>(props: { groups: Group<T>[]; render: (item: T) => React.ReactNode }) {
  return (
    <>
      {props.groups.map((g) => (
        <section key={g.id} className="fgroup" aria-label={g.label}>
          <h3 className="glabel"><span>{g.label}</span><span className="gc">{g.items.length}</span></h3>
          <div className="gnodes">{g.items.map((item) => props.render(item))}</div>
        </section>
      ))}
    </>
  );
}

export function FlowBoard(props: Props) {
  const { doc, index, selected, trace, utility, showAllLinks, strongOnly } = props;
  const boardRef = useRef<HTMLDivElement>(null);
  const [paths, setPaths] = useState<Path[]>([]);
  const [size, setSize] = useState({ w: 0, h: 0 });

  const { only, hideNoData } = props;
  const keep = useCallback(<T extends { id: string }>(kind: FlowKind, groups: Group<T>[]) => {
    if (!only && !hideNoData) return groups;
    const shown = (i: T) => (!only || only.has(nodeKey(kind, i.id))) && !(hideNoData && kind === "signal" && !signalHasData(i as unknown as FlowSignal));
    return groups.map((g) => ({ ...g, items: g.items.filter(shown) })).filter((g) => g.items.length > 0);
  }, [only, hideNoData]);
  const signalGroups = useMemo(() => keep("signal", groupSignals(doc, utility)), [doc, utility, keep]);
  const circGroups = useMemo(() => keep("circumstance", groupCircumstances(doc, utility)), [doc, utility, keep]);
  const solGroups = useMemo(() => keep("solution", groupSolutions(doc, utility)), [doc, utility, keep]);

  // Data sources show only the signals on the board, and only if they feed at least one of them.
  const shownSignals = useMemo(() => new Set(signalGroups.flatMap((g) => g.items.map((s) => s.id))), [signalGroups]);
  const sourceGroups = useMemo(() => (props.sources ?? [])
    // A source with no signals at all (climate data) stays on the board, unless a path is being traced.
    .map((g) => ({ ...g, items: g.items.map((d) => ({ ...d, standalone: d.signals.length === 0, signals: d.signals.filter((id) => shownSignals.has(id)) })).filter((d) => d.signals.length > 0 || (d.standalone && !only)) }))
    .filter((g) => g.items.length > 0), [props.sources, shownSignals, only]);
  const withSources = !!props.sources;
  // The shown columns, left to right, each followed by an arrow column (except the last).
  const columns = FLOW_COLUMNS.map((c) => c.id).filter((c) => (c !== "sources" || withSources) && !props.hidden?.has(c));
  const shows = (c: FlowColumn) => columns.includes(c);
  const at = (c: FlowColumn) => columns.indexOf(c) * 2 + 1;
  const grid = {
    gridTemplateColumns: columns.map((c) => COLUMN_WIDTH[c][1]).join(" 36px "),
    minWidth: columns.reduce((w, c) => w + COLUMN_WIDTH[c][0], 0) + (columns.length - 1) * 36 + 28,
  };

  // A chosen data source lights up its signals and everything downstream of them.
  const [source, setSource] = useState<string | null>(null);
  useEffect(() => { if (selected) setSource(null); }, [selected]);
  const sourceTrace = useMemo((): Trace | null => {
    const d = source ? sourceGroups.flatMap((g) => g.items).find((x) => x.id === source) : undefined;
    if (!d) return null;
    const nodes = new Set([sourceKey(d.id)]), links = new Set<string>();
    for (const id of d.signals) {
      const t = traceOf(index, { kind: "signal", id });
      t.nodes.forEach((n) => nodes.add(n));
      t.links.forEach((l) => links.add(l));
      links.add(sourceLinkKey(d.id, id));
    }
    return { nodes, links };
  }, [source, sourceGroups, index]);
  // With a box chosen, its signals' data sources light up too.
  const active = useMemo((): Trace | null => {
    if (sourceTrace) return sourceTrace;
    if (!trace || !withSources) return trace;
    const nodes = new Set(trace.nodes), links = new Set(trace.links);
    for (const d of sourceGroups.flatMap((g) => g.items)) {
      for (const id of d.signals) if (trace.nodes.has(nodeKey("signal", id))) { nodes.add(sourceKey(d.id)); links.add(sourceLinkKey(d.id, id)); }
    }
    return { nodes, links };
  }, [sourceTrace, trace, withSources, sourceGroups]);
  const focus = active !== null;

  const visibleLinks = useMemo(() => {
    const shown = new Set<string>();
    for (const g of [...signalGroups, ...circGroups, ...solGroups]) for (const item of g.items as { id: string }[]) shown.add(item.id);
    const flow = index.links.filter((l) => {
      if (strongOnly && l.strength === "supporting") return false;
      const a = l.from.slice(l.from.indexOf(":") + 1), b = l.to.slice(l.to.indexOf(":") + 1);
      return shown.has(a) && shown.has(b);
    });
    const fromSources = sourceGroups.flatMap((g) => g.items.flatMap((d) => d.signals.map((id) => ({
      key: sourceLinkKey(d.id, id), from: sourceKey(d.id), to: nodeKey("signal", id), strength: null, kind: "source-signal" as const,
    }))));
    return [...fromSources, ...flow];
  }, [index, signalGroups, circGroups, solGroups, strongOnly, sourceGroups]);

  const measure = useCallback(() => {
    const board = boardRef.current;
    if (!board) return;
    const box = board.getBoundingClientRect();
    const rects = new Map<string, DOMRect>();
    board.querySelectorAll<HTMLElement>("[data-node]").forEach((el) => rects.set(el.dataset.node!, el.getBoundingClientRect()));
    const next: Path[] = [];
    for (const l of visibleLinks) {
      const a = rects.get(l.from), b = rects.get(l.to);
      if (!a || !b) continue;
      const x1 = a.right - box.left, y1 = a.top + a.height / 2 - box.top, x2 = b.left - box.left, y2 = b.top + b.height / 2 - box.top;
      const dx = (x2 - x1) * 0.5;
      next.push({ key: l.key, d: `M${x1.toFixed(1)} ${y1.toFixed(1)}C${(x1 + dx).toFixed(1)} ${y1.toFixed(1)} ${(x2 - dx).toFixed(1)} ${y2.toFixed(1)} ${x2.toFixed(1)} ${y2.toFixed(1)}`, supporting: l.strength === "supporting", kind: l.kind });
    }
    setPaths(next);
    setSize({ w: box.width, h: box.height });
  }, [visibleLinks]);

  // Links are drawn between the measured positions of the boxes, so measure after every change to the layout.
  useLayoutEffect(() => {
    measure();
    const board = boardRef.current;
    if (!board || typeof ResizeObserver === "undefined") return;
    let frame = 0;
    const observer = new ResizeObserver(() => { cancelAnimationFrame(frame); frame = requestAnimationFrame(measure); });
    observer.observe(board);
    return () => { cancelAnimationFrame(frame); observer.disconnect(); };
  }, [measure, doc, only, withSources, columns.join()]);

  const isOn = (kind: FlowKind, id: string) => !!active?.nodes.has(nodeKey(kind, id));
  const isSel = (kind: FlowKind, id: string) => selected?.kind === kind && selected.id === id;
  const isMatch = (kind: FlowKind, id: string) => props.matches.has(nodeKey(kind, id));
  const count = (groups: Group<{ id: string }>[]) => groups.reduce((n, g) => n + g.items.length, 0);
  const utilities = doc.meta.utilities;

  return (
    <div ref={boardRef} className={`fboard${focus ? " focus" : ""}${!showAllLinks && !focus ? " quiet" : ""}`} id="flow-board" style={grid}>
      <svg className="flinks" width={size.w} height={size.h} aria-hidden="true" focusable="false">
        {paths.map((p) => (
          <path key={p.key} d={p.d} className={`lk ${p.supporting ? "sup " : ""}${p.kind === "source-signal" ? "ds" : p.kind === "signal-circumstance" ? "sc" : "cs"}${active?.links.has(p.key) ? " on" : ""}`} />
        ))}
      </svg>

      {columns.slice(1).map((c) => <div key={c} className="fhead arrow" style={{ gridColumn: at(c) - 1 }} aria-hidden="true">→</div>)}
      {shows("sources") ? (
        <div className="fhead" style={{ gridColumn: at("sources") }}>
          <i className="db" aria-hidden="true" /><h2>Data sources</h2><span className="n" data-testid="count-sources">{count(sourceGroups)}</span>
        </div>
      ) : null}
      {shows("signals") ? <div className="fhead" style={{ gridColumn: at("signals") }}>
        <i className="mk acct" aria-hidden="true" /><h2>Signals</h2><span className="n" data-testid="count-signals">{count(signalGroups)}</span>
        {props.hideAdd ? null : <button type="button" className="add-btn" disabled={props.readOnly} onClick={() => props.onAdd("signal")} aria-label="Add a signal">+ Add</button>}
      </div> : null}
      {shows("circumstances") ? <div className="fhead" style={{ gridColumn: at("circumstances") }}>
        <i className="dot ink" aria-hidden="true" /><h2>Circumstances</h2><span className="n" data-testid="count-circumstances">{count(circGroups)}</span>
        {props.hideAdd ? null : <button type="button" className="add-btn" disabled={props.readOnly} onClick={() => props.onAdd("circumstance")} aria-label="Add a circumstance">+ Add</button>}
      </div> : null}
      {shows("solutions") ? <div className="fhead" style={{ gridColumn: at("solutions") }}>
        <i className="sq" aria-hidden="true" /><h2>Solutions</h2><span className="n" data-testid="count-solutions">{count(solGroups)}</span>
        {props.hideAdd ? null : <button type="button" className="add-btn" disabled={props.readOnly} onClick={() => props.onAdd("solution")} aria-label="Add a solution">+ Add</button>}
      </div> : null}

      {shows("sources") ? (
        <div className="flane" style={{ gridColumn: at("sources") }}>
          {sourceGroups.map((g) => (
            <section key={g.id} className="fgroup" aria-label={g.label}>
              <h3 className="glabel"><span>{g.label}</span><span className="gc">{g.items.length}</span></h3>
              <div className="gnodes">
                {g.items.map((d) => (
                  <button
                    key={d.id} type="button" className={`fnode src${active?.nodes.has(sourceKey(d.id)) ? " on" : ""}${source === d.id ? " is-sel" : ""}`}
                    data-node={sourceKey(d.id)} data-testid={`node-source-${d.id}`} aria-pressed={source === d.id}
                    onClick={() => { props.onSourceSelect?.(); setSource(source === d.id ? null : d.id); }}
                  >
                    <span className="nl">{d.name}</span>
                    <span className="sub">{d.detail}</span>
                    <span className="sr-only">Data source: {d.name}, feeds {d.signals.length} signal{d.signals.length === 1 ? "" : "s"}</span>
                  </button>
                ))}
              </div>
            </section>
          ))}
        </div>
      ) : null}
      {shows("signals") ? <div className="flane" style={{ gridColumn: at("signals") }}>
        <Lane
          groups={signalGroups}
          render={(s: FlowSignal) => (
            <Node key={s.id} kind="signal" id={s.id} label={`Signal: ${s.name}${signalHasData(s) ? "" : ", data is missing"}`} selected={isSel("signal", s.id)} on={isOn("signal", s.id)} match={isMatch("signal", s.id)} onSelect={props.onSelect}>
              <i className={`mk ${s.source === "account" ? "acct" : s.source === "weather" ? "wx" : s.source === "area" ? "area" : "ask"}`} aria-hidden="true" />
              <span className="nl">{s.name}</span>
              {signalHasData(s) ? null : <span className="nodata" aria-hidden="true">No data</span>}
              {s.sensitive ? <i className="dot sensitive" aria-label="Sensitive" /> : null}
            </Node>
          )}
        />
      </div> : null}
      {shows("circumstances") ? <div className="flane" style={{ gridColumn: at("circumstances") }}>
        <Lane
          groups={circGroups}
          render={(c: FlowCircumstance) => (
            <Node key={c.id} kind="circumstance" id={c.id} label={`Circumstance: ${c.name}`} className="circ" selected={isSel("circumstance", c.id)} on={isOn("circumstance", c.id)} match={isMatch("circumstance", c.id)} onSelect={props.onSelect}>
              {c.sensitivity !== "standard" ? <i className={`dot ${c.sensitivity}`} aria-label={c.sensitivity === "safety" ? "Safety" : "Sensitive"} /> : null}
              <span className="nl">{c.name}</span>
              <Utilities utilities={c.utilities} all={utilities} />
            </Node>
          )}
        />
      </div> : null}
      {shows("solutions") ? <div className="flane" style={{ gridColumn: at("solutions") }}>
        <Lane
          groups={solGroups}
          render={(s: FlowSolution) => (
            <Node key={s.id} kind="solution" id={s.id} label={`Solution: ${s.name}`} className="sol" selected={isSel("solution", s.id)} on={isOn("solution", s.id)} match={isMatch("solution", s.id)} onSelect={props.onSelect}>
              <span className="nl">{s.name}</span>
              <span className="sub">{s.provider}</span>
            </Node>
          )}
        />
      </div> : null}
    </div>
  );
}

