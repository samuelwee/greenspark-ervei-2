import { useEffect, useRef, useState } from "react";
import type { CaseStatus, QueueCase, ReviewStatus, StaffUser } from "../domain/types";
import type { ApiClient, CaseItem, Catalog, ContactMethod, PlanKind, PlanStep, SupportPlan } from "../data/api";
import { CaseFlowModal } from "../admin/CaseFlowModal";
import { PredictionDetails } from "./PredictionsPage";
import { isModifiedClick } from "../route";
import { PERIOD_TEXT, readableDates } from "../domain/format";
import { ageOn, PRIORITY_PROVIDER } from "../domain/types";
import { Mark, AccountHistory, AccountSignals, ContactHistory, date, SupplyAndCollections, SupportHistory, UtilityAccount } from "./AccountDetails";
import { CaseGlance } from "./CaseGlance";
import { paragraphs } from "./paragraphs";
import { PriorityBreakdownView } from "./PriorityBreakdown";

/** A missing contact detail is shown as not recorded, so it is never mistaken for "none". */
function notRecorded(v: string | null | undefined): string {
  return v && v.trim() ? v : "Not recorded";
}

function answerText(c: QueueCase, fieldId: string): { text: string; tone: "yes" | "no" | "unknown" } {
  const v = c.reportedAnswers[fieldId];
  if (v === null || v === undefined) {
    const av = c.answerAvailability[fieldId];
    return { text: av === "not_asked" ? "Not asked" : "Unknown / not recorded", tone: "unknown" };
  }
  return { text: v, tone: v === "No" ? "no" : "yes" };
}

export interface CaseActions {
  onAssign: (userId: string) => Promise<boolean>;
  onStatus: (status: CaseStatus) => Promise<boolean>;
  onReview: (next: ReviewStatus) => Promise<boolean>;
  onNote: (text: string) => Promise<boolean>;
  onEditNote: (noteId: string, text: string) => Promise<boolean>;
}

export function CaseDetails(props: { data: Catalog; item: CaseItem; user: StaffUser; busy: boolean; actions: CaseActions; loadPlan?: (caseId: string, kind?: PlanKind) => Promise<SupportPlan>; client?: ApiClient; navigate?: (to: string) => void }) {
  const { data, item } = props;
  const c = item.case;
  const person = item.person ?? undefined;
  const heading = useRef<HTMLHeadingElement>(null);
  const field = (id: string) => data.evidenceFields.find((f) => f.id === id);
  const assignedUser = data.users.find((u) => u.id === c.workflow.assignedToUserId);
  const a = c.modelAssessment;
  const fromFlow = data.circumstanceSource === "flow";
  const [flowOpen, setFlowOpen] = useState(false);
  // One call gives the Suggested plan and the order of Solutions to offer, so the two agree.
  const supportAi = useAiPlan("support", c.id, c.version, c.circumstances.length ? props.loadPlan : undefined);
  const aiOrder = fromFlow && supportAi?.plan?.order?.length ? supportAi.plan.order : undefined;
  const orderedRecs = aiOrder
    ? aiOrder.map((o) => c.recommendations.find((r) => r.recommendationId === o.id)!).filter(Boolean)
    : c.recommendations;
  const fromSignals = a.provider === PRIORITY_PROVIDER;
  const acct = person?.account ?? null;

  // A new page should start at its heading for keyboard and screen-reader users.
  useEffect(() => { heading.current?.focus(); }, [c.id]);

  const history = c.assistance.reportedHistory;
  const [section, setSection] = useSection();
  // The sections behind the summary, each opened as a modal from its card or the list below.
  const sections: { id: string; title: string; hint: string; body: React.ReactNode }[] = [
    { id: "customer", title: "Customer and account", hint: "Contact details, household and the utility account", body: (
      <>
          <section className="case-card" aria-labelledby="ov-contact">
            <h3 id="ov-contact">Customer details</h3>
            <dl className="details">
              <div><dt>Preferred name</dt><dd>{notRecorded(person?.preferredName)}</dd></div>
              <div><dt>Gender</dt><dd>{notRecorded(person?.gender)}</dd></div>
              <div><dt>Age</dt><dd>{acct ? `${ageOn(acct.dateOfBirth, data.asOf)} (born ${date(acct.dateOfBirth)})` : "Not recorded"}</dd></div>
              <div><dt>Household</dt><dd>{notRecorded(person?.householdSummary)}</dd></div>
              <div className="wide">
                <dt>Address</dt>
                <dd>
                  {person?.address ? (
                    <address>
                      {person.address.line1}<br />
                      {person.address.line2 ? <>{person.address.line2}<br /></> : null}
                      {person.suburb} {person.state} {person.address.postcode}
                    </address>
                  ) : "Not recorded"}
                </dd>
              </div>
              <div><dt>Mobile</dt><dd>{notRecorded(person?.mobile)}</dd></div>
              <div><dt>Phone</dt><dd>{notRecorded(person?.phone)}</dd></div>
              <div className="wide"><dt>Email</dt><dd>{notRecorded(person?.email)}</dd></div>
              <div><dt>Interpreter</dt><dd>{acct ? <Mark tone={acct.interpreterRequired ? "warn" : "no"} /> : null}{acct ? (acct.interpreterRequired ? "Required" : "Not required") : "Not recorded"}</dd></div>
            </dl>
          </section>
          {acct ? <UtilityAccount account={acct} accountNumber={person?.accountNumber ?? null} /> : null}
      </>
    ) },
    { id: "priority", title: fromSignals ? "Priority" : "Model assessment", hint: "How the priority is worked out", body: (
      <>
          <section className="case-card model" aria-labelledby="ov-model">
            {fromSignals ? (
              <h3 id="ov-model">Priority <span className="sim">from signals</span></h3>
            ) : (
              <h3 id="ov-model">Model assessment</h3>
            )}
            {a.status === "ready" && a.priority ? (
              <>
                <p>Priority {a.priority.score}/100 ({a.priority.label}) · trend: {a.trend ?? "unknown"}</p>
                {fromSignals ? (
                  <>
                    <PriorityBreakdownView c={c} data={data} />
                    <p className="hint">A guide for ordering the queue, not a judgement about the customer.</p>
                  </>
                ) : <p className="hint">{a.explanation}</p>}
              </>
            ) : (
              <p>{a.explanation ?? (a.status === "pending" ? "Assessment pending. No priority has been assigned." : "Assessment unavailable. No priority has been assigned.")}</p>
            )}
          </section>
      </>
    ) },
    ...(item.prediction ? [{ id: "hardship", title: "Chance of hardship", hint: "The 90-day risk model: each harm, and what raises the risk", body: (
      <PredictionDetails p={item.prediction} model={null} go={(to) => (e) => { if (isModifiedClick(e)) return; e.preventDefault(); props.navigate?.(to); }} />
    ) }] : []),
    ...(acct ? [{ id: "signals", title: "Account signals", hint: "Warning signs in the account and the weather forecast", body: (
        <AccountSignals account={acct} asOf={data.asOf} weather={item.weatherSignals} summary={props.loadPlan ? <AiPlan kind="signals" caseId={c.id} version={c.version} load={props.loadPlan} /> : null} />
    ) }] : []),
    { id: "support", title: "Support areas and why", hint: `${c.circumstances.length} circumstance${c.circumstances.length === 1 ? "" : "s"} flagged, and what's been reported`, body: (
      <>
          <section className="case-card" aria-labelledby="ov-support">
            <h3 id="ov-support">Support areas and why {fromFlow ? <span className="sim">hardship flow</span> : null}</h3>
            {fromFlow ? (
              <p className="hint">Worked out from account data and survey answers with the Flowchart&apos;s rules: one strong signal, or two supporting ones. Sensitive circumstances need a strong signal.</p>
            ) : null}
            {supportAi ? <AiPlanView kind="support" state={supportAi} /> : null}
            {c.circumstances.length === 0 ? <p className="muted">{fromFlow ? "No circumstances flagged." : "No circumstances flagged from the reported answers."}</p> : null}
            {data.supportAreas.filter((area) => c.supportAreaIds.includes(area.id)).map((area) => (
              <div key={area.id} className="area-block">
                <h4>{area.label}</h4>
                {c.circumstances.filter((x) => data.circumstances.find((d) => d.id === x.circumstanceId)?.supportAreaId === area.id).map((x) => {
                  const def = data.circumstances.find((d) => d.id === x.circumstanceId)!;
                  const recs = c.recommendations.filter((r) => r.circumstanceIds.includes(x.circumstanceId));
                  return (
                    <div key={x.circumstanceId} className={`circ${def.sensitivity === "safety" ? " circ-safety" : ""}`}>
                      <div className="circ-head">
                        <strong>{def.label}</strong>
                        {def.sensitivity && def.sensitivity !== "standard" ? <span className={`sens sens-${def.sensitivity}`}>{def.sensitivity === "safety" ? "Safety" : "Sensitive"}</span> : null}
                      </div>
                      {def.sensitivity === "safety" ? <p className="hint">Never actioned automatically. Route to trained staff.</p> : null}
                      {def.handling ? <p className="hint">{def.handling}</p> : null}
                      {x.signals ? (
                        <>
                        <p className="block-label">Why it&apos;s flagged</p>
                        <ul className="evidence signals">
                          {x.signals.map((sg) => (
                            <li key={sg.id}>
                              <span>{sg.name} <span className="sub">{readableDates(sg.evidence)}</span></span>
                              <span className={`strength strength-${sg.strength}`}>{sg.strength === "strong" ? "Strong" : "Supporting"}</span>
                            </li>
                          ))}
                        </ul>
                        </>
                      ) : (
                        <ul className="evidence">
                          {x.evidenceFieldIds.map((fid) => {
                            const f = field(fid);
                            const ans = answerText(c, fid);
                            return (
                              <li key={fid}>
                                <span>{f?.label ?? fid} <span className="sub">({fid}, {f ? PERIOD_TEXT[f.referencePeriod] : ""}{c.reportedAt ? `, reported ${c.reportedAt}` : ""})</span></span>
                                <span className={`answer answer-${ans.tone}`}>{ans.text}</span>
                              </li>
                            );
                          })}
                        </ul>
                      )}
                      {recs.length ? (
                        <div className="suggest">
                          <span className="sim">{fromFlow ? "Solutions for staff review" : "Suggested for staff review"}</span>
                          <ul className="suggest-list">
                            {recs.map((r) => <li key={r.recommendationId}>{data.recommendations.find((d) => d.id === r.recommendationId)?.label ?? r.recommendationId}</li>)}
                          </ul>
                        </div>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            ))}
          </section>
          <section className="case-card" aria-labelledby="ov-assist">
            <h3 id="ov-assist">Assistance already reported</h3>
            <p className="hint">Separate from support needs. Past support is not a current plan.</p>
            <ul className="evidence">
              <li><span>Hardship program enrolment (at report)</span><span className={`answer answer-${answerText(c, "Q37").tone}`}>{answerText(c, "Q37").text}</span></li>
              <li><span>Energy-bill concession (at report)</span><span className={`answer answer-${answerText(c, "Z7_8").tone}`}>{answerText(c, "Z7_8").text}</span></li>
            </ul>
            <p className="subhead">Reported in the past 12 months</p>
            {history.length ? (
              <ul className="plain">{history.map((h) => <li key={h.evidenceFieldId}>{field(h.evidenceFieldId)?.label ?? h.evidenceFieldId}</li>)}</ul>
            ) : (
              <p className="muted">{c.answerAvailability.Q36b_1 === "unknown" ? "Unknown. Not recorded." : "None reported."}</p>
            )}
          </section>
      </>
    ) },
    ...(fromFlow && c.recommendations.length ? [{ id: "solutions", title: "Solutions to offer", hint: `${c.recommendations.length} to check and offer, in the suggested order`, body: (
          <section className="case-card" aria-labelledby="ov-solutions">
            <h3 id="ov-solutions">Solutions to offer <span className="sim">for staff review</span></h3>
            <p className="hint">What we can offer this customer, or refer them to. Check eligibility before offering.</p>
            {aiOrder ? (
              <div className="order-toggle">
                <span className="hint">Ordered by AI to match the Suggested plan. Check before acting.</span>
              </div>
            ) : null}
            {aiOrder?.some((o) => o.due) ? <SolutionTimeline steps={aiOrder} names={(id) => data.recommendations.find((x) => x.id === id)?.label ?? id} interpreter={!!supportAi?.plan?.interpreter} /> : null}
            <ol className="suggest-list solutions">
              {orderedRecs.map((r, rank) => {
                const step = aiOrder?.find((o) => o.id === r.recommendationId);
                const why = step?.reason;
                const d = data.recommendations.find((x) => x.id === r.recommendationId);
                const forNames = r.circumstanceIds.map((id) => data.circumstances.find((x) => x.id === id)?.label ?? id);
                return (
                  <li key={r.recommendationId} className="solution">
                    <div className="solution-top">
                    <strong>{why ? <span className="rank-num">{rank + 1}</span> : null}{d?.label ?? r.recommendationId}</strong>
                    {why ? <p className="rank-why">{why}</p> : null}
                    {step?.due ? (
                      <p className="rank-when">
                        By <strong>{dueDate(step.due)}</strong>{step.method ? <> · {METHOD_LABEL[step.method]}{supportAi?.plan?.interpreter && step.method === "phone" ? " with an interpreter" : ""}</> : null}
                      </p>
                    ) : null}
                    </div>
                    <dl className="solution-facts">
                      {d?.howToAccess ? <div><dt>What to do</dt><dd>{d.howToAccess}</dd></div> : null}
                      {d?.provider ? <div><dt>Who</dt><dd>{d.provider}</dd></div> : null}
                      {d?.contact ? <div><dt>Contact</dt><dd>{d.contact}</dd></div> : null}
                      {d?.description ? <div><dt>Good to know</dt><dd>{d.description}</dd></div> : null}
                      <div><dt>For</dt><dd>{forNames.join(", ")}</dd></div>
                    </dl>
                    {d?.sourceUrl ? <a className="sub" href={d.sourceUrl} target="_blank" rel="noreferrer">Source{d.verified ? "" : " (not re-checked)"}</a> : null}
                  </li>
                );
              })}
            </ol>
          </section>
    ) }] : []),
    ...(acct ? [
      { id: "bills", title: acct.prepay ? "Prepaid top-ups" : "Bills", hint: acct.prepay ? "Top-ups and self-disconnections" : "Bills, payments and usage", body: <AccountHistory account={acct} asOf={data.asOf} /> },
      { id: "support-history", title: "Support history", hint: "Payment plans, extensions, hardship and concessions", body: <SupportHistory account={acct} /> },
      { id: "supply", title: "Collections and supply", hint: "Notices, collections, disconnections and outages", body: <SupplyAndCollections account={acct} /> },
      { id: "contacts", title: "Contact history", hint: "Calls, messages and what was said", body: <ContactHistory account={acct} /> },
    ] : []),
  ];
  const open = sections.find((x) => x.id === section) ?? null;

  return (
    <article className="case-page" aria-labelledby="case-title">
      <header className="case-head">
        <h1 id="case-title" tabIndex={-1} ref={heading}>{person?.displayName ?? "Unknown person"}</h1>
        <span className="case-meta">{person?.accountNumber ?? "No account number"} · {person?.suburb}, {person?.state} · Assigned to {assignedUser?.displayName ?? c.workflow.assignedToUserId ?? "nobody"}</span>
      </header>

      <CaseGlance item={item} data={data} plan={supportAi?.plan ?? null} planFailed={!!supportAi?.error} onOpen={setSection} client={props.client} />

      <section className="case-more" aria-labelledby="more-title">
        <h2 id="more-title">More about this case</h2>
        <ul className="more-tiles">
          {sections.map((x) => (
            <li key={x.id}>
              <a href={`#${x.id}`} className="more-tile" onClick={(e) => { if (isModifiedClick(e)) return; e.preventDefault(); setSection(x.id); }}>
                <strong>{x.title}</strong><span className="sub">{x.hint}</span>
              </a>
            </li>
          ))}
          {fromFlow && props.client ? (
            <li><button type="button" className="more-tile" onClick={() => setFlowOpen(true)}><strong>Flowchart for this case</strong><span className="sub">Signals seen, circumstances flagged and solutions, on the flowchart</span></button></li>
          ) : null}
        </ul>
      </section>

      {open ? <SectionModal key={open.id} title={open.title} name={person?.displayName ?? ""} onClose={() => setSection(null)}>{open.body}</SectionModal> : null}
      {flowOpen && props.client ? <CaseFlowModal client={props.client} data={data} c={c} person={person ?? null} weather={item.weatherSignals ?? []} onClose={() => setFlowOpen(false)} /> : null}
    </article>
  );
}

/** The open section, kept in the address's #hash so it can be linked to and Back closes it. */
function useSection(): [string | null, (id: string | null) => void] {
  const read = () => decodeURIComponent(window.location.hash.slice(1)) || null;
  const [id, setId] = useState(read);
  const pushed = useRef(false);
  useEffect(() => {
    const sync = () => { pushed.current = false; setId(read()); };
    window.addEventListener("popstate", sync);
    return () => window.removeEventListener("popstate", sync);
  }, []);
  const set = (next: string | null) => {
    if (next) {
      window.history.pushState(null, "", `${window.location.pathname}#${encodeURIComponent(next)}`);
      pushed.current = true;
    } else if (pushed.current) {
      window.history.back(); // the popstate listener clears it
      return;
    } else {
      window.history.replaceState(null, "", window.location.pathname);
    }
    setId(next);
  };
  return [id, set];
}

/** One section of the case in a modal dialog. Escape, the Close button or a click outside closes it. */
function SectionModal({ title, name, onClose, children }: { title: string; name: string; onClose: () => void; children: React.ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (d && !d.open) d.showModal();
  }, []);
  return (
    <dialog
      ref={ref} className="case-modal" aria-labelledby="case-modal-title"
      onCancel={(e) => { e.preventDefault(); onClose(); }}
      onClick={(e) => { if (e.target === ref.current) onClose(); }}
    >
      <header className="case-modal-head">
        <div><p className="eyebrow">{name}</p><h2 id="case-modal-title">{title}</h2></div>
        <button type="button" className="btn" onClick={onClose}>Close</button>
      </header>
      <div className="case-modal-body">{children}</div>
    </dialog>
  );
}

/** The AI-drafted plan (Claude or Gemini), fetched when the case opens and again whenever the case changes. */
const AI_TITLE: Record<PlanKind, string> = { support: "Suggested plan", signals: "What the signals say" };
const METHOD_LABEL: Record<ContactMethod, string> = { phone: "Phone call", sms: "SMS", email: "Email", letter: "Letter" };
const dueDate = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-AU", { weekday: "short", day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

const AI_LOADING: Record<PlanKind, string> = { support: "Drafting a support plan…", signals: "Summarising the signals…" };
const AI_SOURCE: Record<PlanKind, string> = { support: "circumstances, signals and solutions below", signals: "account signals below" };

type AiState = { plan?: SupportPlan; error?: string; loading: boolean };

/** Fetches one AI summary when the case opens and again whenever the case changes. */
function useAiPlan(kind: PlanKind, caseId: string, version: number, load?: (caseId: string, kind?: PlanKind) => Promise<SupportPlan>): AiState | null {
  const [state, setState] = useState<AiState>({ loading: true });
  useEffect(() => {
    if (!load) return;
    let live = true;
    setState({ loading: true });
    load(caseId, kind).then((plan) => live && setState({ plan, loading: false }), (e: unknown) => live && setState({ error: e instanceof Error ? e.message : "Could not draft a plan.", loading: false }));
    return () => { live = false; };
  }, [kind, caseId, version, load]);
  return load ? state : null;
}

function AiPlan(props: { kind: PlanKind; caseId: string; version: number; load: (caseId: string, kind?: PlanKind) => Promise<SupportPlan> }) {
  const state = useAiPlan(props.kind, props.caseId, props.version, props.load)!;
  return <AiPlanView kind={props.kind} state={state} />;
}

function AiPlanView({ kind, state }: { kind: PlanKind; state: AiState }) {
  return (
    <div className="ai-plan" aria-live="polite">
      <p className="block-label">{AI_TITLE[kind]} <span className="sim">AI summary · check before acting</span></p>
      {state.loading ? <p className="muted">{AI_LOADING[kind]}</p> : state.error ? <p className="muted">{state.error}</p> : <>{paragraphs(state.plan!.text).map((t, i) => <p key={i}>{t}</p>)}</>}
      {state.plan ? <p className="hint">Summarised by {state.plan.model} from the {AI_SOURCE[kind]}. No name or contact details were sent.</p> : null}
    </div>
  );
}

/** The AI order's steps by date: each day once, with what to offer and how to get in touch. */
function SolutionTimeline({ steps, names, interpreter }: { steps: PlanStep[]; names: (id: string) => string; interpreter: boolean }) {
  const dated = steps.map((s, rank) => ({ ...s, rank })).filter((s) => s.due).sort((a, b) => a.due!.localeCompare(b.due!) || a.rank - b.rank);
  const days = [...new Set(dated.map((s) => s.due!))];
  return (
    <div className="timeline">
      <p className="block-label">Timeline <span className="sim">AI summary · check before acting</span></p>
      <ol className="tl-days">
        {days.map((day) => (
          <li key={day} className="tl-day">
            <span className="tl-date">{dueDate(day)}</span>
            <ul className="tl-steps">
              {dated.filter((s) => s.due === day).map((s) => (
                <li key={s.id}>
                  <span className="tl-name">{names(s.id)}</span>
                  {s.method ? <span className="tl-method">{METHOD_LABEL[s.method]}{interpreter && s.method === "phone" ? " with an interpreter" : ""}</span> : null}
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ol>
    </div>
  );
}
