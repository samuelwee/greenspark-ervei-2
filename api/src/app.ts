import { timingSafeEqual } from "node:crypto";
import { GroupTasks } from "./groupTasks";
import { SOLUTIONS, type SolutionId } from "@greenspark/shared";
import { join } from "node:path";
import compression from "compression";
import express, { type NextFunction, type Request, type Response } from "express";
import { z } from "zod";
import {
  ASSISTANCE_OPTIONS, DEFAULT_QUERY, PRIORITY_LABELS, applyFilters, facetCounts, overviewCounters, paginate, sortCases,
  type Person, type QueueCase, type QueueQuery, type StaffUser,
} from "@greenspark/shared";
import { ApiError } from "./errors";
import { MAX_BULK_ITEMS, WorkflowService, type MutationResult } from "./service";
import type { Store } from "./store";
import type { Clock } from "./clock";
import { FlowFile } from "./flow";
import type { Predictions } from "./predictions";
import { answerQuestion, MAX_HISTORY, MAX_MESSAGE_CHARS } from "./assistant";
import { draftPlan, PLAN_KINDS, perthToday, planFacts, type AiConfig, type ContactRules, type PlanKind, type SupportPlan } from "./plan";
import { FlowError, POSTCODE_LOCATION, POSTCODE_TOWN, customerOutlook, townHazards, detectWeatherSignals, evaluateCase, flowCatalog, parseOp, primarySupportGroup, sensitivityOf, SENSITIVITY, supportGroupNeeds, type FlowDoc, type WeatherSignal, type WeatherSnapshot } from "@greenspark/shared";
import type { ClimateDecades, ClimateHeat } from "./climate";
import { SyntheticModelAdapter, withAssessments, type ModelAdapter } from "./adapters";

const STATUSES = ["new", "in_progress", "waiting", "resolved"] as const;
const SORTS = ["priority_desc", "priority_asc", "risk_desc", "followup", "name", "updated"] as const;
const VIEWS = ["all", "mine", "needs_review"] as const;

const item = z.object({ caseId: z.string().min(1), expectedVersion: z.number().int().min(1) }).strict();
const items = z.array(item).min(1).max(MAX_BULK_ITEMS).refine((a) => new Set(a.map((i) => i.caseId)).size === a.length, "Duplicate case IDs");
// Every case has a worker, so an assignment always names one.
const assignBody = z.object({ assigneeUserId: z.string().min(1), items }).strict();
const bulkStatusBody = z.object({ status: z.enum(STATUSES), items }).strict();
const statusBody = z.object({ status: z.enum(STATUSES), expectedVersion: z.number().int().min(1) }).strict();
// Notes have no character limit; the 100 KB request-size limit below is the only cap.
const noteBody = z.object({ text: z.string().trim().min(1), expectedVersion: z.number().int().min(1) }).strict();
const reviewBody = z.object({ reviewStatus: z.enum(["needs_review", "reviewed"]), expectedVersion: z.number().int().min(1) }).strict();
// The worker for a new case: required from a manager; a support worker's new case is theirs.
const assignee = { assigneeUserId: z.string().min(1).optional() };
const taskDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((s) => { const d = new Date(`${s}T00:00:00Z`); return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s; }, "Choose a valid date");
const taskPeople = z.array(z.string().min(1).max(100)).max(50000).refine((ids) => new Set(ids).size === ids.length, "Duplicate customers");
const taskSelection = z.object({ kind: z.enum(["solution", "moratorium"]),
  groupIds: z.array(z.enum(["health", "disconnected", "supply", "bills", "coaching"])).max(5),
  solutionId: z.enum(Object.keys(SOLUTIONS) as [SolutionId, ...SolutionId[]]).nullable(),
  scopePostcodes: z.array(z.string().min(1).max(10)).max(5000),
  eventDate: taskDate, scope: z.string().trim().min(1).max(150), personIds: taskPeople }).strict();
const taskCreate = taskSelection.extend({ assigneeUserId: z.string().min(1), dueDate: taskDate }).strict();
const taskProgress = z.object({ expectedVersion: z.number().int().min(1), personIds: taskPeople, completed: z.boolean() }).strict();
const taskPostcodes = z.array(z.string().min(1).max(10)).min(1).max(50000).refine((a) => new Set(a).size === a.length, "Duplicate postcodes");
const taskAreaProgress = z.object({ expectedVersion: z.number().int().min(1), postcodes: taskPostcodes, completed: z.boolean() }).strict();
const taskCancel = z.object({ expectedVersion: z.number().int().min(1) }).strict();
const newCaseBody = z.union([
  z.object({ personId: z.string().min(1), ...assignee }).strict(),
  z.object({ displayName: z.string().trim().min(1).max(100), suburb: z.string().trim().min(1).max(100), ...assignee }).strict(),
]);

const csv = (v: unknown) => (typeof v === "string" && v ? v.split(",") : []);
const listParams = z.object({
  search: z.string().max(100).optional(), view: z.enum(VIEWS).optional(),
  circumstanceIds: z.string().optional(), assistanceIds: z.string().optional(), priorityLabels: z.string().optional(),
  minPriorityScore: z.coerce.number().int().min(0).max(100).optional(),
  assessmentStatus: z.enum(["ready", "pending", "unavailable"]).optional(), status: z.enum(STATUSES).optional(),
  assignedToUserId: z.string().optional(), sort: z.enum(SORTS).optional(),
  page: z.coerce.number().int().min(1).optional(), pageSize: z.coerce.number().int().min(1).max(100).optional(),
});

function parse<T>(schema: z.ZodType<T>, data: unknown): T {
  const r = schema.safeParse(data);
  if (!r.success) {
    throw new ApiError("validation_failed", "The request was not valid.", r.error.issues.map((i) => ({ code: i.code, message: `${i.path.join(".") || "body"}: ${i.message}` })));
  }
  return r.data;
}

export interface AppOptions {
  clock?: Clock;
  modelAdapter?: ModelAdapter;
  /** The utility hardship flow JSON file behind the Admin page. */
  flowFile?: string;
  /** Directory of the built web app. When set, this server also serves the pages (single-process hosting). */
  staticDir?: string | null;
  /** Optional "user:password" for HTTP Basic auth in front of everything except /api/health. For shared demo hosting. */
  basicAuth?: string | null;
  /** AI service (Claude or Gemini), key and models for the AI summaries. No key turns them off. */
  ai?: AiConfig | null;
  /** Keys for each AI service, so managers can switch the model while the server runs (demo settings). */
  aiKeys?: Partial<Record<"claude" | "gemini", string>>;
  /** Bureau of Meteorology forecasts and warnings for weather signals. Without it there are none. */
  weather?: { current(): WeatherSnapshot | null; status(): unknown; setMode(mode: "live" | "demo" | "off"): Promise<void> };
  /** The 90-day risk model's scores and model card. Without it there are no predictions. */
  predictions?: Predictions | null;
  /** Very hot days a year now and around 2050, per postcode. Without it there is no long-term heat. */
  climate?: ClimateHeat | null;
  /** Very hot days a year per decade, observed and projected, for the Climate outlook page. */
  decades?: ClimateDecades | null;
  /** Emergency WA warnings (DFES) for the outlook map. Without it the map has none. */
  emergency?: { current(): { available: boolean; fetchedAt: string | null; error: string | null; alerts: unknown[] } };
}

/** A person as the case list needs them: everything but the utility account and its signal summary. */
function listPerson(p: Person | undefined): Person | null {
  if (!p) return null;
  const { account: _account, signalSummary: _summary, ...rest } = p;
  return rest;
}

export function createApp(store: Store, options: AppOptions = {}) {
  const clock = options.clock ?? (() => new Date());
  // A model adapter passed in (a real prediction model) always supplies the priority. Otherwise, with the flowchart
  // in use the priority is worked out from each case's signals; without it, the fixture's invented assessments show.
  const model = options.modelAdapter ?? new SyntheticModelAdapter(store);
  const useModel = async () => !!options.modelAdapter || !(await currentFlowDoc());
  const service = new WorkflowService(store, clock);
  const groupTasks = new GroupTasks(store, clock);
  const flow = options.flowFile ? new FlowFile(options.flowFile) : null;
  async function currentFlowDoc() { return flow ? flow.current() : null; }
  // Circumstances and solutions come from the Admin flow file when it is configured and valid; otherwise the
  // fixture's fixed survey rules stay in place. Assessments are added after.
  const catalogs = new WeakMap<FlowDoc, ReturnType<typeof flowCatalog>>();
  const catalogOf = (doc: FlowDoc) => { let c = catalogs.get(doc); if (!c) catalogs.set(doc, (c = flowCatalog(doc))); return c; };
  const currentFlow = currentFlowDoc;
  /** The 90-day risk scores for a person, by their dataset customer ID; null without an account or a score. */
  const predictionFor = (person: Person | null) => {
    const p = options.predictions;
    const id = person && p ? store.sourceCustomerId(person.id) : null;
    const score = id ? p!.byCustomer.get(id) ?? null : null;
    if (!score) return null;
    // Each outcome's average rate (on held-out customers), so the page can say how this customer compares.
    const outcomes = Object.fromEntries(Object.entries(score.outcomes).map(([k, o]) => [k, { ...o, baseRate: p!.model.outcomes[k]?.test.baseRate ?? null }]));
    return { ...score, outcomes, modelId: p!.model.id, horizonDays: p!.model.horizonDays };
  };
  /** Just the chance of any harm, for a queue row. */
  const riskFor = (person: Person | null) => {
    const p = predictionFor(person)?.outcomes.any_adverse;
    return p ? { probability: p.probability, baseRate: p.baseRate } : null;
  };
  /** The weather signals for a person's postcode, from the latest forecast, looking ahead from today in Perth. */
  const weatherFor = (person: Person | null): WeatherSignal[] => {
    const w = options.weather?.current() ?? null;
    return person ? detectWeatherSignals(person.address?.postcode, (person.account?.region.northOf26th ?? person.signalSummary?.northOf26th ?? false), w, perthToday(clock())) : [];
  };
  /** Long-term heat where a person lives: very hot days a year now and around 2050. */
  const climateFor = (postcode: string | null | undefined) => {
    const c = options.climate;
    const h = c && postcode ? c.postcodes[postcode] : undefined;
    return c && h ? { ...h, thresholds: c.thresholds, baselineYears: c.baseline.years, scenario: c.projection.scenario, period: c.projection.period } : null;
  };
  /** A forecast town's long-term heat: the average of its postcodes. */
  const townClimate = (townId: string) => {
    const c = options.climate;
    const hs = c ? Object.values(c.postcodes).filter((h) => h.town === townId) : [];
    if (!c || !hs.length) return null;
    const avg = (f: (h: (typeof hs)[number]) => number | null) => { const v = hs.map(f).filter((x): x is number => x !== null); return v.length ? Math.round((v.reduce((a, b) => a + b, 0) / v.length) * 10) / 10 : null; };
    return { hot: avg((h) => h.hot), hot2050: avg((h) => h.hot2050), veryHot: avg((h) => h.veryHot), veryHot2050: avg((h) => h.veryHot2050) };
  };
  /** Where a person sits on the weather outlook (act now, watch or neither) and why, the same way the outlook works it out. */
  const outlookFor = (person: Person, w: WeatherSnapshot, today: string) => {
    const risk = riskFor(person);
    const highRisk = !!risk && risk.baseRate !== null && risk.probability >= 4 * risk.baseRate;
    const o = customerOutlook(person, w, today, highRisk, risk?.probability ?? 0);
    return o ? { tier: o.tier, exposure: o.exposure, highRisk, sensitivity: o.sensitivity.map(({ id, group, label }) => ({ id, group, label })) } : null;
  };
  /** The week's forecast for a person's nearest forecast town, with its hazards, for the case page's weather card. */
  const forecastFor = (person: Person | null) => {
    const w = options.weather?.current() ?? null;
    const postcode = person?.address?.postcode;
    const townId = postcode ? POSTCODE_TOWN[postcode] : undefined;
    const t = townId && w ? w.towns[townId] : undefined;
    if (!w || !t || !townId) return null;
    const today = perthToday(clock());
    const north = person?.account?.region.northOf26th ?? person?.signalSummary?.northOf26th ?? false;
    return {
      townId, town: t.name, district: w.districts[t.district] ?? t.district, demo: w.demo, issuedAt: w.issuedAt,
      location: POSTCODE_LOCATION[postcode!] ?? null, days: t.days.filter((d) => d.date >= today).slice(0, 7), hazards: townHazards(w, townId, north, today),
      outlook: outlookFor(person!, w, today),
      climate: climateFor(postcode),
    };
  };
  const weatherKey = () => { const w = options.weather?.current(); return w ? `${w.fetchedAt}` : ""; };
  // Each case's result is kept per flowchart version until the case changes (every change bumps its version)
  // or a new forecast arrives (hourly). People never change once written, and a flowchart edit is a new FlowDoc.
  const evaluations = new WeakMap<FlowDoc, Map<string, { version: number; wx: string; result: ReturnType<typeof evaluateCase> }>>();
  const evaluate = (c: QueueCase, doc: FlowDoc) => {
    let byCase = evaluations.get(doc);
    if (!byCase) evaluations.set(doc, (byCase = new Map()));
    const hit = byCase.get(c.id);
    const wx = weatherKey();
    if (hit && hit.version === c.version && hit.wx === wx) return hit.result;
    // The full account, so account facts like HUGS eligibility can be checked as well as the stored signal summary.
    const person = store.getPersonWithAccount(c.personId);
    const result = evaluateCase(c, person, store.catalog, doc, catalogOf(doc), weatherFor(person));
    byCase.set(c.id, { version: c.version, wx, result });
    return result;
  };
  const withFlow = async (cases: QueueCase[]) => {
    const doc = await currentFlow();
    if (!doc) return cases;
    return cases.map((c) => ({ ...c, ...evaluate(c, doc) }));
  };
  /** Every case, with the catalogs that match how its circumstances were worked out. */
  const dataset = async () => {
    const data = store.dataset();
    const doc = await currentFlow();
    const out = doc
      ? { ...data, ...catalogOf(doc), circumstanceSource: "flow" as const, cases: data.cases.map((c) => ({ ...c, ...evaluate(c, doc) })) }
      : { ...data, circumstanceSource: "fixture" as const };
    if (await useModel()) out.cases = await withAssessments(model, out.cases);
    return out;
  };
  const enrich = async (cases: QueueCase[]) => {
    const evaluated = await withFlow(cases);
    return (await useModel()) ? withAssessments(model, evaluated) : evaluated;
  };
  const enrichOne = async (c: QueueCase) => (await enrich([c]))[0]!;
  const enrichResult = async (r: MutationResult) => ({ ...r, updated: await enrich(r.updated) });
  const app = express();
  app.disable("x-powered-by");
  // Gzip API responses and the web app's files: case data is large and the demo is served across the world.
  app.use(compression());

  if (options.basicAuth) {
    const expected = Buffer.from(options.basicAuth);
    app.use((req, res, next) => {
      if (req.path === "/api/health") return next();
      const header = req.header("authorization") ?? "";
      const given = header.startsWith("Basic ") ? Buffer.from(header.slice(6), "base64") : Buffer.alloc(0);
      if (given.length === expected.length && timingSafeEqual(given, expected)) return next();
      res.set("WWW-Authenticate", 'Basic realm="GreenSpark demo"').status(401).send("Authentication required.");
    });
  }
  app.use("/api/group-tasks", express.json({ limit: "6mb" }));
  app.use(express.json({ limit: "100kb" }));

  app.get("/api/health", (_req, res) => { res.json({ ok: true, demo: true }); });

  // Demo identity: the X-Demo-User header must name a fixture user. This is NOT production sign-in.
  const actorOf = (req: Request): StaffUser => {
    const id = req.header("x-demo-user");
    const user = store.catalog.users.find((u) => u.id === id);
    if (!user) throw new ApiError("unauthenticated", "Send a valid X-Demo-User header (demo identity, not real sign-in).");
    return user;
  };
  const auth = (req: Request, res: Response, next: NextFunction) => { res.locals.actor = actorOf(req); next(); };
  app.use("/api", auth);
  const actor = (res: Response) => res.locals.actor as StaffUser;

  app.get("/api/group-tasks", (req, res) => {
    const eventDate = parse(taskDate, req.query.eventDate);
    const a = actor(res);
    res.json({ tasks: groupTasks.list(eventDate), ...groupTasks.coverage(eventDate), actorId: a.id,
      canAssignOthers: a.role === "manager", users: store.catalog.users.filter((u) => u.role === "support_worker") });
  });
  app.post("/api/group-tasks/preview", (req, res) => { res.json(groupTasks.preview(parse(taskSelection, req.body))); });
  app.post("/api/group-tasks", (req, res) => {
    res.status(201).json(groupTasks.create(actor(res), parse(taskCreate, req.body)));
  });
  app.get("/api/group-tasks/:taskId", (req, res) => {
    const page = parse(z.coerce.number().int().min(1).max(100000), req.query.page ?? 1);
    res.json(groupTasks.detail(String(req.params.taskId), page));
  });
  app.patch("/api/group-tasks/:taskId/progress", (req, res) => {
    res.json({ task: groupTasks.update(actor(res), String(req.params.taskId), parse(taskProgress, req.body)) });
  });
  app.patch("/api/group-tasks/:taskId/area-progress", (req, res) => {
    res.json({ task: groupTasks.updateAreas(actor(res), String(req.params.taskId), parse(taskAreaProgress, req.body)) });
  });
  app.post("/api/group-tasks/:taskId/cancel", (req, res) => {
    res.json({ task: groupTasks.cancel(actor(res), String(req.params.taskId), parse(taskCancel, req.body).expectedVersion) });
  });

  app.get("/api/session", (_req, res) => {
    res.json({ user: actor(res), demoIdentity: true, isSynthetic: store.catalog.isSynthetic, asOf: store.catalog.asOf });
  });

  app.get("/api/catalogs", async (_req, res) => {
    const c = store.catalog;
    const doc = await currentFlow();
    const f = doc ? catalogOf(doc) : c;
    res.json({
      supportAreas: f.supportAreas, circumstances: f.circumstances, evidenceFields: c.evidenceFields,
      recommendations: f.recommendations, assistanceOptions: ASSISTANCE_OPTIONS, priorityLabels: PRIORITY_LABELS,
      statuses: STATUSES, asOf: c.asOf, circumstanceSource: doc ? "flow" : "fixture",
    });
  });

  // Everyone can read the shared queue; only managers get the full user list as assignment targets.
  app.get("/api/users", (_req, res) => {
    const a = actor(res);
    res.json({ users: store.catalog.users, assignableUserIds: a.role === "manager" ? store.catalog.users.filter((u) => u.role === "support_worker").map((u) => u.id) : [] });
  });

  const queryOf = (req: Request): QueueQuery => {
    const p = parse(listParams, req.query);
    return {
      ...DEFAULT_QUERY,
      search: p.search ?? "", view: p.view ?? "all",
      circumstanceIds: csv(p.circumstanceIds), assistanceIds: csv(p.assistanceIds),
      priorityLabels: csv(p.priorityLabels).filter((l): l is QueueQuery["priorityLabels"][number] => (PRIORITY_LABELS as string[]).includes(l)),
      minPriorityScore: p.minPriorityScore ?? 0, assessmentStatus: p.assessmentStatus ?? "", status: p.status ?? "",
      assignedToUserId: p.assignedToUserId ?? "", sort: p.sort ?? "priority_desc", page: p.page ?? 1, pageSize: p.pageSize ?? 50,
    };
  };

  // IDs of every case matching the filters (ignores paging); lets the UI drop selections that stopped matching.
  // Admin: the utility hardship flow. Open to every demo user. The JSON file is the only copy of the data.
  app.get("/api/admin/flow", async (_req, res) => {
    if (!flow) throw new ApiError("not_found", "The flow file isn't configured.");
    res.json(await flow.read());
  });

  const flowOpsBody = z.object({ ops: z.array(z.unknown()).min(1).max(200) }).strict();
  app.post("/api/admin/flow/ops", async (req, res) => {
    if (!flow) throw new ApiError("not_found", "The flow file isn't configured.");
    const body = parse(flowOpsBody, req.body);
    let ops;
    try {
      ops = body.ops.map((o) => parseOp(o));
    } catch (e) {
      if (e instanceof FlowError) throw new ApiError("validation_failed", e.message, [{ message: e.message }]);
      throw e;
    }
    res.json(await flow.apply(ops));
  });

  // The map view: every case matching the filters, grouped by postcode, most urgent first in each.
  app.get("/api/cases/map", async (req, res) => {
    const data = await dataset();
    const matches = sortCases(applyFilters(data, queryOf(req), actor(res).id), data.people, "priority_desc");
    const people = new Map(data.people.map((p) => [p.id, p]));
    const places = new Map<string, { postcode: string; suburb: string; lat: number; lng: number; count: number; labels: Record<string, number>; cases: { accountNumber: string | null; displayName: string; score: number | null; label: string | null; status: string }[] }>();
    let unplaced = 0;
    for (const c of matches) {
      const p = people.get(c.personId);
      const postcode = p?.address?.postcode ?? "";
      const at = POSTCODE_LOCATION[postcode];
      if (!p || !at) { unplaced++; continue; }
      let place = places.get(postcode);
      if (!place) places.set(postcode, (place = { postcode, suburb: p.suburb, lat: at[0], lng: at[1], count: 0, labels: {}, cases: [] }));
      place.count++;
      const label = c.modelAssessment.priority?.label ?? "none";
      place.labels[label] = (place.labels[label] ?? 0) + 1;
      // Enough to list in the panel; the rest are counted.
      if (place.cases.length < 50) place.cases.push({ accountNumber: p.accountNumber ?? null, displayName: p.displayName, score: c.modelAssessment.priority?.score ?? null, label: c.modelAssessment.priority?.label ?? null, status: c.workflow.status });
    }
    res.json({ total: matches.length, unplaced, places: [...places.values()] });
  });

  let outlookCache: { key: string; body: unknown } | null = null;
  const docIds = new WeakMap<FlowDoc, number>();
  let nextDocId = 0;
  // A flowchart edit is a new FlowDoc, so its identity is enough to tell versions apart.
  const docId = (doc: FlowDoc) => { let n = docIds.get(doc); if (n === undefined) docIds.set(doc, (n = ++nextDocId)); return n; };
  // The weather outlook: the next week's forecast for each town, and the customers it puts at risk, most at risk first.
  app.get("/api/outlook", async (_req, res) => {
    const w = options.weather?.current() ?? null;
    const status = options.weather?.status() ?? { mode: "off" };
    if (!w) return res.json({ available: false, weather: status });
    const today = perthToday(clock());
    // The same forecast, day, flowchart and case versions give the same outlook, so it is worked out once.
    const doc = await currentFlow();
    const key = `${w.fetchedAt}|${today}|${doc ? docId(doc) : "fixture"}|${store.casesSignature()}`;
    if (outlookCache?.key === key) return res.json(outlookCache.body);
    const data = await dataset();
    const cases = new Map(data.cases.map((c) => [c.personId, c]));
    let uncovered = 0;
    const forecastDates = [...new Set(Object.values(w.towns).flatMap((t) => t.days.filter((d) => d.date >= today).map((d) => d.date)))].sort().slice(0, 7);
    const rows = data.people.flatMap((p) => {
      const risk = riskFor(p);
      const highRisk = !!risk && risk.baseRate !== null && risk.probability >= 4 * risk.baseRate;
      const o = customerOutlook(p, w, today, highRisk, risk?.probability ?? 0);
      if (!o) { uncovered++; return []; }
      const c = cases.get(p.id);
      const supportSignals = [...o.sensitivity, ...(p.signalSummary?.account ?? []), ...(p.signalSummary?.selfReport ?? [])];
      // The town's hazards are sent once with the town, so each row only says when it starts and the worst of it.
      const worst = o.hazards.reduce<typeof o.hazards[number] | null>((a, h) => (!a || h.severity > a.severity ? h : a), null);
      return [{
        personId: o.personId, townId: o.townId, tier: o.tier, score: o.score, exposure: o.exposure,
        // For the funnel: hot or dangerous weather and something that makes it harder to cope with.
        vulnerable: o.exposure > 0 && (o.sensitivity.length > 0 || highRisk),
        kinds: [...new Set(o.hazards.map((h) => h.kind))], dates: [...new Set(o.hazards.map((h) => h.date))], firstDate: o.hazards.find((h) => h.kind !== "warning")?.date ?? null, firstKind: o.hazards.find((h) => h.kind !== "warning")?.kind ?? null, worst: worst?.text ?? null,
        sensitivity: o.sensitivity.map(({ id, group, label }) => ({ id, group, label })), accountNumber: p.accountNumber ?? null, displayName: p.displayName, suburb: p.suburb, postcode: p.address?.postcode ?? null, risk,
        priority: c?.modelAssessment.priority ? { label: c.modelAssessment.priority.label, score: c.modelAssessment.priority.score } : null, status: c?.workflow.status ?? null,
        // No group when no recorded signal supports a specific action; those customers stay in the queue.
        group: primarySupportGroup(supportSignals), supportNeeds: supportGroupNeeds(supportSignals),
        location: p.address?.postcode ? POSTCODE_LOCATION[p.address.postcode] ?? null : null,
        assignedTo: c?.workflow.assignedToUserId ?? null,
        daily: forecastDates.map((date) => {
          const day = customerOutlook(p, w, date, highRisk, risk?.probability ?? 0, date)!;
          return { date, tier: day.tier, exposure: day.exposure, score: day.score };
        }),
      }];
    });
    // Each town sits at the average of its postcodes; its own hazards use the north's heat limits above the 26th parallel.
    const towns = Object.entries(w.towns).flatMap(([id, t]) => {
      const spots = Object.entries(POSTCODE_TOWN).filter(([, town]) => town === id).flatMap(([pc]) => (POSTCODE_LOCATION[pc] ? [POSTCODE_LOCATION[pc]!] : []));
      if (!spots.length) return [];
      const lat = spots.reduce((n, s) => n + s[0], 0) / spots.length, lng = spots.reduce((n, s) => n + s[1], 0) / spots.length;
      const here = rows.filter((r) => r.townId === id);
      return [{
        id, name: t.name, district: t.district, districtName: w.districts[t.district] ?? t.district, lat, lng, days: t.days.filter((d) => d.date >= today),
        hazards: townHazards(w, id, lat > -26, today), customers: here.length, exposed: here.filter((r) => r.exposure > 0).length,
        climate: townClimate(id),
        act: here.filter((r) => r.tier === "act").length, watch: here.filter((r) => r.tier === "watch").length,
      }];
    });
    const dates = [...new Set(towns.flatMap((t) => t.days.map((d) => d.date)))].sort().slice(0, 7);
    const days = dates.map((date) => {
      const peak = towns.flatMap((t) => t.days.filter((d) => d.date === date && d.max !== null).map((d) => ({ max: d.max!, town: t.name }))).sort((a, b) => b.max - a.max)[0] ?? null;
      const on = rows.filter((r) => r.dates.includes(date));
      return { date, peak, exposed: on.length, act: on.filter((r) => r.tier === "act").length, watch: on.filter((r) => r.tier === "watch").length };
    });
    const listed = rows.filter((r) => r.tier).sort((a, b) => (a.tier === b.tier ? 0 : a.tier === "act" ? -1 : 1) || b.score - a.score);
    // Group planning covers customers whose recorded signals support a specific action; customers
    // without a risk signal are reviewed in the case queue, not on this weather-triggered view.
    const grouped = rows.filter((r) => r.group);
    const body = {
      available: true, weather: status, today, demo: w.demo, issuedAt: w.issuedAt, days, towns,
      climate: options.climate ? { thresholds: options.climate.thresholds, baselineYears: options.climate.baseline.years, scenario: options.climate.projection.scenario, period: options.climate.projection.period } : null,
      warnings: w.warnings.filter((x) => x.districts.length).map((x) => ({ title: x.title, districts: x.districts.map((d) => w.districts[d] ?? d), expires: x.expires })),
      totals: { covered: rows.length, uncovered, unassigned: rows.length - grouped.length, exposed: rows.filter((r) => r.exposure > 0).length, vulnerable: rows.filter((r) => r.vulnerable).length, act: listed.filter((r) => r.tier === "act").length, watch: listed.filter((r) => r.tier === "watch").length },
      customers: listed.map(({ dates: _dates, vulnerable: _vulnerable, ...r }) => r),
      groupCustomers: grouped.map(({ dates: _dates, vulnerable: _vulnerable, ...r }) => r),
    };
    outlookCache = { key, body };
    res.json(body);
  });

  app.get("/api/cases/ids", async (req, res) => {
    const data = await dataset();
    res.json({ ids: applyFilters(data, queryOf(req), actor(res).id).map((c) => c.id) });
  });

  app.get("/api/cases", async (req, res) => {
    const q = queryOf(req);
    const me = actor(res).id;
    const data = await dataset();
    const byPerson = new Map(data.people.map((p) => [p.id, p]));
    const matches = sortCases(applyFilters(data, q, me), data.people, q.sort, (c) => riskFor(byPerson.get(c.personId) ?? null)?.probability ?? null);
    const page = paginate(matches, q.page, q.pageSize);
    const people = new Map(data.people.map((x) => [x.id, x]));
    const f = facetCounts(data, q, me);
    res.json({
      // The list leaves out each person's utility account (the case page fetches it), which keeps pages small.
      items: page.items.map((c) => ({ case: c, person: listPerson(people.get(c.personId)), risk: riskFor(people.get(c.personId) ?? null) })),
      total: page.total, page: page.page, pageSize: q.pageSize, pageCount: page.pageCount, from: page.from, to: page.to,
      counters: overviewCounters(data.cases, me),
      facets: {
        view: f.view,
        circumstances: Object.fromEntries(data.circumstances.map((c) => [c.id, f.circumstance(c.id)])),
        areas: Object.fromEntries(data.supportAreas.map((a) => [a.id, f.area(a.circumstanceIds)])),
        assistance: Object.fromEntries(ASSISTANCE_OPTIONS.map((o) => [o.id, f.assistance(o.id)])),
        priority: Object.fromEntries(PRIORITY_LABELS.map((l) => [l, f.priority(l)])),
      },
    });
  });

  // The account number is the customer's main ID; each account has one case.
  app.get("/api/accounts/:accountNumber", async (req, res) => {
    const found = store.getPersonByAccount(String(req.params.accountNumber));
    const person = found && store.getPersonWithAccount(found.id);
    const c = person && store.getCaseForPerson(person.id);
    if (!person || !c) throw new ApiError("not_found", "No case was found for that account number.");
    res.json({ case: await enrichOne(c), person, weatherSignals: weatherFor(person), forecast: forecastFor(person), prediction: predictionFor(person) });
  });

  app.get("/api/cases/:caseId/overview", async (req, res) => {
    const c = store.getCase(String(req.params.caseId));
    if (!c) throw new ApiError("not_found", "Case not found.");
    const person = store.getPersonWithAccount(c.personId);
    res.json({ case: await enrichOne(c), person, weatherSignals: weatherFor(person), forecast: forecastFor(person), prediction: predictionFor(person) });
  });

  // The risk model: what it predicts, how it was trained and how well it did on held-out customers.
  app.get("/api/model/risk", (_req, res) => {
    const m = options.predictions?.model;
    if (!m) throw new ApiError("not_found", "No risk model is loaded on this server.");
    res.json({ model: m, scoredCustomers: options.predictions!.byCustomer.size });
  });

  // The Climate outlook: very hot days a year in every decade, observed and projected, by forecast town.
  app.get("/api/climate/decades", (_req, res) => {
    const d = options.decades;
    if (!d) return res.json({ available: false });
    const w = options.weather?.current() ?? null;
    const customers = new Map<string, number>();
    for (const p of store.allPeople()) { const t = p.address?.postcode ? POSTCODE_TOWN[p.address.postcode] : undefined; if (t) customers.set(t, (customers.get(t) ?? 0) + 1); }
    // Each town sits at the average of its postcodes.
    const townSpot = (id: string) => {
      const spots = Object.entries(POSTCODE_TOWN).filter(([, town]) => town === id).flatMap(([pc]) => (POSTCODE_LOCATION[pc] ? [POSTCODE_LOCATION[pc]!] : []));
      return spots.length ? { lat: spots.reduce((n, s) => n + s[0], 0) / spots.length, lng: spots.reduce((n, s) => n + s[1], 0) / spots.length } : {};
    };
    const byTown = new Map<string, (typeof d.postcodes)[string][]>();
    for (const h of Object.values(d.postcodes)) if (h.town) byTown.set(h.town, [...(byTown.get(h.town) ?? []), h]);
    const avg = (xs: number[]) => (xs.length ? Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 10) / 10 : null);
    const pick = (hs: (typeof d.postcodes)[string][], kind: "observed" | "projected", decade: string) => ({
      hot: avg(hs.flatMap((h) => (h[kind][decade] ? [h[kind][decade]!.hot] : []))), veryHot: avg(hs.flatMap((h) => (h[kind][decade] ? [h[kind][decade]!.veryHot] : []))),
    });
    const towns = [...byTown].map(([id, hs]) => ({
      id, name: w?.towns[id]?.name ?? id, ...townSpot(id), district: w ? (w.districts[w.towns[id]?.district ?? ""] ?? null) : null, customers: customers.get(id) ?? 0,
      observed: Object.fromEntries(d.observedDecades.map((dec) => [dec, pick(hs, "observed", dec)])),
      projected: Object.fromEntries(d.projectedDecades.map((dec) => [dec, pick(hs, "projected", dec)])),
    }));
    res.json({ available: true, thresholds: d.thresholds, observedDecades: d.observedDecades, projectedDecades: d.projectedDecades, observedSource: d.observed, projectedSource: d.projected, towns });
  });
  // The forecast for every town (where it sits and its daily maximums), for shading the case page's weather map.
  app.get("/api/forecast/towns", (_req, res) => {
    const w = options.weather?.current() ?? null;
    if (!w) return res.json({ available: false, towns: [] });
    const towns = Object.entries(w.towns).flatMap(([id, t]) => {
      const spots = Object.entries(POSTCODE_TOWN).filter(([, town]) => town === id).flatMap(([pc]) => (POSTCODE_LOCATION[pc] ? [POSTCODE_LOCATION[pc]!] : []));
      if (!spots.length) return [];
      return [{ id, name: t.name, lat: spots.reduce((n, s) => n + s[0], 0) / spots.length, lng: spots.reduce((n, s) => n + s[1], 0) / spots.length, days: t.days.map((d) => ({ date: d.date, max: d.max })) }];
    });
    res.json({ available: true, towns });
  });
  app.get("/api/emergency", (_req, res) => { res.json(options.emergency?.current() ?? { available: false, fetchedAt: null, error: null, alerts: [] }); });
  app.get("/api/weather", (_req, res) => { res.json(options.weather?.status() ?? { mode: "off", available: false }); });
  // Anyone can switch the weather source for everyone: the sample heatwave, the Bureau's live data, or off.
  app.post("/api/weather/mode", async (req, res) => {
    if (!options.weather) throw new ApiError("not_found", "Weather signals aren't set up on this server.");
    const { mode } = parse(z.object({ mode: z.enum(["live", "demo"]) }), req.body); // "off" is only for the WEATHER_MODE setting (tests)
    await options.weather.setMode(mode);
    res.json(options.weather.status());
  });

  // The AI model in use; anyone can switch it in the demo settings until the server restarts.
  let ai: AiConfig | null = options.ai ?? null;
  const AI_MODELS: { provider: "claude" | "gemini"; model: string; label: string }[] = [
    { provider: "claude", model: "claude-haiku-5-5", label: "Claude Haiku 5.5 · fast, cheapest" },
    { provider: "claude", model: "claude-sonnet-5-5", label: "Claude Sonnet 5.5 · stronger, costs more" },
    { provider: "gemini", model: "gemini-flash-lite-latest", label: "Gemini Flash-Lite · free tier" },
    { provider: "gemini", model: "gemini-flash-latest", label: "Gemini Flash · free tier, often busy" },
  ];
  const keyFor = (p: "claude" | "gemini") => options.aiKeys?.[p] ?? (ai?.provider === p ? ai.apiKey : null);
  const aiStatus = () => ({
    provider: ai?.provider ?? null, model: ai?.models.support ?? null, on: !!ai?.apiKey,
    options: AI_MODELS.map((m) => ({ ...m, available: !!keyFor(m.provider) })),
  });
  app.get("/api/ai", (_req, res) => { res.json(aiStatus()); });
  app.post("/api/ai", (req, res) => {
    const { model } = parse(z.object({ model: z.string() }), req.body);
    const choice = AI_MODELS.find((m) => m.model === model);
    if (!choice) throw new ApiError("validation_failed", "That model isn't one of the options.");
    const apiKey = keyFor(choice.provider);
    if (!apiKey) throw new ApiError("validation_failed", `No ${choice.provider === "claude" ? "Anthropic" : "Gemini"} API key is set on the server.`);
    ai = { provider: choice.provider, apiKey, models: { support: model, signals: model } };
    res.json(aiStatus());
  });

  // Customer insights: counts across every customer, for the infographic page. Worked out from the same cases,
  // signals and risk scores as everywhere else, and kept for a minute because it reads all of them.
  let insightsCache: { at: number; key: string; body: unknown } | null = null;
  app.get("/api/insights", async (_req, res) => {
    const key = store.casesSignature();
    if (insightsCache && insightsCache.key === key && Date.now() - insightsCache.at < 60_000) return res.json(insightsCache.body);
    const data = await dataset();
    const defs = new Map(data.circumstances.map((c) => [c.id, c]));
    const areaLabel = new Map(data.supportAreas.map((a) => [a.id, a.label]));
    const byPerson = new Map(data.cases.map((c) => [c.personId, c]));
    const bump = (m: Map<string, number>, k: string) => { m.set(k, (m.get(k) ?? 0) + 1); };
    const priority = new Map<string, number>(), circumstance = new Map<string, number>(), area = new Map<string, number>();
    const needGroup = new Map<string, number>(), need = new Map<string, number>(), supportGroup = new Map<string, number>();
    const risk = new Map<string, number>(), howMany = new Map<number, number>();
    let rising = 0, sensitive = 0, safety = 0, north = 0;
    for (const p of data.people) {
      const c = byPerson.get(p.id);
      bump(priority, c?.modelAssessment.priority?.label ?? "none");
      if (c?.modelAssessment.trend === "rising") rising++;
      const ids = [...new Set((c?.circumstances ?? []).map((x) => x.circumstanceId))];
      for (const id of ids) { bump(circumstance, id); }
      for (const aid of new Set(ids.map((id) => defs.get(id)?.supportAreaId).filter((x): x is string => !!x))) bump(area, aid);
      if (ids.some((id) => defs.get(id)?.sensitivity === "sensitive")) sensitive++;
      if (ids.some((id) => defs.get(id)?.sensitivity === "safety")) safety++;
      howMany.set(Math.min(ids.length, 6), (howMany.get(Math.min(ids.length, 6)) ?? 0) + 1);
      const sens = sensitivityOf(p);
      for (const g of new Set(sens.map((s) => s.group))) bump(needGroup, g);
      for (const s of sens) bump(need, s.id);
      const signals = [...sens, ...(p.signalSummary?.account ?? []), ...(p.signalSummary?.selfReport ?? [])];
      bump(supportGroup, primarySupportGroup(signals));
      const r = riskFor(p);
      if (!r) bump(risk, "none");
      else { const x = r.baseRate ? r.probability / r.baseRate : 0; bump(risk, x >= 10 ? "very_high" : x >= 4 ? "high" : x >= 1.5 ? "raised" : "low"); }
      if (p.account?.region.northOf26th ?? p.signalSummary?.northOf26th) north++;
    }
    const top = (m: Map<string, number>, n: number) => [...m].sort((a, b) => b[1] - a[1]).slice(0, n);
    const body = {
      total: data.people.length, rising, sensitive, safety, north,
      priority: ["urgent", "high", "moderate", "routine", "none"].map((label) => ({ label, count: priority.get(label) ?? 0 })),
      circumstances: top(circumstance, 10).map(([id, count]) => ({ id, label: defs.get(id)?.label ?? id, count, sensitivity: defs.get(id)?.sensitivity ?? "standard" })),
      areas: top(area, 8).map(([id, count]) => ({ id, label: areaLabel.get(id) ?? id, count })),
      needGroups: ["health", "supply", "cost", "isolation"].map((group) => ({ group, count: needGroup.get(group) ?? 0 })),
      needs: top(need, 10).map(([id, count]) => ({ id, label: SENSITIVITY[id]?.label ?? id, group: SENSITIVITY[id]?.group ?? "cost", count })),
      supportGroups: ["health", "supply", "bills", "concessions", "coaching", "monitor"].map((id) => ({ id, count: supportGroup.get(id) ?? 0 })),
      risk: ["very_high", "high", "raised", "low", "none"].map((id) => ({ id, count: risk.get(id) ?? 0 })),
      howMany: [0, 1, 2, 3, 4, 5, 6].map((n) => ({ n, count: howMany.get(n) ?? 0 })),
    };
    insightsCache = { at: Date.now(), key, body };
    res.json(body);
  });

  // How many customers each flowchart box applies to: signals found, circumstances flagged, solutions offered.
  let flowCountsCache: { at: number; key: string; body: unknown } | null = null;
  app.get("/api/flow/counts", async (_req, res) => {
    const flowDoc = await currentFlow();
    const key = `${store.casesSignature()}|${flowDoc ? docId(flowDoc) : "fixture"}`;
    if (flowCountsCache && flowCountsCache.key === key && Date.now() - flowCountsCache.at < 60_000) return res.json(flowCountsCache.body);
    const data = await dataset();
    const signals: Record<string, number> = {}, circumstances: Record<string, number> = {}, solutions: Record<string, number> = {};
    const add = (m: Record<string, number>, ids: Iterable<string>) => { for (const id of new Set(ids)) m[id] = (m[id] ?? 0) + 1; };
    for (const c of data.cases) {
      add(circumstances, c.circumstances.map((x) => x.circumstanceId));
      add(signals, c.circumstances.flatMap((x) => (x.signals ?? []).map((s) => s.id)));
      add(solutions, c.recommendations.map((x) => x.recommendationId));
    }
    const body = { total: data.people.length, signals, circumstances, solutions };
    flowCountsCache = { at: Date.now(), key, body };
    res.json(body);
  });

  // The help chat: how the tool works, from a written description, with no customer data. Each visitor gets a few
  // questions every ten minutes, since every answer is a paid call.
  const asked = new Map<string, number[]>();
  // Anyone can switch the help chat on or off in the demo settings, for everyone, until the server restarts.
  let assistantOn = false;
  app.get("/api/assistant/status", (_req, res) => { res.json({ on: assistantOn, available: !!ai?.apiKey }); });
  app.post("/api/assistant/status", (req, res) => {
    assistantOn = parse(z.object({ on: z.boolean() }), req.body).on;
    res.json({ on: assistantOn, available: !!ai?.apiKey });
  });
  app.post("/api/assistant", async (req, res) => {
    if (!assistantOn) throw new ApiError("unavailable", "The help assistant is switched off.");
    const { messages } = parse(z.object({ messages: z.array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().min(1).max(MAX_MESSAGE_CHARS * 4) })).min(1).max(MAX_HISTORY) }), req.body);
    const who = String(req.headers["fly-client-ip"] ?? req.ip ?? "unknown"), now = Date.now();
    const recent = (asked.get(who) ?? []).filter((t) => now - t < 10 * 60_000);
    if (recent.length >= 15) throw new ApiError("unavailable", "That's a lot of questions. Try again in a few minutes.");
    asked.set(who, [...recent, now]);
    const trimmed = messages.map((m) => ({ role: m.role, content: m.content.slice(0, MAX_MESSAGE_CHARS) }));
    res.json(await answerQuestion(ai, trimmed));
  });

  // Plans are kept per case version and flowchart version, so each case calls the AI once until it changes.
  const plans = new WeakMap<object, Map<string, Promise<SupportPlan>>>();
  const noFlow = {};
  app.get("/api/cases/:caseId/plan", async (req, res) => {
    const raw = store.getCase(String(req.params.caseId));
    if (!raw) throw new ApiError("not_found", "Case not found.");
    const doc = await currentFlow();
    const byDoc = plans.get(doc ?? noFlow) ?? new Map<string, Promise<SupportPlan>>();
    plans.set(doc ?? noFlow, byDoc);
    const kind = (PLAN_KINDS.includes(req.query.kind as PlanKind) ? req.query.kind : "support") as PlanKind;
    // Weather signals change with the forecast, so they are part of the key: a new heat forecast drafts a new plan.
    const wxSignals = weatherFor(store.getPerson(raw.personId));
    // The model is part of the key too, so switching it drafts fresh summaries.
    const key = `${kind}:${raw.id}@${raw.version}:${ai ? `${ai.provider}/${ai.models[kind]}` : "off"}:${wxSignals.map((s) => s.evidence).join("|")}`;
    let plan = byDoc.get(key);
    if (!plan) {
      const c = await enrichOne(raw);
      const cat = doc ? catalogOf(doc) : store.catalog;
      const person = store.getPersonWithAccount(c.personId);
      const facts = planFacts(kind, c, person, cat, store.catalog.asOf, wxSignals);
      const acct = person?.account;
      const contact: ContactRules | undefined = acct ? {
        preferred: acct.contactPreferences.preferredChannel, sms: acct.contactPreferences.smsOptIn, email: acct.contactPreferences.emailOptIn,
        doNotCall: acct.contactPreferences.doNotCall, interpreter: acct.interpreterRequired,
      } : undefined;
      if (!facts) throw new ApiError("not_found", "Nothing to summarise for this case.");
      plan = draftPlan(kind, facts, ai, c.recommendations.map((r) => r.recommendationId), contact, perthToday(clock()));
      byDoc.set(key, plan);
      plan.catch(() => byDoc.delete(key)); // failures are retried on the next load
    }
    res.json({ plan: await plan });
  });

  app.post("/api/cases", async (req, res) => {
    const c = service.createCase(actor(res), parse(newCaseBody, req.body));
    res.status(201).json({ case: await enrichOne(c), person: store.getPersonWithAccount(c.personId) });
  });

  app.post("/api/cases/bulk/assignment", async (req, res) => {
    const b = parse(assignBody, req.body);
    res.json(await enrichResult(service.assign(actor(res), b.assigneeUserId, b.items)));
  });

  app.post("/api/cases/bulk/status", async (req, res) => {
    const b = parse(bulkStatusBody, req.body);
    res.json(await enrichResult(service.setStatus(actor(res), b.status, b.items, true)));
  });

  app.patch("/api/cases/:caseId/status", async (req, res) => {
    const b = parse(statusBody, req.body);
    res.json(await enrichResult(service.setStatus(actor(res), b.status, [{ caseId: String(req.params.caseId), expectedVersion: b.expectedVersion }], false)));
  });

  app.post("/api/cases/:caseId/notes", async (req, res) => {
    const b = parse(noteBody, req.body);
    res.status(201).json({ case: await enrichOne(service.addNote(actor(res), String(req.params.caseId), b.text, b.expectedVersion)) });
  });

  app.patch("/api/cases/:caseId/notes/:noteId", async (req, res) => {
    const b = parse(noteBody, req.body);
    res.json({ case: await enrichOne(service.editNote(actor(res), String(req.params.caseId), String(req.params.noteId), b.text, b.expectedVersion)) });
  });

  app.patch("/api/cases/:caseId/review", async (req, res) => {
    const b = parse(reviewBody, req.body);
    res.json(await enrichResult(service.setReview(actor(res), String(req.params.caseId), b.reviewStatus, b.expectedVersion)));
  });

  app.post("/api/workflow-actions/:actionId/undo", async (req, res) => {
    res.json(await enrichResult(service.undo(actor(res), String(req.params.actionId))));
  });

  app.use("/api", (_req, _res, next) => next(new ApiError("not_found", "No such endpoint.")));

  if (options.staticDir) {
    const dir = options.staticDir;
    app.use(express.static(dir));
    app.get(/^\/(?!api\/).*/, (_req, res) => { res.sendFile(join(dir, "index.html")); });
  }

  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof ApiError) {
      res.status(err.status).json({ error: { code: err.code, message: err.message, details: err.details, ...(err.extra ? { current: (err.extra as { current: unknown }).current } : {}) } });
      return;
    }
    const bad = err as { type?: string; status?: number };
    if (bad.type === "entity.too.large") {
      res.status(422).json({ error: { code: "validation_failed", message: "That is too much text for one request (the limit is about 100 KB, roughly 100,000 characters).", details: [] } });
      return;
    }
    if (bad.type === "entity.parse.failed") {
      res.status(422).json({ error: { code: "validation_failed", message: "The request body is not valid JSON.", details: [] } });
      return;
    }
    console.error(err);
    res.status(500).json({ error: { code: "internal_error", message: "Something went wrong.", details: [] } });
  });

  return app;
}
