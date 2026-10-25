import { POSTCODE_LOCATION, SUPPORT_URGENCY, emptySupportCounts, primarySupportGroup, supportUrgency, type SupportGroupId, type SupportUrgency } from "@greenspark/shared";
import type { OutlookCustomer } from "../data/api";

export interface SupportArea {
  id: string; postcode: string; suburb: string; lat: number; lng: number;
  group?: SupportGroupId;
  customers: OutlookCustomer[]; count: number; urgency: SupportUrgency;
  act: number; watch: number; monitor: number;
  groups: Record<SupportGroupId, number>;
}
export type MapRegion = "perth" | "southwest" | "wa";
export const REGION_LABEL = { perth: "Perth & Peel", southwest: "South West", wa: "All of WA" } as const;

export function customerOnDate(customer: OutlookCustomer, date: string): OutlookCustomer {
  if (!date) return customer;
  const day = customer.daily?.find((d) => d.date === date);
  // A missing daily forecast is unavailable, rather than carrying a week-wide urgent tier into that day.
  return { ...customer, tier: day?.tier ?? null, exposure: day?.exposure ?? 0, score: day?.score ?? 0 };
}
export const groupOf = (customer: OutlookCustomer): SupportGroupId => customer.group ?? primarySupportGroup(customer.sensitivity);
export function inMapRegion(customer: Pick<OutlookCustomer, "location" | "postcode">, region: MapRegion): boolean {
  if (region === "wa") return true;
  const at = customer.location ?? (customer.postcode ? POSTCODE_LOCATION[customer.postcode] : undefined);
  if (!at) return false;
  return region === "perth" ? at[0] <= -31.4 && at[0] >= -32.8 && at[1] >= 115 && at[1] <= 116.6
    : at[0] <= -31.4 && at[0] >= -35.3 && at[1] >= 114.8 && at[1] <= 119;
}

/** One marker per postcode in the selected group(s); count each customer once. */
export function supportAreas(customers: OutlookCustomer[], separateGroups = false): { areas: SupportArea[]; unplaced: number } {
  const byPostcode = new Map<string, SupportArea>();
  const seen = new Set<string>();
  let unplaced = 0;
  for (const customer of customers) {
    if (seen.has(customer.personId)) continue;
    seen.add(customer.personId);
    const postcode = customer.postcode;
    const at = customer.location ?? (postcode ? POSTCODE_LOCATION[postcode] : undefined);
    if (!postcode || !at) { unplaced++; continue; }
    const group = groupOf(customer), key = separateGroups ? `${postcode}:${group}` : postcode;
    let area = byPostcode.get(key);
    if (!area) {
      area = { id: key, postcode, suburb: customer.suburb, lat: at[0], lng: at[1], ...(separateGroups ? { group } : {}), customers: [], count: 0, urgency: "monitor", act: 0, watch: 0, monitor: 0, groups: emptySupportCounts() };
      byPostcode.set(key, area);
    }
    area.customers.push(customer);
    area.count++;
    area.groups[groupOf(customer)]++;
    if (customer.tier === "act") area.act++;
    else if (customer.tier === "watch") area.watch++;
    else area.monitor++;
    // Never average away one urgent customer in a large group.
    const urgency = supportUrgency(customer.tier);
    if (SUPPORT_URGENCY[urgency].rank > SUPPORT_URGENCY[area.urgency].rank) area.urgency = urgency;
  }
  const areas = [...byPostcode.values()].sort((a, b) => SUPPORT_URGENCY[b.urgency].rank - SUPPORT_URGENCY[a.urgency].rank || b.act - a.act || b.count - a.count || a.suburb.localeCompare(b.suburb));
  for (const area of areas) area.customers.sort((a, b) => SUPPORT_URGENCY[supportUrgency(b.tier)].rank - SUPPORT_URGENCY[supportUrgency(a.tier)].rank || b.score - a.score);
  return { areas, unplaced };
}

export function heatWarningActive(expires: string | null, date: string): boolean {
  return !expires || Date.parse(expires) > Date.parse(`${date}T00:00:00+08:00`);
}

export interface SupportAreaCluster extends SupportArea { parts: SupportArea[] }

/** Regional overview only. Zooming into the metro view restores each original postcode. */
export function regionalSupportAreas(areas: SupportArea[], zoom: number): SupportAreaCluster[] {
  if (zoom >= 8.5) return areas.map((area) => ({ ...area, parts: [area] }));
  const cellSize = zoom < 5 ? 2 : zoom < 7 ? 0.5 : 0.2;
  const cells = new Map<string, SupportArea[]>();
  for (const area of areas) {
    const key = `${area.group ?? "all"}:${Math.floor(area.lat / cellSize)}:${Math.floor(area.lng / cellSize)}`;
    cells.set(key, [...(cells.get(key) ?? []), area]);
  }
  return [...cells].map(([key, parts]) => {
    if (parts.length === 1) return { ...parts[0]!, parts };
    const customers = parts.flatMap((area) => area.customers), count = customers.length;
    const groups = emptySupportCounts();
    for (const area of parts) for (const id of Object.keys(groups) as SupportGroupId[]) groups[id] += area.groups[id];
    const urgency = parts.reduce<SupportUrgency>((highest, area) => SUPPORT_URGENCY[area.urgency].rank > SUPPORT_URGENCY[highest].rank ? area.urgency : highest, "monitor");
    return { id: `region:${key}`, postcode: "", suburb: `${parts.length} postcode areas`, group: parts[0]!.group, count, customers, groups, urgency, parts,
      lat: parts.reduce((sum, area) => sum + area.lat * area.count, 0) / count,
      lng: parts.reduce((sum, area) => sum + area.lng * area.count, 0) / count,
      act: parts.reduce((sum, area) => sum + area.act, 0), watch: parts.reduce((sum, area) => sum + area.watch, 0), monitor: parts.reduce((sum, area) => sum + area.monitor, 0) };
  });
}
