export type Role = "manager" | "support_worker";
export type CaseStatus = "new" | "in_progress" | "waiting" | "resolved";
export type ReviewStatus = "needs_review" | "reviewed";
export type PriorityLabel = "urgent" | "high" | "moderate" | "routine";
export type AssessmentStatus = "ready" | "pending" | "unavailable";
export type AnswerAvailability = "recorded" | "not_asked" | "unknown";

export interface StaffUser {
  id: string;
  displayName: string;
  role: Role;
}

export interface SupportArea {
  id: string;
  label: string;
  circumstanceIds: string[];
}

export interface CircumstanceDefinition {
  id: string;
  label: string;
  supportAreaId: string;
  evidenceFieldIds: string[];
  recommendationIds: string[];
  illustrativeRule: string;
  // Set when the definition comes from the flowchart.
  sensitivity?: "standard" | "sensitive" | "safety";
  type?: string;
  handling?: string | null;
}

export interface EvidenceFieldDefinition {
  id: string;
  label: string;
  allowedValues: string[];
  referencePeriod: "past_6_months" | "past_12_months" | "at_report";
}

export interface RecommendationDefinition {
  id: string;
  label: string;
  description: string;
  // Set when the recommendation is a solution from the flowchart.
  provider?: string;
  howToAccess?: string;
  contact?: string;
  sourceUrl?: string | null;
  verified?: boolean;
  lastVerified?: string | null;
}

export interface Person {
  id: string;
  displayName: string;
  suburb: string;
  state: string;
  householdSummary: string;
  contactPreference: { channel: string; preferredWindow: string; provenance: string } | null;
  fullProfilePath: string | null;
  // Fictional contact details. Missing means "not recorded", never "none"; people added in the queue start without them.
  gender?: string | null;
  preferredName?: string | null;
  address?: { line1: string; line2: string | null; postcode: string } | null;
  mobile?: string | null;
  phone?: string | null;
  email?: string | null;
  /** The customer's main ID on screen (fictional, DEMO-7xxxxx). Every person has one, including people added in the queue. */
  accountNumber?: string | null;
  // Utility account, from the synthetic WA utility dataset (data/synthetic/utility-accounts.v1.json).
  // Missing for people added in the queue. The server keeps accounts apart and sends them only with one case.
  account?: CustomerAccount | null;
  /** What the account says, worked out once when it is stored, so the queue never needs the account itself. */
  signalSummary?: AccountSignalSummary | null;
}

/** The signals an account raises, in the order caseSignals uses them, plus the facts weather signals need. */
export interface AccountSignalSummary {
  /** From the account rules (accountSignals.ts). */
  account: { id: string; evidence: string }[];
  /** Account facts and what the customer said in transcripts (self-report signals), newest first. */
  selfReport: { id: string; evidence: string }[];
  northOf26th: boolean;
}

export type PaymentMethod = "direct_debit" | "card" | "bpay" | "centrepay" | "cash_counter" | "prepay_topup" | "hugs_grant" | "write_off";
export type PaymentKind = "bill_payment" | "hardship_instalment" | "plan_instalment" | "final_payment" | "hugs_grant" | "reconnection_payment" | "debt_write_off";

export interface Bill {
  id: string;
  /** Null for the opening-balance bill that carries arrears from before the data starts. */
  periodStart: string | null;
  periodEnd: string | null;
  issuedAt: string;
  dueAt: string;
  originalDueAt: string;
  dueDateExtended: boolean;
  usageKwh: number | null;
  /** kWh for the same period a year earlier, when the data covers it. */
  usageKwhLastYear: number | null;
  charges: { usage: number; supply: number; feedInCredit: number; concessionCredit: number; govtCredit: number } | null;
  /** Amount due after credits. */
  amount: number;
  amountPaid: number;
  paidInFullAt: string | null;
  paidOnTime: boolean;
  finalBill: boolean;
  openingBalance: boolean;
}

export interface Payment { date: string; amount: number; method: PaymentMethod; kind: PaymentKind; status: "cleared" | "dishonoured" }

export interface AccountContact {
  id: string;
  date: string;
  channel: string;
  direction: "inbound" | "outbound";
  reason: string;
  outcome: string;
  sentiment: number | null;
  complaint: boolean;
  complaintCategory: string | null;
  repeatWithin7d: boolean;
  notes: string;
  transcript: { speaker: "agent" | "customer"; text: string }[] | null;
}

export interface PaymentArrangement {
  status: "active" | "broken" | "completed" | "closed_account" | "transferred_to_hardship";
  startedAt: string;
  endedAt: string | null;
  amount: number;
  instalment: number;
  instalments: number;
  trigger: string;
}

export interface HardshipRecord {
  assessedAt: string;
  trigger: string;
  outcome: "accepted" | "denied";
  startedAt: string | null;
  instalment: number | null;
  exitedAt: string | null;
  exitReason: string | null;
  debtAtEntry: number | null;
  writeOff: number;
  financialCounsellingReferral: boolean;
  energyEfficiencyAdvice: boolean;
}

export interface CustomerAccount {
  /** The customer's ID in the source dataset (internal; never shown). */
  sourceCustomerId: string;
  utility: "electricity";
  retailer: string;
  region: { name: string; climateZone: string; northOf26th: boolean };
  customerSince: string;
  dateOfBirth: string;
  supplyStatus: "connected" | "disconnected";
  plan: { type: "postpaid" | "prepaid"; tariff: string; name: string; billingCycle: "bimonthly" | null };
  meterType: string;
  solar: { kw: number } | null;
  paymentMethod: PaymentMethod;
  concession: { status: "active" | "lapsed" | "none"; endDate: string | null };
  medicalCoolingSubsidy: boolean;
  thirdPartyAuthority: { type: string; name: string | null; since: string | null } | null;
  lifeSupport: boolean;
  lifeSupportSince: string | null;
  interpreterRequired: boolean;
  contactPreferences: {
    preferredChannel: string; smsOptIn: boolean; emailOptIn: boolean; doNotCall: boolean;
    proactiveSupportConsent: "yes" | "no" | "not_asked"; onlineAccountActive: boolean;
  };
  hardshipProgram: { status: "none" | "active" | "exited"; exitReason: string | null; assessedAt: string | null };
  hardshipHistory: HardshipRecord[];
  /** The latest payment plan, and every plan. */
  paymentPlan: PaymentArrangement | null;
  paymentPlans: PaymentArrangement[];
  extensions: { requestedAt: string; amount: number; until: string | null }[];
  hugsGrants: { appliedAt: string; paidAt: string | null; debt: number; amount: number; outcome: "approved" | "declined" }[];
  interventions: { date: string; type: string; trigger: string; offeredBy: string; accepted: boolean | null; detail: string | null }[];
  bills: Bill[];
  payments: Payment[];
  /** Usage by month, from daily meter data. */
  usage: { month: string; kWh: number; kWhLastYear: number | null; exportKwh: number; exportKwhLastYear: number | null; outageHours: number; disconnectedDays: number }[];
  /** Account position at each month end (no outcome labels). */
  monthly: { date: string; balance: number; overdue: number; daysOverdueOldest: number; concessionActive: boolean }[];
  prepay: {
    creditNow: number;
    recharges: { date: string; amount: number; context: string }[];
    selfDisconnections: { start: string; hours: number; hotDay: boolean }[];
  } | null;
  contacts: AccountContact[];
  collectionEvents: { date: string; action: string; overdue: number | null }[];
  disconnections: { date: string; overdue: number; reconnectedAt: string | null }[];
  outages: { start: string; end: string; hours: number; type: "planned" | "unplanned"; cause: string; noticeDate: string | null }[];
  communications: { lastOpenedAt: string | null; undelivered: { date: string; channel: string; type: string }[] };
}

/** A flow signal seen for a case: from the account, or from a survey answer that matches a self-report signal. */
export interface CaseSignal {
  id: string;
  name: string;
  source: "account" | "self_report" | "weather" | "area";
  strength: "strong" | "supporting";
  evidence: string;
  evidenceFieldId?: string;
}

export interface CaseCircumstance {
  circumstanceId: string;
  evidenceFieldIds: string[];
  /** The flow signals that raised this circumstance (flow-based cases only). */
  signals?: CaseSignal[];
}

export interface CaseRecommendation {
  recommendationId: string;
  circumstanceIds: string[];
  evidenceFieldIds: string[];
  reviewStatus: "pending" | "reviewed";
}

export interface CaseNote {
  id: string;
  text: string;
  authorUserId: string;
  createdAt: string;
  /** Set once a note has been edited. Earlier wording is kept on the server as an audit record. */
  editedAt?: string | null;
  editedByUserId?: string | null;
}

export interface ModelAssessment {
  provider: string;
  isSimulated: boolean;
  status: AssessmentStatus;
  priority: { score: number; label: PriorityLabel } | null;
  trend: "rising" | "stable" | "falling" | null;
  explanation: string | null;
}

export interface CaseWorkflow {
  status: CaseStatus;
  assignedToUserId: string | null;
  createdAt: string;
  updatedAt: string;
  followUpAt: string | null;
  reviewStatus: ReviewStatus;
  notes: CaseNote[];
}

export interface QueueCase {
  id: string;
  personId: string;
  version: number;
  reportedAt: string | null;
  reportedAnswers: Record<string, string | null>;
  answerAvailability: Record<string, AnswerAvailability>;
  supportAreaIds: string[];
  circumstances: CaseCircumstance[];
  assistance: {
    hardshipEnrolmentAtReport: string | null;
    energyBillConcessionAtReport: string | null;
    reportedHistory: { evidenceFieldId: string; referencePeriod: string }[];
  };
  recommendations: CaseRecommendation[];
  modelAssessment: ModelAssessment;
  workflow: CaseWorkflow;
}

export interface QueueDataset {
  asOf: string;
  /** "flow": circumstances and solutions come from the flowchart file. "fixture": the fixture's fixed survey rules. */
  circumstanceSource?: "flow" | "fixture";
  isSynthetic: boolean;
  users: StaffUser[];
  supportAreas: SupportArea[];
  circumstances: CircumstanceDefinition[];
  evidenceFields: EvidenceFieldDefinition[];
  recommendations: RecommendationDefinition[];
  people: Person[];
  cases: QueueCase[];
}

export type QueueView = "all" | "mine" | "needs_review";
export type SortKey = "priority_desc" | "priority_asc" | "risk_desc" | "followup" | "name" | "updated";

export interface QueueQuery {
  search: string;
  view: QueueView;
  circumstanceIds: string[];
  assistanceIds: string[];
  priorityLabels: PriorityLabel[];
  minPriorityScore: number;
  assessmentStatus: AssessmentStatus | "";
  status: CaseStatus | "";
  assignedToUserId: string;
  sort: SortKey;
  page: number;
  pageSize: number;
}
