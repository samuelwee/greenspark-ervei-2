import { useCallback, useEffect, useMemo, useRef, useState, lazy, Suspense } from "react";
import type { CaseStatus, QueueQuery, ReviewStatus, StaffUser } from "./domain/types";
import { ApiClientError, createApiClient, type Catalog, type CaseItem, type CaseListResponse, type ErrorDetail, type MutationResult } from "./data/api";
import { ASSISTANCE_OPTIONS, DEFAULT_QUERY, MAX_BULK_ITEMS, activeFilterCount } from "./domain/query";
import { addSelection } from "./domain/selection";
import { PRIORITY_TEXT, STATUS_LABELS } from "./domain/format";
import { FilterSidebar } from "./components/FilterSidebar";
import { CaseTable } from "./components/CaseTable";
import type { MapSummary } from "./data/api";
// Leaflet only loads when the map view is first opened.
const CaseMap = lazy(() => import("./components/CaseMap").then((m) => ({ default: m.CaseMap })));
import { accountHref, DATA_SOURCES_PATH, FLOWCHART_PATH, PRIORITY_MODEL_PATH, CASE_PAGE_PATH, RISK_MODEL_PATH, OUTLOOK_MODEL_PATH, QUEUE_PATH, FUNNEL_PATH, isModifiedClick, useRoute, type Page } from "./route";
import { DemoSettings } from "./components/DemoSettings";
import { OutlookPage } from "./components/OutlookPage";
// Pages other than the outlook load on first visit, which keeps the first download small.
const CaseDetails = lazy(() => import("./components/CaseDetails").then((m) => ({ default: m.CaseDetails })));
const DataSourcesPage = lazy(() => import("./components/DataSourcesPage").then((m) => ({ default: m.DataSourcesPage })));
const PriorityModelPage = lazy(() => import("./components/PriorityModelPage").then((m) => ({ default: m.PriorityModelPage })));
const CasePageGuide = lazy(() => import("./components/CasePageGuide").then((m) => ({ default: m.CasePageGuide })));
const PredictionsPage = lazy(() => import("./components/PredictionsPage").then((m) => ({ default: m.PredictionsPage })));
const RiskModelPage = lazy(() => import("./components/RiskModelPage").then((m) => ({ default: m.RiskModelPage })));
const OutlookModelPage = lazy(() => import("./components/OutlookModelPage").then((m) => ({ default: m.OutlookModelPage })));
const FunnelPage = lazy(() => import("./components/FunnelPage").then((m) => ({ default: m.FunnelPage })));
const AdminPage = lazy(() => import("./admin/AdminPage").then((m) => ({ default: m.AdminPage })));

interface Notice {
  kind: "success" | "error";
  message: string;
  details?: ErrorDetail[];
  undoActionId?: string | null;
}

const STORED_USER_KEY = "greenspark.demoUser";

function initialUser(): string {
  try { return localStorage.getItem(STORED_USER_KEY) ?? "staff-manager"; } catch { return "staff-manager"; }
}

export function App() {
  const [userId, setUserId] = useState(initialUser);
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [error, setError] = useState<string | null>(null);
  const userRef = useRef(userId);
  userRef.current = userId;
  const client = useMemo(() => createApiClient(() => userRef.current), []);
  const { accountNumber, predictionsAccount, page, navigate } = useRoute();

  const loadCatalog = useCallback(() => {
    setError(null);
    client.catalog().then(setCatalog, (e: unknown) => setError(e instanceof Error ? e.message : "Could not load the case queue."));
  }, [client]);
  useEffect(loadCatalog, [loadCatalog, userId]);
  // Circumstances and solutions come from the flowchart, so leaving the Flowchart page picks up any edits.
  const lastPage = useRef(page);
  useEffect(() => {
    if (lastPage.current === "admin" && page !== "admin") client.catalog().then(setCatalog, () => undefined);
    lastPage.current = page;
  }, [client, page]);

  const switchUser = (id: string) => {
    try { localStorage.setItem(STORED_USER_KEY, id); } catch { /* storage is optional */ }
    setCatalog(null);
    setUserId(id);
  };

  if (error) return <div className="state-screen" role="alert"><h1>We couldn’t load the case queue</h1><p>{error}</p><button className="btn" onClick={loadCatalog}>Try again</button></div>;
  if (!catalog) return <div className="state-screen" role="status"><p>Loading cases…</p></div>;
  const user = catalog.users.find((u) => u.id === userId) ?? catalog.users[0]!;
  return <Workspace key={user.id} catalog={catalog} user={user} client={client} openAccount={accountNumber} predictionsAccount={predictionsAccount} page={page} navigate={navigate} onSwitchUser={switchUser} />;
}

type Client = ReturnType<typeof createApiClient>;

function Workspace(props: { catalog: Catalog; user: StaffUser; client: Client; openAccount: string | null; predictionsAccount: string | null; page: Page; navigate: (to: string) => void; onSwitchUser: (id: string) => void }) {
  const { catalog, user, client, navigate } = props;
  // The open case is named by its account number (the main ID); case IDs stay internal.
  const openAccount = props.openAccount;
  const accountOf = (i: CaseItem | null | undefined) => i?.person?.accountNumber ?? null;
  const [query, setQuery] = useState<QueueQuery>(DEFAULT_QUERY);
  const [searchText, setSearchText] = useState("");
  const [view, setView] = useState<"list" | "map">(() => { try { return localStorage.getItem("queue-view") === "map" ? "map" : "list"; } catch { return "list"; } });
  const chooseView = (v: "list" | "map") => { setView(v); try { localStorage.setItem("queue-view", v); } catch { /* per-browser preference only */ } };
  const [mapSummary, setMapSummary] = useState<MapSummary | null>(null);
  const [mapError, setMapError] = useState<string | null>(null);
  const [list, setList] = useState<CaseListResponse | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshTick, setRefreshTick] = useState(0);
  // A new catalog means the flowchart may have changed, so reload the list too.
  const firstCatalog = useRef(catalog);
  useEffect(() => { if (catalog !== firstCatalog.current) setRefreshTick((t) => t + 1); }, [catalog]);
  const [loadedListKey, setLoadedListKey] = useState<string | null>(null);
  const [validatedSelectionKey, setValidatedSelectionKey] = useState<string | null>(null);
  const [selectionError, setSelectionError] = useState<string | null>(null);
  // Selected case IDs map to the version the user last saw, so bulk requests carry expectedVersion.
  const [selected, setSelected] = useState<Map<string, number>>(new Map());
  const [openItem, setOpenItem] = useState<CaseItem | null>(null);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [busy, setBusy] = useState(false);
  const [bulkAssignee, setBulkAssignee] = useState("");
  const [bulkStatus, setBulkStatus] = useState<CaseStatus>("in_progress");
  const [caseLoad, setCaseLoad] = useState<{ status: "loading" | "missing" | "error"; message?: string } | null>(null);
  const [caseRetry, setCaseRetry] = useState(0);
  const lastOpened = useRef<string | null>(null);
  const noticeTimer = useRef<number | undefined>(undefined);
  const isManager = user.role === "manager";
  const refresh = () => setRefreshTick((n) => n + 1);
  const filterKey = JSON.stringify({ ...query, page: 0, sort: "", pageSize: 0 });
  const selectionKey = `${filterKey}:${refreshTick}`;
  const listKey = `${JSON.stringify(query)}:${refreshTick}`;
  const hasSelection = selected.size > 0;
  // Key comparisons block actions in the render that changes the query, before effects run.
  const selectionPending = hasSelection && validatedSelectionKey !== selectionKey;
  const listPending = loading || loadedListKey !== listKey;
  const bulkDisabled = busy || listPending || selectionPending || searchText !== query.search || selected.size > MAX_BULK_ITEMS;

  useEffect(() => () => window.clearTimeout(noticeTimer.current), []);

  // Load the case for /accounts/:accountNumber. It shows at once from the list when we have it, then refreshes from the server.
  useEffect(() => {
    if (!openAccount) {
      setOpenItem(null);
      setCaseLoad(null);
      return;
    }
    let current = true;
    setCaseLoad({ status: "loading" });
    setOpenItem((o) => (accountOf(o) === openAccount ? o : list?.items.find((i) => accountOf(i) === openAccount) ?? null));
    client.account(openAccount).then(
      (fresh) => {
        if (!current) return;
        setOpenItem((o) => (o?.case.id === fresh.case.id && o.case.version > fresh.case.version ? o : fresh));
        setCaseLoad(null);
      },
      (e: unknown) => {
        if (!current) return;
        setOpenItem((o) => (e instanceof ApiClientError && e.status === 404 ? null : o));
        setCaseLoad(e instanceof ApiClientError && e.status === 404 ? { status: "missing" } : { status: "error", message: errorText(e) });
      },
    );
    return () => { current = false; };
  }, [client, openAccount, caseRetry]); // eslint-disable-line react-hooks/exhaustive-deps

  // Going back to the queue puts keyboard focus on the case you came from.
  useEffect(() => {
    if (openAccount) { lastOpened.current = openAccount; return; }
    const id = lastOpened.current;
    lastOpened.current = null;
    if (id) document.querySelector<HTMLElement>(`[data-account-link="${CSS.escape(id)}"]`)?.focus();
  }, [openAccount]);

  useEffect(() => {
    if (props.page !== "queue" && props.page !== "case") return; // the other pages set their own
    document.title = openItem && openAccount ? `${accountOf(openItem) ?? ""} · ${catalogNameFor(openItem)} · ERVEI` : "Case queue · ERVEI";
  }, [openItem, openAccount, props.page]);

  // Debounce the search box so we don't query on every keystroke.
  useEffect(() => {
    const t = window.setTimeout(() => {
      setQuery((q) => (q.search === searchText ? q : { ...q, search: searchText, page: 1 }));
    }, 250);
    return () => window.clearTimeout(t);
  }, [searchText]);

  // Only the queue (and a case opened from it) needs the list; the outlook and other pages don't load it.
  const wantsQueue = props.page === "queue" || props.page === "case";
  // Load the current page whenever the query or data changes. Older responses are ignored.
  useEffect(() => {
    if (!wantsQueue) return;
    let current = true;
    setLoading(true);
    client.list(query).then(
      (r) => {
        if (!current) return;
        setList(r);
        setListError(null);
        setLoading(false);
        setLoadedListKey(listKey);
        if (r.page !== query.page) setQuery((q) => ({ ...q, page: r.page }));
        // Refresh remembered versions for selected rows we can see on this page.
        setSelected((s) => {
          let changed = false;
          const n = new Map(s);
          for (const i of r.items) if (n.has(i.case.id) && n.get(i.case.id) !== i.case.version) { n.set(i.case.id, i.case.version); changed = true; }
          return changed ? n : s;
        });
        setOpenItem((o) => {
          const fresh = o && r.items.find((i) => i.case.id === o.case.id);
          // List rows leave out the utility account, so keep the open case's full person record.
          return fresh && fresh.case.version > o.case.version ? { ...o, case: fresh.case } : o;
        });
      },
      (e: unknown) => {
        if (!current) return;
        setListError(e instanceof Error ? e.message : "Could not load cases.");
        setLoading(false);
      },
    );
    return () => { current = false; };
  }, [client, query, refreshTick, wantsQueue]);

  // The map shows every matching case, so it ignores the page and sort; it loads only while the map is shown.
  const { page: _page, sort: _sort, ...mapQuery } = query;
  const mapKey = JSON.stringify(mapQuery);
  useEffect(() => {
    if (props.page !== "queue" || view !== "map" || !client.mapSummary) return;
    let current = true;
    client.mapSummary(query).then(
      (m) => { if (current) { setMapSummary(m); setMapError(null); } },
      (e: unknown) => { if (current) setMapError(e instanceof Error ? e.message : "Could not load the map."); },
    );
    return () => { current = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reload on filter changes only, not paging or sorting
  }, [client, view, mapKey, refreshTick, props.page]);

  // Filter changes (and data changes) drop selected IDs that no longer match.
  useEffect(() => {
    setSelectionError(null);
    if (!hasSelection) {
      setValidatedSelectionKey(selectionKey);
      return;
    }
    let current = true;
    client.matchingIds(query).then((ids) => {
      if (!current) return;
      const keep = new Set(ids);
      setSelected((s) => (s.size && [...s.keys()].some((id) => !keep.has(id)) ? new Map([...s].filter(([id]) => keep.has(id))) : s));
      setValidatedSelectionKey(selectionKey);
    }, () => {
      if (current) setSelectionError("Couldn’t verify the selected cases. Retry or clear the selection before applying changes.");
    });
    return () => { current = false; };
  }, [client, selectionKey, hasSelection]); // selectionKey includes all filters and the refresh generation

  const say = (n: Notice | null) => {
    window.clearTimeout(noticeTimer.current);
    setNotice(n);
    if (n && n.kind === "success") noticeTimer.current = window.setTimeout(() => setNotice(null), n.undoActionId ? 20000 : 6000);
  };

  const change = (patch: Partial<QueueQuery>) => setQuery((q) => ({ ...q, ...patch, page: "page" in patch ? patch.page! : 1 }));
  const reset = () => { setSearchText(""); setQuery({ ...DEFAULT_QUERY }); };

  const open = (accountNumber: string) => navigate(accountHref(accountNumber));

  const nameOf = (id: string | null) => (id ? catalog.users.find((u) => u.id === id)?.displayName ?? id : "nobody");

  function applyUpdated(r: MutationResult) {
    setOpenItem((o) => {
      const u = o && r.updated.find((c) => c.id === o.case.id);
      return u && o && u.version >= o.case.version ? { ...o, case: u } : o;
    });
    setSelected((s) => {
      const n = new Map(s);
      for (const c of r.updated) if (n.has(c.id)) n.set(c.id, c.version);
      return n;
    });
  }

  async function refreshCases(ids: string[]): Promise<boolean> {
    const results = await Promise.allSettled([...new Set(ids)].map(async (id) => {
      const fresh = await client.overview(id);
      setOpenItem((o) => o?.case.id === id && fresh.case.version >= o.case.version ? fresh : o);
      setSelected((s) => s.has(id) ? new Map(s).set(id, Math.max(s.get(id)!, fresh.case.version)) : s);
    }));
    return results.every((r) => r.status === "fulfilled");
  }

  async function handleError(e: unknown) {
    if (e instanceof ApiClientError && e.code === "version_conflict") {
      if (e.current) {
        applyUpdated({ actionId: null, updated: [e.current], unchanged: [] });
      }
      say({ kind: "error", message: "That case was changed by someone else. It has been refreshed. Review it and try again." });
    } else if (e instanceof ApiClientError && e.code === "bulk_validation_failed") {
      const stale = e.details.filter((d) => d.code === "version_conflict" && d.caseId);
      const affected = e.details.filter((d) => (d.code === "version_conflict" || d.code === "forbidden") && d.caseId);
      const refreshed = await refreshCases(affected.map((d) => d.caseId!));
      const conflictMessage = refreshed
        ? "No changes were made. Some cases changed; their latest details are loaded. Review them and apply again."
        : "No changes were made. Couldn’t refresh some changed cases. Reopen them before retrying.";
      say({
        kind: "error",
        message: stale.length ? conflictMessage : "No changes were made. Some cases can’t be updated:",
        details: e.details,
      });
    } else if (e instanceof ApiClientError && e.code === "forbidden") {
      const refreshed = openItem && await refreshCases([openItem.case.id]);
      say({ kind: "error", message: errorText(e) + (refreshed ? " The latest case details have been loaded." : " Reopen the case to load its latest assignment.") });
    } else {
      say({ kind: "error", message: errorText(e) });
    }
    refresh();
  }

  async function run(fn: () => Promise<MutationResult>, describe: (r: MutationResult) => string): Promise<boolean> {
    setBusy(true);
    try {
      const r = await fn();
      applyUpdated(r);
      const same = r.unchanged.length ? ` ${r.unchanged.length} already had that value.` : "";
      say({ kind: "success", message: r.updated.length ? describe(r) + same : `Nothing to change.${same}`, undoActionId: r.actionId });
      refresh();
      return true;
    } catch (e) {
      await handleError(e);
      return false;
    } finally {
      setBusy(false);
    }
  }

  const versioned = (c: { id: string; version: number }) => ({ caseId: c.id, expectedVersion: c.version });
  const selectedItems = () => [...selected].map(([caseId, expectedVersion]) => ({ caseId, expectedVersion }));
  const plural = (n: number) => `${n} case${n === 1 ? "" : "s"}`;

  const actions = {
    onAssign: (userId: string) =>
      run(() => client.assign(userId, [versioned(openItem!.case)]), () => `Assigned to ${nameOf(userId)}.`),
    onStatus: (status: CaseStatus) =>
      run(() => client.setStatus(status, [versioned(openItem!.case)]), () => `Status set to ${STATUS_LABELS[status]}.`),
    onReview: (next: ReviewStatus) =>
      run(() => client.setReview(openItem!.case.id, next, openItem!.case.version), () => (next === "reviewed" ? "Marked as reviewed." : "Marked as needs review.")),
    onEditNote: async (noteId: string, text: string) => {
      setBusy(true);
      try {
        const updated = await client.editNote(openItem!.case.id, noteId, text, openItem!.case.version);
        applyUpdated({ actionId: null, updated: [updated], unchanged: [] });
        say({ kind: "success", message: "Note updated." });
        refresh();
        return true;
      } catch (e) {
        await handleError(e);
        return false;
      } finally {
        setBusy(false);
      }
    },
    onNote: async (text: string) => {
      setBusy(true);
      try {
        const updated = await client.addNote(openItem!.case.id, text, openItem!.case.version);
        applyUpdated({ actionId: null, updated: [updated], unchanged: [] });
        say({ kind: "success", message: "Note added." });
        refresh();
        return true;
      } catch (e) {
        await handleError(e);
        return false;
      } finally {
        setBusy(false);
      }
    },
  };

  const bulkAssign = () => {
    if (bulkDisabled || !hasSelection || !bulkAssignee || selected.size > MAX_BULK_ITEMS) return;
    return run(() => client.assign(bulkAssignee, selectedItems()), (r) => `Assigned ${plural(r.updated.length)} to ${nameOf(bulkAssignee)}.`);
  };
  const bulkSetStatus = () => {
    if (bulkDisabled || !hasSelection || selected.size > MAX_BULK_ITEMS) return;
    return run(() => client.setStatus(bulkStatus, selectedItems()), (r) => `Set ${plural(r.updated.length)} to ${STATUS_LABELS[bulkStatus]}.`);
  };

  async function undo(actionId: string) {
    setBusy(true);
    try {
      const r = await client.undo(actionId);
      applyUpdated(r);
      say({ kind: "success", message: `Undone. ${plural(r.updated.length)} restored.` });
      refresh();
    } catch (e) {
      await handleError(e);
    } finally {
      setBusy(false);
    }
  }

  const rows = list?.items ?? [];
  const filterCount = activeFilterCount({ ...query, search: searchText });
  const addSelected = (items: { caseId: string; expectedVersion: number }[]) => {
    const result = addSelection(selected, items);
    setSelected(result.selected);
    if (result.limited) say({ kind: "error", message: `You can select up to ${MAX_BULK_ITEMS} cases per action. The remaining cases were not selected; process them separately.` });
  };
  const toggleRow = (id: string, on: boolean) => {
    if (bulkDisabled) return;
    const row = rows.find((r) => r.case.id === id);
    if (on && row) addSelected([versioned(row.case)]);
    else setSelected((s) => { const n = new Map(s); n.delete(id); return n; });
  };
  const togglePage = (on: boolean) => {
    if (bulkDisabled) return;
    if (on) addSelected(rows.map((r) => versioned(r.case)));
    else setSelected((s) => { const n = new Map(s); for (const r of rows) n.delete(r.case.id); return n; });
  };

  return (
    <div className="app">
      <a className="skip" href="#queue">Skip to main content</a>
      <header className="topbar">
        <a
          className="brand"
          href="/"
          title="Go to the weather outlook"
          onClick={(e) => {
            if (isModifiedClick(e)) return; // let the browser open a new tab
            e.preventDefault();
            navigate("/");
          }}
        >
          <span className="logo" aria-hidden="true">🌱</span>
          <span><strong>ERVEI</strong><span className="brand-sub">Community support workspace</span></span>
        </a>
        <nav className="mainnav" aria-label="Main">
          {([["/", "Weather outlook", "outlook"], [FUNNEL_PATH, "Funnel", "funnel"], [QUEUE_PATH, "Case queue", "queue"]] as const).map(([href, label, page]) => (
            <a key={href} href={href} aria-current={props.page === page ? "page" : undefined} onClick={(e) => { if (isModifiedClick(e)) return; e.preventDefault(); navigate(href); }}>{label}</a>
          ))}
          <BtsMenu page={props.page} navigate={navigate} />
        </nav>
        <DemoSettings client={client} users={catalog.users} user={user} onSwitchUser={props.onSwitchUser} />
      </header>

      <Suspense fallback={<div className="state-screen" role="status"><p>Loading…</p></div>}>
      {props.page === "outlook" ? (
        <OutlookPage client={client} navigate={navigate} />
      ) : props.page === "funnel" ? (
        <FunnelPage client={client} navigate={navigate} />
      ) : props.page === "admin" ? (
        <AdminPage client={client} />
      ) : props.page === "data" ? (
        <DataSourcesPage client={client} />
      ) : props.page === "priority" ? (
        <PriorityModelPage />
      ) : props.page === "casepage" ? (
        <CasePageGuide />
      ) : props.page === "outlookmodel" ? (
        <OutlookModelPage />
      ) : props.page === "riskmodel" ? (
        <RiskModelPage client={client} />
      ) : props.page === "predictions" && props.predictionsAccount ? (
        <PredictionsPage client={client} accountNumber={props.predictionsAccount} navigate={navigate} />
      ) : openAccount ? (
        <main id="queue" className="detail-main" tabIndex={-1}>
          <a
            className="back-link"
            href={QUEUE_PATH}
            onClick={(e) => {
              if (isModifiedClick(e)) return;
              e.preventDefault();
              navigate(QUEUE_PATH);
            }}
          >
            ← Back to case queue
          </a>
          <NoticeBar notice={notice} busy={busy} onUndo={undo} onDismiss={() => say(null)} />
          {openItem ? (
            <CaseDetails key={openItem.case.id} data={catalog} item={openItem} user={user} busy={busy} actions={actions} loadPlan={client.supportPlan} client={client} navigate={navigate} />
          ) : caseLoad?.status === "missing" ? (
            <div className="empty" role="alert"><h1>Case not found</h1><p>There is no case for account {openAccount}. It may have been mistyped.</p></div>
          ) : caseLoad?.status === "error" ? (
            <div className="empty" role="alert"><h1>We couldn’t load this case</h1><p>{caseLoad.message}</p><button type="button" className="btn" onClick={() => setCaseRetry((n) => n + 1)}>Try again</button></div>
          ) : (
            <div className="empty" role="status"><p>Loading case…</p></div>
          )}
        </main>
      ) : (
      <div className="shell">
        <button type="button" className="btn filters-toggle" aria-expanded={filtersOpen} aria-controls="sidebar" onClick={() => setFiltersOpen((v) => !v)}>
          Filters{filterCount ? ` (${filterCount})` : ""}
        </button>
        <aside id="sidebar" className={`sidebar${filtersOpen ? " is-open" : ""}`} aria-label="Filters">
          <FilterSidebar data={catalog} facets={list?.facets ?? null} query={query} onChange={change} onReset={reset} />
        </aside>

        <main id="queue" className="main" tabIndex={-1}>
          <div className="page-head">
            <h1>Case queue</h1>
          </div>

          <NoticeBar notice={notice} busy={busy} onUndo={undo} onDismiss={() => say(null)} />

          <section className="counters" aria-label="Active case shortcuts (all cases, not filtered)">
            <div className="counter"><strong>{list?.counters.urgent ?? "–"}</strong><span>Urgent cases</span></div>
            <div className="counter"><strong>{list?.counters.myActive ?? "–"}</strong><span>My active cases</span></div>
          </section>
          <p className="hint counters-note">Counters cover all unresolved cases and ignore the filters.</p>

          <section className="panel" aria-labelledby="list-title" aria-busy={loading}>
            <div className="panel-head">
              <h2 id="list-title">{({ all: "All cases", mine: "Assigned to me", needs_review: "Needs review" })[query.view]} <span className="pill">{list?.total ?? "–"}</span></h2>
              <span className="view-switch" role="group" aria-label="Show cases as">
                <button type="button" aria-pressed={view === "list"} onClick={() => chooseView("list")}>List</button>
                <button type="button" aria-pressed={view === "map"} onClick={() => chooseView("map")}>Map</button>
              </span>
            </div>

            <div className="toolbar">
              <label className="search">
                <span className="sr-only">Search by name, account number or suburb</span>
                <input type="search" placeholder="Search name, account number or suburb…" value={searchText} onChange={(e) => setSearchText(e.target.value)} />
              </label>
              <label className="sort" hidden={view === "map"}>
                <span className="sr-only">Sort cases</span>
                <select value={query.sort} onChange={(e) => change({ sort: e.target.value as QueueQuery["sort"] })}>
                  <option value="priority_desc">Priority: highest first</option>
                  <option value="priority_asc">Priority: lowest first</option>
                  <option value="risk_desc">Predicted risk: highest first</option>
                  <option value="followup">Follow-up: soonest</option>
                  <option value="updated">Recently updated</option>
                  <option value="name">Name A–Z</option>
                </select>
              </label>
            </div>

            <div className="chips" role="group" aria-label="Active filters">
              {query.circumstanceIds.map((id) => <Chip key={id} label={catalog.circumstances.find((c) => c.id === id)?.label ?? id} onRemove={() => change({ circumstanceIds: query.circumstanceIds.filter((x) => x !== id) })} />)}
              {query.assistanceIds.map((id) => <Chip key={id} label={ASSISTANCE_OPTIONS.find((o) => o.id === id)?.label ?? id} onRemove={() => change({ assistanceIds: query.assistanceIds.filter((x) => x !== id) })} />)}
              {query.priorityLabels.map((l) => <Chip key={l} label={`Priority: ${PRIORITY_TEXT[l]}`} onRemove={() => change({ priorityLabels: query.priorityLabels.filter((x) => x !== l) })} />)}
              {query.minPriorityScore > 0 ? <Chip label={`Score ≥ ${query.minPriorityScore}`} onRemove={() => change({ minPriorityScore: 0 })} /> : null}
              {query.assessmentStatus ? <Chip label={`Assessment: ${query.assessmentStatus}`} onRemove={() => change({ assessmentStatus: "" })} /> : null}
              {query.status ? <Chip label={`Status: ${STATUS_LABELS[query.status]}`} onRemove={() => change({ status: "" })} /> : null}
              {query.assignedToUserId ? <Chip label={`Worker: ${catalog.users.find((u) => u.id === query.assignedToUserId)?.displayName ?? query.assignedToUserId}`} onRemove={() => change({ assignedToUserId: "" })} /> : null}
            </div>

            {view === "map" ? (
              mapError && !mapSummary ? (
                <div className="empty" role="alert"><h3>We couldn’t load the map</h3><p>{mapError}</p><button type="button" className="btn" onClick={refresh}>Try again</button></div>
              ) : !mapSummary ? (
                <div className="empty" role="status"><p>Loading the map…</p></div>
              ) : (
                <Suspense fallback={<div className="empty" role="status"><p>Loading the map…</p></div>}>
                  <CaseMap summary={mapSummary} onOpen={open} />
                </Suspense>
              )
            ) : null}

            {view === "list" && selected.size > 0 ? (
              <div className="bulkbar" role="region" aria-label="Selected cases">
                <strong>{selected.size} selected</strong>
                <span className="hint">Maximum {MAX_BULK_ITEMS} cases per action.</span>
                {selectionPending ? <span role="status">{selectionError ?? "Checking selected cases…"}</span> : null}
                {selectionPending && selectionError ? <button type="button" className="link-btn" onClick={refresh}>Retry selection</button> : null}
                <label className="inline">
                  <span className="sr-only">Assign selected cases to</span>
                  <select value={bulkAssignee} disabled={!isManager || bulkDisabled} onChange={(e) => setBulkAssignee(e.target.value)} title={isManager ? undefined : "Only managers can assign cases"}>
                    <option value="" disabled>Choose a worker</option>
                    {catalog.users.filter((u) => catalog.assignableUserIds.includes(u.id)).map((u) => <option key={u.id} value={u.id}>{u.displayName}</option>)}
                  </select>
                </label>
                <button type="button" className="btn btn-small" disabled={!isManager || bulkDisabled || !bulkAssignee} onClick={bulkAssign}>Assign</button>
                <label className="inline">
                  <span className="sr-only">Set status of selected cases to</span>
                  <select value={bulkStatus} disabled={bulkDisabled} onChange={(e) => setBulkStatus(e.target.value as CaseStatus)}>
                    {Object.entries(STATUS_LABELS).map(([id, l]) => <option key={id} value={id}>{l}</option>)}
                  </select>
                </label>
                <button type="button" className="btn btn-small" disabled={bulkDisabled} onClick={bulkSetStatus}>Update status</button>
                <button type="button" className="link-btn" onClick={() => setSelected(new Map())}>Clear selection</button>
                {!isManager ? <span className="hint">Workers can only update cases assigned to them.</span> : null}
              </div>
            ) : null}

            {view === "map" ? null : listError && !list ? (
              <div className="empty" role="alert"><h3>We couldn’t load cases</h3><p>{listError}</p><button type="button" className="btn" onClick={refresh}>Try again</button></div>
            ) : !list ? (
              <div className="empty" role="status"><p>Loading cases…</p></div>
            ) : list.total === 0 ? (
              <div className="empty"><h3>No cases match</h3><p>Try removing a filter or changing the search.</p><button type="button" className="btn" onClick={reset}>Reset filters</button></div>
            ) : (
              <CaseTable
                data={catalog} rows={rows} currentUserId={user.id} selectedIds={new Set(selected.keys())}
                selectionDisabled={bulkDisabled}
                onToggleRow={toggleRow} onTogglePage={togglePage} onOpen={open}
              />
            )}
            {listError && list ? <p className="list-error" role="alert">Couldn’t refresh: {listError} <button type="button" className="link-btn" onClick={refresh}>Retry</button></p> : null}

            <div className="pager" hidden={view === "map"}>
              <span aria-live="polite">{list ? `Showing ${list.from}–${list.to} of ${list.total} cases` : ""}</span>
              <nav aria-label="Pagination">
                <button type="button" className="btn btn-small" disabled={!list || list.page <= 1} onClick={() => change({ page: query.page - 1 })}>Previous</button>
                <span className="page-no">Page {list?.page ?? 1} of {list?.pageCount ?? 1}</span>
                <button type="button" className="btn btn-small" disabled={!list || list.page >= list.pageCount} onClick={() => change({ page: query.page + 1 })}>Next</button>
              </nav>
            </div>
          </section>

          <footer className="foot"><span>Demo date {catalog.asOf}</span></footer>
        </main>

      </div>
      )}
      </Suspense>
    </div>
  );
}

function catalogNameFor(item: CaseItem): string {
  return item.person?.displayName ?? "Unknown person";
}

function errorText(e: unknown): string {
  if (e instanceof ApiClientError) return e.message;
  return e instanceof Error ? e.message : "Something went wrong.";
}

function NoticeBar(props: { notice: Notice | null; busy: boolean; onUndo: (id: string) => void; onDismiss: () => void }) {
  const n = props.notice;
  return (
    <div className="notice-slot" role={n?.kind === "error" ? "alert" : "status"} aria-live="polite">
      {n ? (
        <div className={`notice notice-${n.kind}`}>
          <div>
            <p>{n.message}</p>
            {n.details?.length ? (
              <ul>{n.details.map((d, i) => <li key={i}>{d.accountNumber ? `${d.accountNumber}: ` : ""}{d.message}</li>)}</ul>
            ) : null}
          </div>
          <div className="notice-actions">
            {n.undoActionId ? <button type="button" className="btn btn-small" disabled={props.busy} onClick={() => props.onUndo(n.undoActionId!)}>Undo</button> : null}
            <button type="button" className="icon-btn" aria-label="Dismiss message" onClick={props.onDismiss}>✕</button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function Chip({ label, onRemove }: { label: string; onRemove: () => void }) {
  return (
    <span className="chip">{label}<button type="button" aria-label={`Remove filter ${label}`} onClick={onRemove}>✕</button></span>
  );
}

/** "BTS" (behind the scenes): a menu of the pages about how the demo works. */
function BtsMenu(props: { page: Page; navigate: (to: string) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent ? e.key === "Escape" : !ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", close);
    return () => { document.removeEventListener("mousedown", close); document.removeEventListener("keydown", close); };
  }, [open]);
  // In the order the demo works: the data, the flowchart rules on it, the models built from them, then the pages they feed.
  const items = [[DATA_SOURCES_PATH, "Data sources", "data"], [FLOWCHART_PATH, "Flowchart", "admin"], [PRIORITY_MODEL_PATH, "Priority model", "priority"], [RISK_MODEL_PATH, "Risk model", "riskmodel"], [OUTLOOK_MODEL_PATH, "Weather outlook", "outlookmodel"], [CASE_PAGE_PATH, "Case page", "casepage"]] as const;
  const inside = items.some(([, , page]) => page === props.page);
  return (
    <div className="bts" ref={ref}>
      <button type="button" className={`bts-btn${inside ? " is-current" : ""}`} aria-expanded={open} aria-controls="bts-menu" onClick={() => setOpen(!open)}>
        BTS <span aria-hidden="true">▾</span>
      </button>
      {open ? (
        <ul id="bts-menu" className="bts-menu">
          {items.map(([href, label, page]) => (
            <li key={href}>
              <a
                href={href}
                aria-current={props.page === page ? "page" : undefined}
                onClick={(e) => { if (isModifiedClick(e)) return; e.preventDefault(); setOpen(false); props.navigate(href); }}
              >
                {label}
              </a>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
