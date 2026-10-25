import { useMemo } from "react";
import type { SupportGroupId } from "@greenspark/shared";
import type { Outlook, OutlookCustomer } from "../data/api";
import { customerOnDate, groupOf, inMapRegion, REGION_LABEL, type MapRegion } from "../domain/supportGroups";
import { dayDate, dayName, tempColor } from "./outlookText";

/** Counts are recomputed from daily records, never reused from the weekly worst case. */
export function SupportWeek({ data, region, groups, date, onDate }: {
  data: Extract<Outlook, { available: true }>; region: MapRegion; groups: SupportGroupId[];
  date: string; onDate: (date: string) => void;
}) {
  const days = useMemo(() => {
    const people = [...new Map((data.groupCustomers ?? data.customers).filter((c) => inMapRegion(c, region) && groups.includes(groupOf(c))).map((c) => [c.personId, c])).values()];
    const towns = data.towns.filter((t) => inMapRegion({ location: [t.lat, t.lng], postcode: null }, region));
    return data.days.map(({ date }) => {
      const rows: OutlookCustomer[] = people.map((c) => customerOnDate(c, date));
      const peak = towns.flatMap((t) => t.days.filter((d) => d.date === date && d.max !== null).map((d) => ({ town: t.name, max: d.max! }))).sort((a, b) => b.max - a.max)[0];
      return { date, peak, act: rows.filter((c) => c.tier === "act").length, watch: rows.filter((c) => c.tier === "watch").length, exposed: rows.filter((c) => c.exposure > 0).length };
    });
  }, [data, region, groups]);
  const largest = Math.max(1, ...days.map((d) => d.act + d.watch));
  return <section className="panel support-week" aria-label="The week ahead">
    <div className="support-week-heading"><div><h2>The week ahead</h2><p>{REGION_LABEL[region]} · selected support groups · before attention filters</p></div><button type="button" className="btn btn-small" aria-pressed={!date} onClick={() => onDate("")}>Whole week</button></div>
    <div className="support-week-days">{days.map((d) => <button key={d.date} type="button" className={`support-day${date === d.date ? " is-selected" : ""}`} aria-pressed={date === d.date} onClick={() => onDate(d.date)} data-date={d.date}>
      <span className="support-day-date"><strong>{d.date === data.today ? "Today" : dayName(d.date)}</strong> {dayDate(d.date)}</span>
      <strong className="support-day-temperature" style={tempColor(d.peak?.max ?? null)}>{d.peak ? `${d.peak.max}°C` : "No forecast"}</strong>
      <span className="support-day-town">{d.peak?.town ?? "No town forecast in this region"}</span>
      <span className="support-day-counts"><span><small>Act now</small><b>{d.act.toLocaleString("en-AU")}</b></span><span><small>Watch</small><b>{d.watch.toLocaleString("en-AU")}</b></span></span>
      <span className="support-day-bar" aria-hidden="true"><i style={{ width: `${d.act / largest * 100}%` }} /><i style={{ width: `${d.watch / largest * 100}%` }} /></span>
      <small className="support-day-exposed">{d.exposed.toLocaleString("en-AU")} exposed</small>
    </button>)}</div>
    <p className="support-week-note">Highest forecast town temperature in the region. Select a day to update customer attention and the map; emergency warnings show current conditions.</p>
  </section>;
}
