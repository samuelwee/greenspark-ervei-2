import { useEffect, useMemo, useRef, useState } from "react";
import type { FlowCounts } from "../data/api";
import { signalHasData, slugId, type FlowCircumstance, type FlowDoc, type FlowKind, type FlowOp, type FlowSignal, type FlowSolution, type Strength } from "@greenspark/shared";
import { KIND_LABEL, SOURCE_LABEL, UTILITY_LABEL, entityOf, type FlowIndex, type Ref } from "./flowModel";
import type { DispatchResult } from "./useFlow";

type Dispatch = (op: FlowOp, opts?: { label?: string }) => DispatchResult;

interface Props {
  doc: FlowDoc;
  index: FlowIndex;
  selected: Ref | null;
  creating: FlowKind | null;
  readOnly: boolean;
  /** The floating demo panel: just the box's name, kind and facts, without its id, links or notes. */
  compact?: boolean;
  /** How many customers each box applies to; shown as a big tile on the compact panel. */
  counts?: FlowCounts | null;
  dispatch: Dispatch;
  onSelect: (ref: Ref | null) => void;
  onCloseCreate: () => void;
}

// ---------- a small search-and-pick box for adding links ----------

function Picker(props: { label: string; options: { id: string; name: string }[]; onPick: (id: string) => void; disabled: boolean }) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const shown = useMemo(() => {
    const t = q.trim().toLowerCase();
    return props.options.filter((o) => !t || o.name.toLowerCase().includes(t) || o.id.includes(t)).slice(0, 8);
  }, [q, props.options]);
  return (
    <div className="picker">
      <label className="sr-only" htmlFor={`pick-${props.label}`}>{props.label}</label>
      <input
        id={`pick-${props.label}`} type="search" value={q} disabled={props.disabled} placeholder={props.label} autoComplete="off"
        onChange={(e) => { setQ(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        onBlur={() => window.setTimeout(() => setOpen(false), 150)}
        onKeyDown={(e) => { if (e.key === "Escape") setOpen(false); if (e.key === "Enter" && shown[0]) { e.preventDefault(); props.onPick(shown[0].id); setQ(""); } }}
      />
      {open && shown.length > 0 ? (
        <ul className="picker-list">
          {shown.map((o) => (
            <li key={o.id}><button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => { props.onPick(o.id); setQ(""); setOpen(false); }}>{o.name}</button></li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

// ---------- link lists ----------

interface LinkItem { ref: Ref; name: string; strength?: Strength }

function LinkSection(props: {
  title: string; items: LinkItem[]; options: { id: string; name: string }[]; pickLabel: string; readOnly: boolean;
  onOpen: (ref: Ref) => void; onRemove: (item: LinkItem) => DispatchResult; onAdd: (id: string) => DispatchResult; onStrength?: (item: LinkItem, s: Strength) => DispatchResult;
}) {
  const [error, setError] = useState<string | null>(null);
  const run = (r: DispatchResult) => setError(r.ok ? null : r.error);
  return (
    <section className="dsec" aria-label={props.title}>
      <h3>{props.title} <span className="n">{props.items.length}</span></h3>
      {props.items.length === 0 ? <p className="muted">None yet.</p> : (
        <ul className="lchips">
          {props.items.map((it) => (
            <li key={`${it.ref.kind}:${it.ref.id}`} className="lchip">
              <button type="button" className="lname" onClick={() => props.onOpen(it.ref)}>{it.name}</button>
              {it.strength ? (
                <select
                  aria-label={`Strength of the link with ${it.name}`} value={it.strength} disabled={props.readOnly}
                  className={`strength ${it.strength}`} onChange={(e) => run(props.onStrength!(it, e.target.value as Strength))}
                >
                  <option value="strong">Strong</option>
                  <option value="supporting">Supporting</option>
                </select>
              ) : null}
              {props.readOnly ? null : <button type="button" className="lx" aria-label={`Remove link to ${it.name}`} onClick={() => run(props.onRemove(it))}>✕</button>}
            </li>
          ))}
        </ul>
      )}
      {!props.readOnly ? <Picker label={props.pickLabel} options={props.options} disabled={false} onPick={(id) => run(props.onAdd(id))} /> : null}
      {error ? <p className="ferror" role="alert">{error}</p> : null}
    </section>
  );
}

// ---------- add / edit form ----------

type FieldDef = { key: string; label: string; type: "text" | "textarea" | "select" | "checkbox" | "utilities" | "date" | "url"; options?: { value: string; label: string }[]; hint?: string; list?: string[] };

function fieldsFor(kind: FlowKind, doc: FlowDoc): FieldDef[] {
  const utilities: FieldDef = { key: "utilities", label: "Applies to", type: "utilities" };
  if (kind === "signal") {
    return [
      { key: "name", label: "Name", type: "text" },
      { key: "source", label: "Where it comes from", type: "select", options: [{ value: "account", label: SOURCE_LABEL.account! }, { value: "self_report", label: SOURCE_LABEL.self_report! }, { value: "weather", label: SOURCE_LABEL.weather! }, { value: "area", label: SOURCE_LABEL.area! }] },
      { key: "detect", label: "What it means", type: "textarea" },
      { key: "example_rule", label: "Example rule", type: "text" },
      { key: "sensitive", label: "Sensitive (use only with care and consent)", type: "checkbox" },
      utilities,
    ];
  }
  if (kind === "circumstance") {
    return [
      { key: "name", label: "Name", type: "text" },
      { key: "type", label: "Type", type: "select", options: doc.circumstance_types.map((t) => ({ value: t.id, label: t.name })) },
      { key: "category", label: "Category", type: "select", options: doc.categories.map((c) => ({ value: c.id, label: c.name })) },
      { key: "description", label: "Description", type: "textarea" },
      { key: "sensitivity", label: "Sensitivity", type: "select", options: [{ value: "standard", label: "Standard" }, { value: "sensitive", label: "Sensitive" }, { value: "safety", label: "Safety" }] },
      { key: "handling", label: "Handling note", type: "textarea", hint: "Leave empty for none." },
      utilities,
    ];
  }
  return [
    { key: "name", label: "Name", type: "text" },
    { key: "type", label: "Type", type: "text", list: [...new Set(doc.solutions.map((s) => s.type))] },
    { key: "provider", label: "Provider", type: "text" },
    { key: "how_to_access", label: "How to access it", type: "textarea" },
    { key: "contact", label: "Contact", type: "textarea" },
    { key: "key_facts", label: "Key facts", type: "textarea" },
    { key: "source_url", label: "Source web address", type: "url", hint: "Must start with http:// or https://. Leave empty for none." },
    { key: "verified", label: "Re-checked against its source", type: "checkbox" },
    { key: "last_verified", label: "Date last checked", type: "date" },
    utilities,
  ];
}

function draftFrom(kind: FlowKind, doc: FlowDoc, entity: Record<string, unknown> | null): Record<string, unknown> {
  const draft: Record<string, unknown> = {};
  for (const f of fieldsFor(kind, doc)) {
    const v = entity?.[f.key];
    draft[f.key] = f.type === "checkbox" ? v === true : f.type === "utilities" ? (Array.isArray(v) ? v : doc.meta.utilities) : typeof v === "string" ? v : f.type === "select" ? (f.options?.[0]?.value ?? "") : "";
  }
  return draft;
}

function EntityForm(props: { kind: FlowKind; doc: FlowDoc; entity: Record<string, unknown> | null; dispatch: Dispatch; onDone: (ref?: Ref) => void; onCancel: () => void }) {
  const { kind, doc, entity } = props;
  const creating = entity === null;
  const fields = useMemo(() => fieldsFor(kind, doc), [kind, doc]);
  const initial = useMemo(() => draftFrom(kind, doc, entity), [kind, doc, entity]);
  const [draft, setDraft] = useState(initial);
  const [id, setId] = useState("");
  const [idTouched, setIdTouched] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const first = useRef<HTMLInputElement>(null);
  useEffect(() => { first.current?.focus(); }, []);

  const taken = useMemo(() => new Set([...doc.signals, ...doc.circumstances, ...doc.solutions].map((e) => e.id)), [doc]);
  const effectiveId = creating ? (idTouched ? id : slugId(String(draft.name ?? ""), taken)) : (entity.id as string);
  const changed = fields.filter((f) => JSON.stringify(draft[f.key]) !== JSON.stringify(initial[f.key]));
  const set = (key: string, value: unknown) => setDraft((d) => ({ ...d, [key]: value }));

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (creating) {
      const r = props.dispatch({ type: "addEntity", kind, entity: { id: effectiveId, ...draft } }, { label: `add “${String(draft.name).trim()}”` });
      if (r.ok) props.onDone({ kind, id: effectiveId }); else setError(r.error);
    } else {
      const patch = Object.fromEntries(changed.map((f) => [f.key, draft[f.key]]));
      const r = props.dispatch({ type: "updateEntity", kind, id: effectiveId, patch }, { label: `edit “${String(entity.name)}”` });
      if (r.ok) props.onDone(); else setError(r.error);
    }
  };

  return (
    <form className="eform" onSubmit={submit} noValidate>
      <h2>{creating ? `Add a ${KIND_LABEL[kind].toLowerCase()}` : `Edit ${KIND_LABEL[kind].toLowerCase()}`}</h2>
      {fields.map((f, i) => {
        const fid = `f-${kind}-${f.key}`;
        const value = draft[f.key];
        return (
          <div key={f.key} className="ffield">
            {f.type === "checkbox" ? (
              <label className="inline-check"><input type="checkbox" checked={value === true} onChange={(e) => set(f.key, e.target.checked)} /> {f.label}</label>
            ) : f.type === "utilities" ? (
              <fieldset>
                <legend>{f.label}</legend>
                <div className="util-checks">
                  {doc.meta.utilities.map((u) => (
                    <label key={u} className="inline-check">
                      <input type="checkbox" checked={(value as string[]).includes(u)} onChange={(e) => set(f.key, e.target.checked ? [...(value as string[]), u] : (value as string[]).filter((x) => x !== u))} /> {UTILITY_LABEL[u] ?? u}
                    </label>
                  ))}
                </div>
              </fieldset>
            ) : (
              <>
                <label htmlFor={fid}>{f.label}</label>
                {f.type === "textarea" ? (
                  <textarea id={fid} rows={3} value={String(value ?? "")} onChange={(e) => set(f.key, e.target.value)} />
                ) : f.type === "select" ? (
                  <select id={fid} value={String(value ?? "")} onChange={(e) => set(f.key, e.target.value)}>
                    {f.options!.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                ) : (
                  <input
                    id={fid} ref={i === 0 ? first : undefined} type={f.type === "date" ? "date" : "text"} value={String(value ?? "")} list={f.list ? `${fid}-list` : undefined}
                    inputMode={f.type === "url" ? "url" : undefined} onChange={(e) => set(f.key, e.target.value)}
                  />
                )}
                {f.list ? <datalist id={`${fid}-list`}>{f.list.map((o) => <option key={o} value={o} />)}</datalist> : null}
                {f.hint ? <p className="hint">{f.hint}</p> : null}
              </>
            )}
          </div>
        );
      })}
      {creating ? (
        <div className="ffield">
          <label htmlFor="f-id">Short ID <span className="hint">(used in the file; can't be changed later)</span></label>
          <input id="f-id" type="text" value={effectiveId} onChange={(e) => { setId(e.target.value); setIdTouched(true); }} />
        </div>
      ) : null}
      {error ? <p className="ferror" role="alert">{error}</p> : null}
      <div className="actions">
        <button type="submit" className="btn btn-primary" disabled={creating ? !String(draft.name ?? "").trim() : changed.length === 0}>{creating ? "Add" : "Save changes"}</button>
        <button type="button" className="btn" onClick={props.onCancel}>Cancel</button>
      </div>
    </form>
  );
}

// ---------- viewing one entity ----------

function Utilities({ doc, list }: { doc: FlowDoc; list: string[] }) {
  return <span className="uchips">{doc.meta.utilities.map((u) => <span key={u} className={`uchip${list.includes(u) ? " y" : ""}`}>{UTILITY_LABEL[u] ?? u}</span>)}</span>;
}

function Facts({ doc, entity, kind, compact }: { doc: FlowDoc; entity: FlowSignal | FlowCircumstance | FlowSolution; kind: FlowKind; compact?: boolean }) {
  if (kind === "signal") {
    const s = entity as FlowSignal;
    return (
      <>
        <p className="q">{s.detect || <span className="muted">No description yet.</span>}</p>
        <dl className="facts">
          <dt>Source</dt><dd>{SOURCE_LABEL[s.source] ?? s.source}</dd>
          {compact ? null : <><dt>Applies to</dt><dd><Utilities doc={doc} list={s.utilities} /></dd></>}
          {s.example_rule ? (<><dt>Example rule</dt><dd><code className="code">{s.example_rule}</code></dd></>) : null}
        </dl>
        {s.sensitive ? <p className="note sensitive">Sensitive. Use only to prompt a trained staff member, and only with the customer's consent.</p> : null}
        {signalHasData(s) ? null : (
          <p className="note nodata-note">
            <strong>Data is missing.</strong>{" "}
            {s.source === "account"
              ? "The demo accounts don't hold the data this rule needs, so this signal never fires on a case."
              : "None of the survey questions ask this, so this signal never fires on a case."}
          </p>
        )}
      </>
    );
  }
  if (kind === "circumstance") {
    const c = entity as FlowCircumstance;
    const type = doc.circumstance_types.find((t) => t.id === c.type);
    const category = doc.categories.find((x) => x.id === c.category);
    return (
      <>
        <p className="q">{c.description || <span className="muted">No description yet.</span>}</p>
        <dl className="facts">
          <dt>Type</dt><dd>{type?.name ?? c.type}{type ? <span className="sub"> {type.meaning}</span> : null}</dd>
          {type?.who_acts ? (<><dt>Who acts</dt><dd>{type.who_acts}</dd></>) : null}
          <dt>Category</dt><dd>{category?.name ?? c.category}</dd>
          <dt>Sensitivity</dt><dd><span className={`pill ${c.sensitivity}`}>{c.sensitivity}</span></dd>
          {compact ? null : <><dt>Applies to</dt><dd><Utilities doc={doc} list={c.utilities} /></dd></>}
        </dl>
        {c.handling && !compact ? <p className={`note ${c.sensitivity}`}>{c.handling}</p> : null}
        {c.sensitivity === "safety" ? <p className="note safety">Safety circumstance: never actioned automatically. It creates a task for trained staff.</p> : null}
      </>
    );
  }
  const s = entity as FlowSolution;
  const safeUrl = s.source_url && /^https?:\/\//i.test(s.source_url) ? s.source_url : null;
  return (
    <>
      <p className="q">{s.key_facts || <span className="muted">No key facts yet.</span>}</p>
      <dl className="facts">
        <dt>Type</dt><dd>{s.type}</dd>
        <dt>Provider</dt><dd>{s.provider}</dd>
        {s.how_to_access ? (<><dt>How to access</dt><dd>{s.how_to_access}</dd></>) : null}
        {s.contact ? (<><dt>Contact</dt><dd>{s.contact}</dd></>) : null}
        {compact ? null : <><dt>Applies to</dt><dd><Utilities doc={doc} list={s.utilities} /></dd></>}
        <dt>Source</dt><dd>{safeUrl ? <a href={safeUrl} target="_blank" rel="noreferrer">{safeUrl.replace(/^https?:\/\//, "").slice(0, 60)}</a> : <span className="muted">No link</span>}</dd>
        <dt>Checked</dt><dd>{s.verified ? <>Verified{s.last_verified ? ` ${s.last_verified}` : ""}</> : <span className="pill sensitive">Not re-checked</span>}</dd>
      </dl>
    </>
  );
}

function EntityView(props: { doc: FlowDoc; index: FlowIndex; refr: Ref; readOnly: boolean; compact?: boolean; counts?: FlowCounts | null; dispatch: Dispatch; onSelect: (ref: Ref | null) => void }) {
  const { doc, index, refr, readOnly, dispatch } = props;
  const entity = entityOf(index, refr);
  const [editing, setEditing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => { heading.current?.focus(); }, [refr.id, refr.kind]);
  if (!entity) return <p className="muted">That item no longer exists.</p>;

  const linkCount = refr.kind === "circumstance" ? (entity as FlowCircumstance).signals.length + (entity as FlowCircumstance).solutions.length : refr.kind === "signal" ? (entity as FlowSignal).points_to.length : (entity as FlowSolution).used_for.length;
  const circName = (id: string) => index.circumstances.get(id)?.name ?? id;
  const nameOf = (kind: FlowKind, id: string) => (kind === "signal" ? index.signals.get(id)?.name : kind === "solution" ? index.solutions.get(id)?.name : index.circumstances.get(id)?.name) ?? id;
  const opts = (items: { id: string; name: string }[], taken: Set<string>) => items.filter((i) => !taken.has(i.id));

  if (editing) {
    return <EntityForm kind={refr.kind} doc={doc} entity={entity as unknown as Record<string, unknown>} dispatch={dispatch} onDone={() => setEditing(false)} onCancel={() => setEditing(false)} />;
  }

  return (
    <div className="eview">
      <div className="d-head">
        <div>
          <p className={`kind kind-${refr.kind}`}>{KIND_LABEL[refr.kind]}</p>
          <h2 tabIndex={-1} ref={heading}>{entity.name}</h2>
          {props.compact ? null : <p className="idline"><code className="code">{entity.id}</code></p>}
        </div>
        <button type="button" className="icon-btn" aria-label="Close details" onClick={() => props.onSelect(null)}>✕</button>
      </div>
      {props.compact && props.counts ? (() => {
        const n = (refr.kind === "signal" ? props.counts.signals : refr.kind === "circumstance" ? props.counts.circumstances : props.counts.solutions)[entity.id] ?? 0;
        const what = refr.kind === "signal" ? "customers this signal is found for" : refr.kind === "circumstance" ? "customers flagged with this circumstance" : "customers this solution is offered to";
        const share = props.counts.total ? n / props.counts.total : 0;
        return <div className="count-tile" role="group" aria-label="Customers this applies to"><strong>{n.toLocaleString("en-AU")}</strong><span>{what}</span><span className="sub">{props.counts.total ? `${share >= 0.1 ? Math.round(share * 100) : (share * 100).toFixed(1)}% of ${props.counts.total.toLocaleString("en-AU")} customers` : ""}</span></div>;
      })() : null}
      <Facts doc={doc} entity={entity} kind={refr.kind} compact={props.compact} />
      {readOnly ? null : <div className="actions">
        <button type="button" className="btn" onClick={() => setEditing(true)}>Edit</button>
        {!confirming ? <button type="button" className="btn btn-danger" onClick={() => setConfirming(true)}>Delete</button> : null}
      </div>}
      {confirming ? (
        <div className="confirm" role="alertdialog" aria-label="Confirm delete">
          <p>Delete “{entity.name}”? {linkCount ? `This also removes its ${linkCount} link${linkCount === 1 ? "" : "s"}.` : ""} You can undo this straight afterwards.</p>
          <div className="actions">
            <button type="button" className="btn btn-danger" onClick={() => { dispatch({ type: "deleteEntity", kind: refr.kind, id: entity.id }, { label: `delete “${entity.name}”` }); props.onSelect(null); }}>Delete</button>
            <button type="button" className="btn" onClick={() => setConfirming(false)}>Keep</button>
          </div>
        </div>
      ) : null}

      {props.compact ? null : <>
      {refr.kind === "signal" ? (
        <LinkSection
          title="Points to circumstances" readOnly={readOnly} pickLabel="Add a circumstance…"
          items={(index.circumstancesOfSignal.get(entity.id) ?? []).map((l) => ({ ref: { kind: "circumstance" as const, id: l.id }, name: circName(l.id), strength: l.strength }))}
          options={opts(doc.circumstances, new Set((index.circumstancesOfSignal.get(entity.id) ?? []).map((l) => l.id)))}
          onOpen={props.onSelect}
          onAdd={(id) => dispatch({ type: "setLink", signalId: entity.id, circumstanceId: id, strength: "supporting" }, { label: "add a link" })}
          onRemove={(it) => dispatch({ type: "removeSignalLink", signalId: entity.id, circumstanceId: it.ref.id }, { label: "remove a link" })}
          onStrength={(it, s) => dispatch({ type: "setLink", signalId: entity.id, circumstanceId: it.ref.id, strength: s }, { label: "change a link's strength" })}
        />
      ) : null}
      {refr.kind === "circumstance" ? (
        <>
          <LinkSection
            title="Signals that point here" readOnly={readOnly} pickLabel="Add a signal…"
            items={(entity as FlowCircumstance).signals.map((l) => ({ ref: { kind: "signal" as const, id: l.id }, name: nameOf("signal", l.id), strength: l.strength }))}
            options={opts(doc.signals, new Set((entity as FlowCircumstance).signals.map((l) => l.id)))}
            onOpen={props.onSelect}
            onAdd={(id) => dispatch({ type: "setLink", signalId: id, circumstanceId: entity.id, strength: "supporting" }, { label: "add a link" })}
            onRemove={(it) => dispatch({ type: "removeSignalLink", signalId: it.ref.id, circumstanceId: entity.id }, { label: "remove a link" })}
            onStrength={(it, s) => dispatch({ type: "setLink", signalId: it.ref.id, circumstanceId: entity.id, strength: s }, { label: "change a link's strength" })}
          />
          <LinkSection
            title="Solutions" readOnly={readOnly} pickLabel="Add a solution…"
            items={(entity as FlowCircumstance).solutions.map((id) => ({ ref: { kind: "solution" as const, id }, name: nameOf("solution", id) }))}
            options={opts(doc.solutions, new Set((entity as FlowCircumstance).solutions))}
            onOpen={props.onSelect}
            onAdd={(id) => dispatch({ type: "addSolutionLink", circumstanceId: entity.id, solutionId: id }, { label: "add a link" })}
            onRemove={(it) => dispatch({ type: "removeSolutionLink", circumstanceId: entity.id, solutionId: it.ref.id }, { label: "remove a link" })}
          />
        </>
      ) : null}
      {refr.kind === "solution" ? (
        <LinkSection
          title="Used for circumstances" readOnly={readOnly} pickLabel="Add a circumstance…"
          items={(index.circumstancesOfSolution.get(entity.id) ?? []).map((id) => ({ ref: { kind: "circumstance" as const, id }, name: circName(id) }))}
          options={opts(doc.circumstances, new Set(index.circumstancesOfSolution.get(entity.id) ?? []))}
          onOpen={props.onSelect}
          onAdd={(id) => dispatch({ type: "addSolutionLink", circumstanceId: id, solutionId: entity.id }, { label: "add a link" })}
          onRemove={(it) => dispatch({ type: "removeSolutionLink", circumstanceId: it.ref.id, solutionId: entity.id }, { label: "remove a link" })}
        />
      ) : null}
      </>}
    </div>
  );
}

// ---------- the panel ----------

export function FlowDetail(props: Props) {
  const { doc, selected, creating } = props;
  const rest = !selected && !creating;
  return (
    <aside className={`fdetail${rest ? " rest" : ""}`} aria-label="Details" aria-live="polite">
      {creating ? (
        <EntityForm
          key={`create-${creating}`} kind={creating} doc={doc} entity={null} dispatch={props.dispatch}
          onDone={(ref) => { props.onCloseCreate(); if (ref) props.onSelect(ref); }} onCancel={props.onCloseCreate}
        />
      ) : selected ? (
        <EntityView key={`${selected.kind}:${selected.id}`} doc={doc} index={props.index} refr={selected} readOnly={props.readOnly} compact={props.compact} counts={props.counts} dispatch={props.dispatch} onSelect={props.onSelect} />
      ) : (
        <div className="frest">
          <h2>Details</h2>
          <p className="hint">Select any box to trace its path and see its details.{props.readOnly ? "" : " Every change is saved to the JSON file."}</p>
        </div>
      )}
    </aside>
  );
}
