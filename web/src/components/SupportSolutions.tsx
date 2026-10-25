import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { SUPPORT_GROUPS, SUPPORT_GROUP_COLORS, type SupportGroupId } from "@greenspark/shared";
import type { OutlookCustomer } from "../data/api";
import { buildSolutionPlan, SOLUTIONS, type SolutionEntry } from "../domain/supportSolutions";

const styleFor = (id: SupportGroupId): CSSProperties => ({ "--group-strong": SUPPORT_GROUP_COLORS[id].strong, "--group-light": SUPPORT_GROUP_COLORS[id].light, "--group-ink": SUPPORT_GROUP_COLORS[id].ink }) as CSSProperties;
function GroupBadge({ id }: { id: SupportGroupId }) {
  const group = SUPPORT_GROUPS.find((item) => item.id === id)!;
  return <span className="solution-group-badge" style={styleFor(id)} title={group.label}>{group.letter}</span>;
}
function Solution({ entry, shared = false }: { entry: SolutionEntry; shared?: boolean }) {
  const solution = SOLUTIONS[entry.id];
  return <section className={`solution-entry${shared ? " shared-solution-entry" : ""}`} data-solution-id={entry.id} id={shared ? `shared-solution-${entry.id}` : undefined}>
    <h4>{solution.title}</h4>
    {shared ? <div className="solution-shared-groups">{entry.groups.map((id) => <GroupBadge key={id} id={id} />)}<span>{entry.customers.length.toLocaleString("en-AU")} unique customers</span></div> : <small>{entry.customers.length.toLocaleString("en-AU")} customers</small>}
    <p>{solution.steps}</p><p className="solution-confirm"><strong>Confirm:</strong> {solution.confirm}</p>
  </section>;
}

export function SupportSolutions({ customers, groups, period, focusGroup }: { customers: OutlookCustomer[]; groups: SupportGroupId[]; period: string; focusGroup: SupportGroupId | null }) {
  const plan = useMemo(() => buildSolutionPlan(customers, groups), [customers, groups]);
  const [expanded, setExpanded] = useState<SupportGroupId | null>(groups.at(-1) ?? null);
  const key = groups.join("|");
  useEffect(() => { setExpanded(groups.at(-1) ?? null); }, [key]);
  useEffect(() => { if (focusGroup) setExpanded(focusGroup); }, [focusGroup]);
  return <div className="support-solution-stack">
    {plan.shared.length ? <details className="shared-solutions"><summary>Shared solutions <span>{plan.shared.length}</span></summary><div className="solution-shared-groups">{groups.filter((id) => plan.shared.some((entry) => entry.groups.includes(id))).map((id) => <GroupBadge key={id} id={id} />)}<span>Shown once across these groups</span></div><p className="sub">One assessment per customer and solution, across the groups shown.</p>{plan.shared.map((entry) => <Solution key={entry.id} entry={entry} shared />)}</details> : null}
    {plan.cards.map(({ definition, members, own, shared, secondary }) => {
      const act = members.filter((c) => c.tier === "act").length, watch = members.filter((c) => c.tier === "watch").length;
      const open = expanded === definition.id;
      return <section key={definition.id} className="support-solution-card" style={styleFor(definition.id)} data-group={definition.id}>
        <button className="solution-card-heading" type="button" aria-expanded={open} aria-controls={`solutions-${definition.id}`} onClick={() => setExpanded(open ? null : definition.id)}>
          <GroupBadge id={definition.id} /><span><strong>{definition.label}</strong><small>{members.length.toLocaleString("en-AU")} customers · {act ? `${act} urgent` : watch ? `${watch} review soon` : "monitor"}</small><span className="solution-card-preview">{members.length ? definition.action : "No customers in this group for the selected area and filters."}</span></span><span aria-hidden="true">{open ? "−" : "+"}</span>
        </button>
        <div id={`solutions-${definition.id}`} hidden={!open} className="solution-card-body">
          {!members.length ? <p>No customers in this group for the selected area and filters.</p> : <>
            <p className="solution-reason">{definition.reason}</p>
            <p className="solution-timing">{act ? "Priority review before the forecast event" : watch ? "Arrange a review before the relevant forecast day" : "Check needs and agree a follow-up"} · {period}</p>
            {own.slice(0, 3).map((entry) => <Solution key={entry.id} entry={entry} />)}
            {own.length > 3 ? <details className="solution-more"><summary>More support steps ({own.length - 3})</summary>{own.slice(3).map((entry) => <Solution key={entry.id} entry={entry} />)}</details> : null}
            {shared.length ? <div className="solution-shared-links"><strong>Shared support above</strong>{shared.map((entry) => <a key={entry.id} href={`#shared-solution-${entry.id}`} onClick={(event) => {
              event.preventDefault(); const target = document.getElementById(`shared-solution-${entry.id}`); const details = target?.closest("details"); if (details) details.open = true; target?.scrollIntoView({ behavior: "smooth", block: "nearest" });
            }}>{SOLUTIONS[entry.id].title}</a>)}</div> : null}
            {secondary.length ? <p className="solution-secondary"><strong>Also recorded:</strong> {secondary.map((item) => `${item.label} (${item.count})`).join(" · ")}</p> : null}
          </>}
        </div>
      </section>;
    })}
    {!groups.length ? <p className="hint">Turn on a group filter to see its solutions.</p> : null}
  </div>;
}
