import type { FlowDoc, FlowOp, WeatherSignal } from "@greenspark/shared";
import type { CreateGroupTask, GroupTask, GroupTaskDetail, GroupTaskPreview, GroupTaskSelection } from "@greenspark/shared";

export interface GroupTaskList { tasks: GroupTask[]; users: StaffUser[]; actorId: string; canAssignOthers: boolean }
import type {
  AssessmentStatus, CaseStatus, CircumstanceDefinition, EvidenceFieldDefinition, Person, QueueCase,
  QueueQuery, RecommendationDefinition, ReviewStatus, StaffUser, SupportArea,
} from "@greenspark/shared";

export interface Catalog {
  supportAreas: SupportArea[];
  circumstances: CircumstanceDefinition[];
  evidenceFields: EvidenceFieldDefinition[];
  recommendations: RecommendationDefinition[];
  /** "flow" when circumstances and solutions come from the flowchart file. */
  circumstanceSource?: "flow" | "fixture";
  asOf: string;
  users: StaffUser[];
  assignableUserIds: string[];
}

/** `weatherSignals`: the customer's weather signals from the latest forecast (case page only). */
export interface CaseItem {
  case: QueueCase; person: Person | null; weatherSignals?: WeatherSignal[]; prediction?: Prediction | null;
  /** Case page only: the week's forecast for the customer's nearest forecast town, and the suburb's location. */
  forecast?: CaseForecast | null;
  /** Queue rows only: the predicted chance of any harm in 90 days, and its average. */
  risk?: { probability: number; baseRate: number | null } | null;
}

/** The 90-day risk model's scores for one customer (case page only). */
export interface Prediction {
  modelId: string; horizonDays: number; sourceMonthEnd: string;
  outcomes: Record<string, { probability: number; percentile: number; baseRate: number | null }>;
  factors: { id: string; label: string; value: string | null; weight: number }[];
}
export interface RiskModelCard {
  scoredCustomers: number;
  model: {
    id: string; type: string; horizonDays: number; trainingMonths: number; testMonths: number; heldOut: string; caveat: string;
    inputs: { id: string; label: string; missing: boolean }[];
    outcomes: Record<string, { label: string; weights: Record<string, number>; test: {
      baseRate: number; auc: number; top5: { precision: number; recall: number }; calibration: { predicted: number; actual: number }[];
    } }>;
  };
}

export interface Facets {
  view: Record<"all" | "mine" | "needs_review", number>;
  circumstances: Record<string, number>;
  areas: Record<string, number>;
  assistance: Record<string, number>;
  priority: Record<string, number>;
}

export interface CaseListResponse {
  items: CaseItem[];
  total: number; page: number; pageSize: number; pageCount: number; from: number; to: number;
  counters: { urgent: number; myActive: number };
  facets: Facets;
}

export interface MutationResult { actionId: string | null; updated: QueueCase[]; unchanged: string[] }

export interface ErrorDetail { caseId?: string; accountNumber?: string; code?: string; message: string }

export class ApiClientError extends Error {
  constructor(readonly status: number, readonly code: string, message: string, readonly details: ErrorDetail[] = [], readonly current?: QueueCase) {
    super(message);
  }
}

export interface FlowSnapshot { doc: FlowDoc | null; hash: string; problems: string[] }
export interface FlowSaved { hash: string; previousHash: string; changed: boolean }

export interface ApiClient {
  groupTasks?(eventDate: string): Promise<GroupTaskList>;
  previewGroupTask?(selection: GroupTaskSelection): Promise<GroupTaskPreview>;
  createGroupTask?(input: CreateGroupTask): Promise<{ task: GroupTask; preview: GroupTaskPreview }>;
  groupTask?(id: string, page?: number): Promise<GroupTaskDetail>;
  updateGroupTask?(id: string, input: { expectedVersion: number; personIds: string[]; completed: boolean }): Promise<{ task: GroupTask }>;
  cancelGroupTask?(id: string, expectedVersion: number): Promise<{ task: GroupTask }>;
  /** The utility hardship flow behind the Flowchart page (a JSON file on the server). */
  flow(): Promise<FlowSnapshot>;
  weather?(): Promise<WeatherStatus>;
  /** The AI model behind the summaries, and switching it (managers). */
  ai?(): Promise<AiStatus>;
  setAi?(model: string): Promise<AiStatus>;
  setWeatherMode?(mode: WeatherMode): Promise<WeatherStatus>;
  flowOps(ops: FlowOp[]): Promise<FlowSaved>;
  catalog(): Promise<Catalog>;
  list(q: QueueQuery): Promise<CaseListResponse>;
  matchingIds(q: QueueQuery): Promise<string[]>;
  /** Every matching case grouped by postcode, for the map view. Optional so test clients can leave it out. */
  mapSummary?(q: QueueQuery): Promise<MapSummary>;
  overview(caseId: string): Promise<CaseItem>;
  /** The case for an account number (each account has one case). */
  account(accountNumber: string): Promise<CaseItem>;
  /** The weather outlook: the week's forecast and the customers it puts at risk. Optional so test clients can leave it out. */
  outlook?(): Promise<Outlook>;
  /** Very hot days a year by decade, observed and projected, for the Climate outlook page. */
  climateDecades?(): Promise<ClimateDecades>;
  /** Current Emergency WA warnings, for the outlook map. Optional so test clients can leave it out. */
  emergency?(): Promise<EmergencyFeed>;
  /** The risk model's card. Optional so test clients can leave it out. */
  riskModel?(): Promise<RiskModelCard>;
  assign(assigneeUserId: string, items: VersionedId[]): Promise<MutationResult>;
  setStatus(status: CaseStatus, items: VersionedId[]): Promise<MutationResult>;
  addNote(caseId: string, text: string, expectedVersion: number): Promise<QueueCase>;
  editNote(caseId: string, noteId: string, text: string, expectedVersion: number): Promise<QueueCase>;
  setReview(caseId: string, reviewStatus: ReviewStatus, expectedVersion: number): Promise<MutationResult>;
  undo(actionId: string): Promise<MutationResult>;
  /** AI-drafted support plan for a case (Claude or Gemini). Optional so test clients can leave it out. */
  supportPlan?(caseId: string, kind?: PlanKind): Promise<SupportPlan>;
}

export type PlanKind = "support" | "signals";
export type ContactMethod = "phone" | "sms" | "email" | "letter";
export interface PlanStep { id: string; reason: string; due?: string; method?: ContactMethod }
export interface SupportPlan { text: string; model: string; generatedAt: string; order?: PlanStep[]; interpreter?: boolean }

export interface AiStatus { provider: string | null; model: string | null; on: boolean; options: { provider: string; model: string; label: string; available: boolean }[] }
export type WeatherMode = "live" | "demo" | "off";
export interface WeatherStatus { mode: WeatherMode; fetchedAt: string | null; issuedAt: string | null; towns: number; warnings: string[]; error: string | null; available?: boolean }

export interface MapPlace {
  postcode: string; suburb: string; lat: number; lng: number; count: number; labels: Record<string, number>;
  cases: { accountNumber: string | null; displayName: string; score: number | null; label: string | null; status: string }[];
}
export interface MapSummary { total: number; unplaced: number; places: MapPlace[] }

export type HazardKind = "heat" | "hot" | "fire" | "warning";
export interface OutlookHazard { kind: HazardKind; date: string; severity: number; text: string }
export interface OutlookTown {
  id: string; name: string; district: string; districtName: string; lat: number; lng: number;
  days: { date: string; max: number | null; min: number | null; precis: string }[];
  hazards: OutlookHazard[]; customers: number; exposed: number; act: number; watch: number;
  /** Very hot days a year now (SILO) and around 2050 (CMIP6), averaged over the town's postcodes. */
  climate: { hot: number | null; hot2050: number | null; veryHot: number | null; veryHot2050: number | null } | null;
}
export type ClimateDecades =
  | { available: false }
  | {
    available: true; thresholds: { hot: number; veryHot: number }; observedDecades: string[]; projectedDecades: string[];
    observedSource: { source: string; years: [number, number]; licence: string };
    projectedSource: { source: string; scenario: string; models: string[]; coverage: string; sampled: string; method: string; licence: string };
    towns: { id: string; name: string; lat?: number; lng?: number; district: string | null; customers: number; observed: Record<string, { hot: number | null; veryHot: number | null }>; projected: Record<string, { hot: number | null; veryHot: number | null }> }[];
  };
export interface ClimateInfo { thresholds: { hot: number; veryHot: number }; baselineYears: [number, number]; scenario: string; period: string }
export interface OutlookCustomer {
  personId: string; townId: string; tier: "act" | "watch" | null; score: number; exposure: number;
  /** `firstDate`: the first hot or dangerous forecast day (a warning is in force from today, so it is left out). */
  kinds: HazardKind[]; firstDate: string | null; firstKind: HazardKind | null; worst: string | null;
  sensitivity: { id: string; group: "health" | "supply" | "cost" | "isolation"; label: string }[];
  accountNumber: string | null; displayName: string; suburb: string; postcode: string | null;
  risk: { probability: number; baseRate: number | null } | null;
  priority: { label: string; score: number } | null; status: string | null;
  group?: import("@greenspark/shared").SupportGroupId;
  supportNeeds?: import("@greenspark/shared").SupportGroupId[];
  location?: [number, number] | null;
  assignedTo?: string | null;
  daily?: { date: string; tier: "act" | "watch" | null; exposure: number; score: number }[];
}
export type Outlook =
  | { available: false; weather: WeatherStatus }
  | {
    available: true; weather: WeatherStatus; today: string; demo: boolean; issuedAt: string | null;
    days: { date: string; peak: { max: number; town: string } | null; exposed: number; act: number; watch: number }[];
    towns: OutlookTown[];
    climate: ClimateInfo | null;
    warnings: { title: string; districts: string[]; expires: string | null }[];
    totals: { covered: number; uncovered: number; exposed: number; vulnerable: number; act: number; watch: number };
    customers: OutlookCustomer[];
    groupCustomers?: OutlookCustomer[];
  };

export interface CaseForecast {
  townId: string; town: string; district: string; demo: boolean; issuedAt: string | null; location: [number, number] | null;
  days: { date: string; max: number | null; min: number | null; precis: string }[]; hazards: OutlookHazard[];
  /** Where the customer sits on the weather outlook this week, and the needs behind it. */
  outlook: { tier: "act" | "watch" | null; exposure: number; highRisk: boolean; sensitivity: OutlookCustomer["sensitivity"] } | null;
  /** Long-term heat where they live: very hot days a year now and around 2050. */
  climate: (ClimateInfo & { hot: number; veryHot: number; summerMax: number; hot2050: number | null; veryHot2050: number | null }) | null;
}
export interface EmergencyAlert {
  id: string; headline: string; event: string; category: string; alertLevel: string; severity: string; sent: string | null;
  areaDesc: string; web: string | null; polygons: [number, number][][]; centre: [number, number] | null;
}
export interface EmergencyFeed { available: boolean; fetchedAt: string | null; error: string | null; alerts: EmergencyAlert[] }

export interface VersionedId { caseId: string; expectedVersion: number }

export function queryString(q: QueueQuery, withPaging = true): string {
  const p = new URLSearchParams();
  if (q.search.trim()) p.set("search", q.search.trim());
  if (q.view !== "all") p.set("view", q.view);
  if (q.circumstanceIds.length) p.set("circumstanceIds", q.circumstanceIds.join(","));
  if (q.assistanceIds.length) p.set("assistanceIds", q.assistanceIds.join(","));
  if (q.priorityLabels.length) p.set("priorityLabels", q.priorityLabels.join(","));
  if (q.minPriorityScore > 0) p.set("minPriorityScore", String(q.minPriorityScore));
  if (q.assessmentStatus) p.set("assessmentStatus", q.assessmentStatus satisfies AssessmentStatus);
  if (q.status) p.set("status", q.status);
  if (q.assignedToUserId) p.set("assignedToUserId", q.assignedToUserId);
  if (withPaging) {
    p.set("sort", q.sort);
    p.set("page", String(q.page));
    p.set("pageSize", String(q.pageSize));
  }
  return p.toString();
}

/** HTTP implementation. `getUser` supplies the demo identity header (not real sign-in). */
export function createApiClient(getUser: () => string, base = ""): ApiClient {
  async function req<T>(method: string, path: string, body?: unknown): Promise<T> {
    let res: Response;
    try {
      res = await fetch(base + path, {
        method,
        headers: { "x-demo-user": getUser(), ...(body === undefined ? {} : { "content-type": "application/json" }) },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch {
      throw new ApiClientError(0, "network", "Could not reach the server. Check that the API is running and try again.");
    }
    const json = (await res.json().catch(() => null)) as { error?: { code: string; message: string; details?: ErrorDetail[]; current?: QueueCase } } | null;
    if (!res.ok) {
      const e = json?.error;
      throw new ApiClientError(res.status, e?.code ?? "unknown", e?.message ?? `Request failed (${res.status}).`, e?.details ?? [], e?.current);
    }
    return json as T;
  }
  return {
    groupTasks: (eventDate) => req("GET", `/api/group-tasks?eventDate=${encodeURIComponent(eventDate)}`),
    previewGroupTask: (selection) => req("POST", "/api/group-tasks/preview", selection),
    createGroupTask: (input) => req("POST", "/api/group-tasks", input),
    groupTask: (id, page = 1) => req("GET", `/api/group-tasks/${encodeURIComponent(id)}?page=${page}`),
    updateGroupTask: (id, input) => req("PATCH", `/api/group-tasks/${encodeURIComponent(id)}/progress`, input),
    cancelGroupTask: (id, expectedVersion) => req("POST", `/api/group-tasks/${encodeURIComponent(id)}/cancel`, { expectedVersion }),
    flow: () => req("GET", "/api/admin/flow"),
    weather: () => req("GET", "/api/weather"),
    ai: () => req("GET", "/api/ai"),
    setAi: (model) => req("POST", "/api/ai", { model }),
    setWeatherMode: (mode) => req("POST", "/api/weather/mode", { mode }),
    flowOps: (ops) => req("POST", "/api/admin/flow/ops", { ops }),
    async catalog() {
      const [c, u] = await Promise.all([
        req<Omit<Catalog, "users" | "assignableUserIds">>("GET", "/api/catalogs"),
        req<{ users: StaffUser[]; assignableUserIds: string[] }>("GET", "/api/users"),
      ]);
      return { ...c, users: u.users, assignableUserIds: u.assignableUserIds };
    },
    list: (q) => req("GET", `/api/cases?${queryString(q)}`),
    mapSummary: (q) => req("GET", `/api/cases/map?${queryString(q, false)}`),
    matchingIds: async (q) => (await req<{ ids: string[] }>("GET", `/api/cases/ids?${queryString(q, false)}`)).ids,
    overview: (id) => req("GET", `/api/cases/${encodeURIComponent(id)}/overview`),
    riskModel: () => req("GET", "/api/model/risk"),
    outlook: () => req("GET", "/api/outlook"),
    climateDecades: () => req("GET", "/api/climate/decades"),
    emergency: () => req("GET", "/api/emergency"),
    account: (accountNumber) => req("GET", `/api/accounts/${encodeURIComponent(accountNumber)}`),
    assign: (assigneeUserId, items) => req("POST", "/api/cases/bulk/assignment", { assigneeUserId, items }),
    setStatus: (status, items) =>
      items.length === 1
        ? req("PATCH", `/api/cases/${encodeURIComponent(items[0]!.caseId)}/status`, { status, expectedVersion: items[0]!.expectedVersion })
        : req("POST", "/api/cases/bulk/status", { status, items }),
    addNote: async (id, text, expectedVersion) => (await req<{ case: QueueCase }>("POST", `/api/cases/${encodeURIComponent(id)}/notes`, { text, expectedVersion })).case,
    editNote: async (id, noteId, text, expectedVersion) => (await req<{ case: QueueCase }>("PATCH", `/api/cases/${encodeURIComponent(id)}/notes/${encodeURIComponent(noteId)}`, { text, expectedVersion })).case,
    setReview: (id, reviewStatus, expectedVersion) => req("PATCH", `/api/cases/${encodeURIComponent(id)}/review`, { reviewStatus, expectedVersion }),
    supportPlan: async (id, kind = "support") => (await req<{ plan: SupportPlan }>("GET", `/api/cases/${encodeURIComponent(id)}/plan?kind=${kind}`)).plan,
    undo: (actionId) => req("POST", `/api/workflow-actions/${encodeURIComponent(actionId)}/undo`),
  };
}
