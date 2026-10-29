import { SUPPORT_GROUPS, supportGroupNeeds, type SupportGroupId } from "@greenspark/shared";
import type { OutlookCustomer } from "../data/api";
import { groupOf } from "./supportGroups";

export { SOLUTIONS, type SolutionId } from "@greenspark/shared";
import { NEED_SOLUTIONS, groupIn, type SolutionId } from "@greenspark/shared";
export const needsOf = (customer: OutlookCustomer): SupportGroupId[] => customer.supportNeeds ?? [...new Set([groupOf(customer), ...supportGroupNeeds(customer.sensitivity)].filter((id): id is SupportGroupId => id !== null))];
export function solutionsFor(customer: OutlookCustomer): SolutionId[] {
  return [...new Set(needsOf(customer).flatMap((need) => NEED_SOLUTIONS[need]))];
}
export interface SolutionEntry { id: SolutionId; customers: OutlookCustomer[]; groups: SupportGroupId[] }

/** Deduplicate by customer and exact solution, preserving each person's primary map group. */
export function buildSolutionPlan(customers: OutlookCustomer[], selected: SupportGroupId[]) {
  const unique = [...new Map(customers.filter((c) => groupIn(selected, groupOf(c))).map((c) => [c.personId, c])).values()];
  const entries = new Map<SolutionId, SolutionEntry>();
  for (const customer of unique) for (const id of solutionsFor(customer)) {
    const entry = entries.get(id) ?? { id, customers: [], groups: [] };
    entry.customers.push(customer);
    const group = groupOf(customer);
    if (group && !entry.groups.includes(group)) entry.groups.push(group);
    entries.set(id, entry);
  }
  const all = [...entries.values()];
  return {
    shared: all.filter((entry) => entry.groups.length > 1),
    cards: selected.map((id) => {
      const members = unique.filter((c) => groupOf(c) === id);
      return { definition: SUPPORT_GROUPS.find((group) => group.id === id)!, members,
        own: all.filter((entry) => entry.groups.length === 1 && entry.groups[0] === id),
        shared: all.filter((entry) => entry.groups.length > 1 && entry.groups.includes(id)),
        secondary: SUPPORT_GROUPS.filter((group) => group.id !== id).flatMap((group) => {
          const count = members.filter((c) => needsOf(c).includes(group.id)).length;
          return count ? [{ ...group, count }] : [];
        }),
      };
    }),
  };
}
