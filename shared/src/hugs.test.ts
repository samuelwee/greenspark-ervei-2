import { describe, expect, it } from "vitest";
import { financialYear, hugsEligibility, recommendationEligibility } from "./hugs";
import type { CustomerAccount } from "./types";

const asOf = "2026-10-16";

/** A quiet account to change one thing at a time in the rule tests. */
function account(patch: Partial<CustomerAccount> = {}): CustomerAccount {
  return {
    sourceCustomerId: "C1", utility: "electricity", retailer: "Synergy", region: { name: "Perth metro", climateZone: "perth", northOf26th: false },
    customerSince: "2020-01-01", dateOfBirth: "1970-01-01", supplyStatus: "connected",
    plan: { type: "postpaid", tariff: "A1", name: "Home Plan (A1)", billingCycle: "bimonthly" }, meterType: "advanced", solar: null, paymentMethod: "bpay",
    concession: { status: "none", endDate: null }, medicalCoolingSubsidy: false, thirdPartyAuthority: null, lifeSupport: false, lifeSupportSince: null, interpreterRequired: false,
    contactPreferences: { preferredChannel: "email", smsOptIn: true, emailOptIn: true, doNotCall: false, proactiveSupportConsent: "not_asked", onlineAccountActive: true },
    hardshipProgram: { status: "none", exitReason: null, assessedAt: null }, hardshipHistory: [], paymentPlan: null, paymentPlans: [], extensions: [], hugsGrants: [], interventions: [],
    bills: [], payments: [], usage: [], monthly: [], prepay: null, contacts: [], collectionEvents: [], disconnections: [], outages: [],
    communications: { lastOpenedAt: "2026-10-01", undelivered: [] },
    ...patch,
  };
}
const owingBills = (amount: number) => [{
  id: "b1", periodStart: "2026-04-01", periodEnd: "2026-05-31", issuedAt: "2026-06-01", dueAt: "2026-07-01", originalDueAt: "2026-07-01", dueDateExtended: false,
  usageKwh: 500, usageKwhLastYear: null, charges: { usage: 200, supply: 80, feedInCredit: 0, concessionCredit: 0, govtCredit: 0 },
  amount, amountPaid: 0, paidInFullAt: null, paidOnTime: false, finalBill: false, openingBalance: false,
}];
const criterion = (r: ReturnType<typeof hugsEligibility>, id: string) => r.criteria.find((c) => c.id === id)!;

describe("financialYear", () => {
  it("runs 1 July to 30 June", () => {
    expect(financialYear("2026-10-16")).toEqual({ start: "2026-07-01", end: "2027-06-30" });
    expect(financialYear("2027-02-01")).toEqual({ start: "2026-07-01", end: "2027-06-30" });
    expect(financialYear("2026-07-01")).toEqual({ start: "2026-07-01", end: "2027-06-30" });
    expect(financialYear("2027-06-30")).toEqual({ start: "2026-07-01", end: "2027-06-30" });
  });
});

describe("hugsEligibility", () => {
  it("meets all the recorded criteria", () => {
    const r = hugsEligibility(account({
      paymentPlans: [{ status: "completed", startedAt: "2026-05-01", endedAt: "2026-08-15", amount: 500, instalment: 80, instalments: 7, trigger: "after_warning" }],
      collectionEvents: [{ date: "2026-09-01", action: "disconnection_warning", overdue: 500 }],
      bills: owingBills(400),
    }), asOf);
    expect(r.recommendationId).toBe("hugs");
    expect(r.meets).toBe(true);
    expect(r.criteria.every((c) => c.met)).toBe(true);
  });

  it("counts a payment plan kept for 90 days, whether completed, still active, or broken after 90 days", () => {
    const kept = (status: "completed" | "active" | "broken", endedAt: string | null) => hugsEligibility(account({
      paymentPlans: [{ status, startedAt: "2026-06-01", endedAt, amount: 500, instalment: 80, instalments: 7, trigger: "after_warning" }],
      collectionEvents: [{ date: "2026-09-01", action: "disconnection_warning", overdue: 500 }],
      bills: owingBills(400),
    }), asOf);
    expect(kept("completed", "2026-09-01").meets).toBe(true); // 92 days kept
    expect(kept("active", null).meets).toBe(true); // still running, 137 days in
    expect(kept("broken", "2026-11-01").meets).toBe(true); // broken after 92 days
    expect(criterion(kept("broken", "2026-06-15"), "payment_plan_90_days").met).toBe(false); // broken after 14 days
  });

  it("does not meet without a payment plan", () => {
    const r = hugsEligibility(account({
      collectionEvents: [{ date: "2026-09-01", action: "disconnection_warning", overdue: 500 }],
      bills: owingBills(400),
    }), asOf);
    expect(r.meets).toBe(false);
    expect(criterion(r, "payment_plan_90_days")).toEqual(expect.objectContaining({ met: false, evidence: "No payment plan on the account" }));
  });

  it("counts a disconnection warning or a disconnection, quoting the latest", () => {
    const warning = hugsEligibility(account({
      paymentPlans: [{ status: "completed", startedAt: "2026-05-01", endedAt: "2026-08-15", amount: 500, instalment: 80, instalments: 7, trigger: "after_warning" }],
      collectionEvents: [{ date: "2026-09-01", action: "disconnection_warning", overdue: 500 }],
      bills: owingBills(400),
    }), asOf);
    expect(criterion(warning, "disconnection_warning_or_disconnection").evidence).toBe("disconnection warning on 2026-09-01");
    const cut = hugsEligibility(account({
      paymentPlans: [{ status: "completed", startedAt: "2026-05-01", endedAt: "2026-08-15", amount: 500, instalment: 80, instalments: 7, trigger: "after_warning" }],
      collectionEvents: [{ date: "2026-08-01", action: "disconnection_warning", overdue: 500 }],
      disconnections: [{ date: "2026-09-10", overdue: 500, reconnectedAt: null }],
      bills: owingBills(400),
    }), asOf);
    expect(cut.meets).toBe(true);
    expect(criterion(cut, "disconnection_warning_or_disconnection").evidence).toBe("disconnection on 2026-09-10");
    const none = hugsEligibility(account({
      paymentPlans: [{ status: "completed", startedAt: "2026-05-01", endedAt: "2026-08-15", amount: 500, instalment: 80, instalments: 7, trigger: "after_warning" }],
      collectionEvents: [{ date: "2026-09-01", action: "reminder_notice", overdue: 500 }],
      bills: owingBills(400),
    }), asOf);
    expect(none.meets).toBe(false);
    expect(criterion(none, "disconnection_warning_or_disconnection").met).toBe(false);
  });

  it("needs at least $300 owing", () => {
    const base: Partial<CustomerAccount> = {
      paymentPlans: [{ status: "completed", startedAt: "2026-05-01", endedAt: "2026-08-15", amount: 500, instalment: 80, instalments: 7, trigger: "after_warning" }],
      collectionEvents: [{ date: "2026-09-01", action: "disconnection_warning", overdue: 500 }],
    };
    expect(hugsEligibility(account({ ...base, bills: owingBills(300) }), asOf).meets).toBe(true);
    const under = hugsEligibility(account({ ...base, bills: owingBills(299.99) }), asOf);
    expect(under.meets).toBe(false);
    expect(criterion(under, "owing_at_least_300").evidence).toBe("Owing $299.99");
  });

  it("does not meet when a HUGS benefit was paid this financial year, but does when it was paid before", () => {
    const base: Partial<CustomerAccount> = {
      paymentPlans: [{ status: "completed", startedAt: "2026-05-01", endedAt: "2026-08-15", amount: 500, instalment: 80, instalments: 7, trigger: "after_warning" }],
      collectionEvents: [{ date: "2026-09-01", action: "disconnection_warning", overdue: 500 }],
      bills: owingBills(400),
    };
    const thisFy = hugsEligibility(account({ ...base, hugsGrants: [{ appliedAt: "2026-08-08", paidAt: "2026-08-29", debt: 738.91, amount: 628.07, outcome: "approved" }] }), asOf);
    expect(thisFy.meets).toBe(false);
    expect(criterion(thisFy, "no_hugs_this_financial_year").evidence).toBe("HUGS benefit paid on 2026-08-29");
    const priorFy = hugsEligibility(account({ ...base, hugsGrants: [{ appliedAt: "2025-11-13", paidAt: "2025-12-04", debt: 809.02, amount: 640, outcome: "approved" }] }), asOf);
    expect(priorFy.meets).toBe(true);
  });

  it("does not count declined or unpaid applications as received benefits", () => {
    const base: Partial<CustomerAccount> = {
      paymentPlans: [{ status: "completed", startedAt: "2026-05-01", endedAt: "2026-08-15", amount: 500, instalment: 80, instalments: 7, trigger: "after_warning" }],
      collectionEvents: [{ date: "2026-09-01", action: "disconnection_warning", overdue: 500 }],
      bills: owingBills(400),
    };
    const declined = hugsEligibility(account({ ...base, hugsGrants: [{ appliedAt: "2026-08-08", paidAt: null, debt: 738.91, amount: 0, outcome: "declined" }] }), asOf);
    expect(declined.meets).toBe(true);
    const unpaid = hugsEligibility(account({ ...base, hugsGrants: [{ appliedAt: "2026-08-08", paidAt: null, debt: 738.91, amount: 628.07, outcome: "approved" }] }), asOf);
    expect(unpaid.meets).toBe(true);
  });
});

describe("recommendationEligibility", () => {
  it("checks HUGS only", () => {
    const a = account();
    expect(recommendationEligibility("hugs", a, asOf)).not.toBeNull();
    expect(recommendationEligibility("hardship", a, asOf)).toBeNull();
  });
});
