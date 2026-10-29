import { DatabaseSync } from "node:sqlite";
import { closeSync, mkdirSync, openSync, readFileSync, readSync } from "node:fs";
import { dirname } from "node:path";
import { accountSignalSummary, toDataset, type CaseNote, type CustomerAccount, type Person, type QueueCase, type QueueDataset, type RawFixture } from "@greenspark/shared";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS group_tasks (
 id TEXT PRIMARY KEY, kind TEXT NOT NULL DEFAULT 'solution', group_ids TEXT NOT NULL DEFAULT '[]',
 solution_id TEXT, event_date TEXT NOT NULL, scope TEXT NOT NULL, scope_postcodes TEXT NOT NULL DEFAULT '[]',
 assignee_user_id TEXT NOT NULL, due_date TEXT NOT NULL, created_by TEXT NOT NULL,
 created_at TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 1, cancelled INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS group_task_members (
 task_id TEXT NOT NULL REFERENCES group_tasks(id) ON DELETE CASCADE, person_id TEXT NOT NULL,
 case_id TEXT NOT NULL, completed INTEGER NOT NULL DEFAULT 0, updated_by TEXT, updated_at TEXT,
 PRIMARY KEY(task_id, person_id)
);
CREATE INDEX IF NOT EXISTS group_task_member_person ON group_task_members(person_id);
CREATE TABLE IF NOT EXISTS group_task_areas (
 task_id TEXT NOT NULL REFERENCES group_tasks(id) ON DELETE CASCADE, postcode TEXT NOT NULL,
 completed INTEGER NOT NULL DEFAULT 0, updated_by TEXT, updated_at TEXT,
 PRIMARY KEY(task_id, postcode)
);
CREATE INDEX IF NOT EXISTS group_task_area_postcode ON group_task_areas(postcode);
CREATE INDEX IF NOT EXISTS group_task_event_solution ON group_tasks(event_date, solution_id, cancelled);
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS people (seq INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT UNIQUE NOT NULL, doc TEXT NOT NULL, is_created INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS accounts (person_id TEXT PRIMARY KEY, doc TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS cases (
  seq INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT UNIQUE NOT NULL, person_id TEXT NOT NULL,
  static_doc TEXT NOT NULL, is_created INTEGER NOT NULL DEFAULT 0,
  version INTEGER NOT NULL, status TEXT NOT NULL, assigned_to TEXT, follow_up_at TEXT,
  review_status TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS cases_person_seq ON cases(person_id, seq);
CREATE TABLE IF NOT EXISTS notes (seq INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT UNIQUE NOT NULL, case_id TEXT NOT NULL, author_id TEXT NOT NULL, text TEXT NOT NULL, created_at TEXT NOT NULL, edited_at TEXT, edited_by TEXT);
CREATE TABLE IF NOT EXISTS note_edits (seq INTEGER PRIMARY KEY AUTOINCREMENT, note_id TEXT NOT NULL, previous_text TEXT NOT NULL, edited_by TEXT NOT NULL, edited_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS workflow_actions (id TEXT PRIMARY KEY, type TEXT NOT NULL, actor_id TEXT NOT NULL, created_at TEXT NOT NULL, undone_at TEXT, undone_by TEXT);
CREATE TABLE IF NOT EXISTS workflow_action_items (action_id TEXT NOT NULL, case_id TEXT NOT NULL, before_doc TEXT NOT NULL, after_doc TEXT NOT NULL, resulting_version INTEGER NOT NULL, PRIMARY KEY (action_id, case_id));
`;

type Row = Record<string, string | number | null>;

export interface WorkflowSnapshot {
  status: string;
  assignedToUserId: string | null;
  // Optional for action logs written before follow-up dates were included.
  followUpAt?: string | null;
}

/**
 * Utility accounts are kept in their own table and read one at a time (the case page). People are stored without
 * them, with a signal summary instead, so the queue never loads thousands of accounts into memory.
 * `accountsPath` is an optional JSON Lines file of { personId, account } for fixtures too big to hold their
 * accounts inline (the full dataset import).
 */
export class Store {
  readonly db: DatabaseSync;
  readonly catalog: QueueDataset; // read-only fixture data: catalogs, users

  constructor(dbPath: string, fixturePath: string, private readonly accountsPath: string | null = null) {
    const raw = JSON.parse(readFileSync(fixturePath, "utf8")) as RawFixture;
    // People and cases are always read from the database, so the catalog keeps only the fixed catalogs.
    this.catalog = { ...toDataset(raw), people: [], cases: [] };
    if (dbPath !== ":memory:") mkdirSync(dirname(dbPath), { recursive: true });
    this.db = new DatabaseSync(dbPath);
    this.db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;");
    this.db.exec(SCHEMA);
    // Databases created before notes could be edited lack the edit columns.
    const noteColumns = (this.db.prepare("PRAGMA table_info(notes)").all() as Row[]).map((c) => c.name);
    if (!noteColumns.includes("edited_at")) this.db.exec("ALTER TABLE notes ADD COLUMN edited_at TEXT; ALTER TABLE notes ADD COLUMN edited_by TEXT;");
    // Group tasks gained their kind and area scope; older tables are rebuilt once. Task IDs are
    // kept, so member rows stay valid against the rebuilt table.
    const taskColumns = (this.db.prepare("PRAGMA table_info(group_tasks)").all() as Row[]).map((c) => c.name);
    if (!taskColumns.includes("kind")) {
      const oldIndexes = (this.db.prepare("PRAGMA index_list(group_tasks)").all() as Row[]).map((r) => String(r.name)).filter((n) => n.startsWith("group_task_"));
      for (const name of oldIndexes) this.db.exec(`DROP INDEX ${name}`);
      // Member rows survive the rebuild: the old table's foreign key would cascade them away.
      const oldMembers = this.db.prepare("SELECT task_id, person_id, case_id, completed, updated_by, updated_at FROM group_task_members").all() as Row[];
      this.db.exec(`
        ALTER TABLE group_tasks RENAME TO group_tasks_old;
        CREATE TABLE group_tasks (
          id TEXT PRIMARY KEY, kind TEXT NOT NULL, group_ids TEXT NOT NULL, solution_id TEXT,
          event_date TEXT NOT NULL, scope TEXT NOT NULL, scope_postcodes TEXT NOT NULL,
          assignee_user_id TEXT NOT NULL, due_date TEXT NOT NULL, created_by TEXT NOT NULL,
          created_at TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 1, cancelled INTEGER NOT NULL DEFAULT 0
        );
        INSERT INTO group_tasks (id, kind, group_ids, solution_id, event_date, scope, scope_postcodes, assignee_user_id, due_date, created_by, created_at, version, cancelled)
        SELECT id, 'solution', '["' || group_id || '"]', solution_id, event_date, scope, '[]', assignee_user_id, due_date, created_by, created_at, version, cancelled FROM group_tasks_old;
        DROP TABLE group_task_members;
        DROP TABLE group_tasks_old;
        CREATE TABLE group_task_members (
          task_id TEXT NOT NULL REFERENCES group_tasks(id) ON DELETE CASCADE, person_id TEXT NOT NULL,
          case_id TEXT NOT NULL, completed INTEGER NOT NULL DEFAULT 0, updated_by TEXT, updated_at TEXT,
          PRIMARY KEY(task_id, person_id)
        );
        CREATE INDEX group_task_member_person ON group_task_members(person_id);
        CREATE INDEX group_task_event_solution ON group_tasks(event_date, solution_id, cancelled);
        CREATE INDEX group_task_event_kind ON group_tasks(event_date, kind, cancelled);
      `);
      const addMember = this.db.prepare("INSERT INTO group_task_members (task_id, person_id, case_id, completed, updated_by, updated_at) VALUES (?,?,?,?,?,?)");
      for (const m of oldMembers) addMember.run(String(m.task_id), String(m.person_id), String(m.case_id), Number(m.completed), m.updated_by == null ? null : String(m.updated_by), m.updated_at == null ? null : String(m.updated_at));
    } else this.db.exec("CREATE INDEX IF NOT EXISTS group_task_event_kind ON group_tasks(event_date, kind, cancelled);");
    // A new fixture dataset (a different datasetId) replaces everything, including workflow changes.
    const seeded = this.getMeta("seeded_dataset");
    if (seeded && seeded !== raw.metadata.datasetId) this.clear();
    if (!this.getMeta("seeded_dataset")) this.seed(raw);
    else this.refreshSeededPeople(raw);
    this.moveInlineAccounts();
    this.assignCasesWithoutWorker(raw);
    this.numberAccountsWithoutOne();
  }

  /** People added in the queue before every person had an account number get the next free numbers. */
  private numberAccountsWithoutOne() {
    const rows = this.db.prepare("SELECT id, doc FROM people WHERE json_extract(doc, '$.accountNumber') IS NULL ORDER BY seq").all() as Row[];
    if (!rows.length) return;
    const update = this.db.prepare("UPDATE people SET doc = ? WHERE id = ?");
    this.transaction(() => {
      for (const r of rows) update.run(JSON.stringify({ ...JSON.parse(r.doc as string), accountNumber: this.nextAccountNumber() }), r.id);
    });
  }

  nextAccountNumber(): string {
    const r = this.db.prepare("SELECT MAX(CAST(SUBSTR(json_extract(doc, '$.accountNumber'), 6) AS INTEGER)) AS n FROM people").get() as Row;
    return `DEMO-${((r.n as number | null) ?? 700000) + 1}`;
  }

  getPersonByAccount(accountNumber: string): Person | null {
    const r = this.db.prepare("SELECT doc FROM people WHERE json_extract(doc, '$.accountNumber') = ?").get(accountNumber) as Row | undefined;
    return r ? (JSON.parse(r.doc as string) as Person) : null;
  }

  /** The account's case (the latest, should an older database hold more than one). */
  getCaseForPerson(personId: string): QueueCase | null {
    const r = this.db.prepare("SELECT id FROM cases WHERE person_id = ? ORDER BY seq DESC LIMIT 1").get(personId) as Row | undefined;
    return r ? this.getCase(r.id as string) : null;
  }

  /** The account number to show for a case, or null if its person has none. */
  accountNumberOfCase(caseId: string): string | null {
    const r = this.db.prepare("SELECT json_extract(p.doc, '$.accountNumber') AS a FROM cases c JOIN people p ON p.id = c.person_id WHERE c.id = ?").get(caseId) as Row | undefined;
    return (r?.a as string | null | undefined) ?? null;
  }

  /**
   * Every case has a worker. Databases from before that rule can hold cases with none: give seeded cases the
   * fixture's worker and other cases the support workers in turn. Each one gets a new version, so stale edits and
   * undos are refused.
   */
  private assignCasesWithoutWorker(raw: RawFixture) {
    const rows = this.db.prepare("SELECT id, seq FROM cases WHERE assigned_to IS NULL ORDER BY seq").all() as Row[];
    if (!rows.length) return;
    const workers = this.catalog.users.filter((u) => u.role === "support_worker").map((u) => u.id);
    const fromFixture = new Map(raw.cases.map((c) => [c.id, c.workflow.assignedToUserId]));
    const now = new Date().toISOString();
    const update = this.db.prepare("UPDATE cases SET assigned_to = ?, version = version + 1, updated_at = ? WHERE id = ? AND assigned_to IS NULL");
    this.transaction(() => {
      rows.forEach((r, k) => {
        const id = r.id as string;
        update.run(fromFixture.get(id) ?? workers[k % workers.length]!, now, id);
      });
    });
  }

  /**
   * Seeded people are read-only in the app, so their records follow the fixture. This brings new fixture
   * fields (such as accounts) into an existing database without a reset; people added in the queue are untouched.
   */
  private refreshSeededPeople(raw: RawFixture) {
    const update = this.db.prepare("UPDATE people SET doc = ? WHERE id = ? AND is_created = 0 AND doc <> ?");
    const current = this.db.prepare("SELECT doc FROM people WHERE id = ?");
    this.transaction(() => {
      for (const p of raw.people) {
        if (p.account) { this.putAccount(p); continue; }
        // No inline account (it is in the accounts file): keep the summary already stored.
        const old = current.get(p.id) as Row | undefined;
        const summary = old ? (JSON.parse(old.doc as string) as Person).signalSummary ?? null : null;
        const doc = JSON.stringify({ ...p, signalSummary: summary });
        update.run(doc, p.id, doc);
      }
    });
  }

  /** Stores a person's account in the accounts table, and the person without it but with its signal summary. */
  private putAccount(p: Person) {
    const { account, ...rest } = p;
    if (!account) return;
    this.db.prepare("INSERT INTO accounts (person_id, doc) VALUES (?, ?) ON CONFLICT(person_id) DO UPDATE SET doc = excluded.doc").run(p.id, JSON.stringify(account));
    this.sourceIds = null;
    const doc = JSON.stringify({ ...rest, signalSummary: accountSignalSummary(p, this.catalog.asOf) });
    this.db.prepare("UPDATE people SET doc = ? WHERE id = ? AND doc <> ?").run(doc, p.id, doc);
    this.peopleCache = null;
  }

  /** Databases from before the accounts table hold accounts inside people; move them out. */
  private moveInlineAccounts() {
    const rows = this.db.prepare("SELECT doc FROM people WHERE json_extract(doc, '$.account') IS NOT NULL").all() as Row[];
    if (!rows.length) return;
    this.transaction(() => { for (const r of rows) this.putAccount(JSON.parse(r.doc as string) as Person); });
  }

  /**
   * Loads the accounts file into the accounts table, with each person's summary. It is JSON Lines of
   * { personId, account }, read a megabyte at a time so a large file never sits in memory whole.
   */
  private loadAccountsFile() {
    if (!this.accountsPath) return;
    const people = new Map((this.db.prepare("SELECT id, doc FROM people").all() as Row[]).map((r) => [r.id as string, r.doc as string]));
    const fd = openSync(this.accountsPath, "r");
    const chunk = Buffer.alloc(1 << 20);
    let rest = "";
    const take = (line: string) => {
      if (!line.trim()) return;
      const { personId, account } = JSON.parse(line) as { personId: string; account: CustomerAccount };
      const doc = people.get(personId);
      if (doc) this.putAccount({ ...(JSON.parse(doc) as Person), account });
    };
    try {
      this.transaction(() => {
        for (let n = readSync(fd, chunk); n > 0; n = readSync(fd, chunk)) {
          const lines = (rest + chunk.toString("utf8", 0, n)).split("\n");
          rest = lines.pop()!;
          lines.forEach(take);
        }
        take(rest);
      });
    } finally { closeSync(fd); }
  }

  close() { this.db.close(); }

  getMeta(key: string): string | null {
    const r = this.db.prepare("SELECT value FROM meta WHERE key = ?").get(key) as Row | undefined;
    return r ? (r.value as string) : null;
  }

  /** Empties every table, ready to seed a new dataset. */
  private clear() {
    this.transaction(() => {
      for (const t of ["group_task_members", "group_task_areas", "group_tasks", "workflow_action_items", "workflow_actions", "note_edits", "notes", "cases", "accounts", "people", "meta"]) this.db.exec(`DELETE FROM ${t}`);
    });
  }

  private seed(raw: RawFixture) {
    this.transaction(() => {
      const addPerson = this.db.prepare("INSERT INTO people (id, doc) VALUES (?, ?)");
      const addAccount = this.db.prepare("INSERT INTO accounts (person_id, doc) VALUES (?, ?)");
      for (const p of raw.people) {
        const { account, ...rest } = p;
        addPerson.run(p.id, JSON.stringify(account ? { ...rest, signalSummary: accountSignalSummary(p, this.catalog.asOf) } : rest));
        if (account) addAccount.run(p.id, JSON.stringify(account));
      }
      const addCase = this.db.prepare(
        "INSERT INTO cases (id, person_id, static_doc, version, status, assigned_to, follow_up_at, review_status, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)",
      );
      const addNote = this.db.prepare("INSERT INTO notes (id, case_id, author_id, text, created_at) VALUES (?,?,?,?,?)");
      for (const c of raw.cases) {
        const { version, workflow, ...rest } = c;
        addCase.run(c.id, c.personId, JSON.stringify(rest), version, workflow.status, workflow.assignedToUserId, workflow.followUpAt, workflow.reviewStatus, workflow.createdAt, workflow.updatedAt);
        for (const n of workflow.notes) addNote.run(n.id, c.id, n.authorUserId, n.text, n.createdAt);
      }
      this.db.prepare("INSERT INTO meta (key, value) VALUES ('seeded_dataset', ?)").run(raw.metadata.datasetId);
    });
    this.loadAccountsFile();
  }

  /** Runs fn in one SQLite transaction; any throw rolls everything back. */
  transaction<T>(fn: () => T): T {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const out = fn();
      this.db.exec("COMMIT");
      return out;
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
  }

  /** Each case's fixed part, parsed once: static docs never change after they are written. */
  private statics = new Map<string, Omit<QueueCase, "version" | "workflow">>();
  private assemble(row: Row, notes: CaseNote[]): QueueCase {
    let rest = this.statics.get(row.id as string);
    if (!rest) { rest = JSON.parse(row.static_doc as string) as Omit<QueueCase, "version" | "workflow">; this.statics.set(row.id as string, rest); }
    return {
      ...rest,
      version: row.version as number,
      workflow: {
        status: row.status as QueueCase["workflow"]["status"],
        assignedToUserId: row.assigned_to as string | null,
        createdAt: row.created_at as string,
        updatedAt: row.updated_at as string,
        followUpAt: row.follow_up_at as string | null,
        reviewStatus: row.review_status as QueueCase["workflow"]["reviewStatus"],
        notes,
      },
    };
  }

  private notesByCase(caseId?: string): Map<string, CaseNote[]> {
    const rows = (caseId
      ? this.db.prepare("SELECT * FROM notes WHERE case_id = ? ORDER BY seq").all(caseId)
      : this.db.prepare("SELECT * FROM notes ORDER BY seq").all()) as Row[];
    const m = new Map<string, CaseNote[]>();
    for (const r of rows) {
      const list = m.get(r.case_id as string) ?? [];
      list.push({
        id: r.id as string, text: r.text as string, authorUserId: r.author_id as string, createdAt: r.created_at as string,
        ...(r.edited_at ? { editedAt: r.edited_at as string, editedByUserId: r.edited_by as string | null } : {}),
      });
      m.set(r.case_id as string, list);
    }
    return m;
  }

  allCases(): QueueCase[] {
    const notes = this.notesByCase();
    return (this.db.prepare("SELECT * FROM cases ORDER BY seq").all() as Row[]).map((r) => this.assemble(r, notes.get(r.id as string) ?? []));
  }

  getCase(id: string): QueueCase | null {
    const r = this.db.prepare("SELECT * FROM cases WHERE id = ?").get(id) as Row | undefined;
    return r ? this.assemble(r, this.notesByCase(id).get(id) ?? []) : null;
  }

  /**
   * People, parsed once and kept until one is added. Person records never change after they are written (seeded
   * people are only refreshed when the server starts), so every request can share them. Don't modify them.
   */
  private peopleCache: { list: Person[]; byId: Map<string, Person> } | null = null;
  private people() {
    if (!this.peopleCache) {
      const list = (this.db.prepare("SELECT doc FROM people ORDER BY seq").all() as Row[]).map((r) => JSON.parse(r.doc as string) as Person);
      this.peopleCache = { list, byId: new Map(list.map((p) => [p.id, p])) };
    }
    return this.peopleCache;
  }

  allPeople(): Person[] {
    return this.people().list;
  }

  getPerson(id: string): Person | null {
    return this.people().byId.get(id) ?? null;
  }

  /** Each person's customer ID in the source dataset, from their account (for the risk model's scores). */
  private sourceIds: Map<string, string> | null = null;
  sourceCustomerId(personId: string): string | null {
    if (!this.sourceIds) {
      const rows = this.db.prepare("SELECT person_id, json_extract(doc, '$.sourceCustomerId') AS sid FROM accounts").all() as Row[];
      this.sourceIds = new Map(rows.filter((r) => r.sid).map((r) => [r.person_id as string, r.sid as string]));
    }
    return this.sourceIds.get(personId) ?? null;
  }

  /** The person with their utility account, for one case. */
  getPersonWithAccount(id: string): Person | null {
    const p = this.getPerson(id);
    if (!p) return null;
    const r = this.db.prepare("SELECT doc FROM accounts WHERE person_id = ?").get(id) as Row | undefined;
    return r ? { ...p, account: JSON.parse(r.doc as string) as CustomerAccount } : p;
  }

  /** Changes whenever a case is added or changed (every change bumps its version): a cheap key for caches. */
  casesSignature(): string {
    const r = this.db.prepare("SELECT COUNT(*) AS n, COALESCE(SUM(version), 0) AS v, MAX(updated_at) AS u FROM cases").get() as Row;
    return `${r.n}:${r.v}:${r.u}`;
  }

  dataset(): QueueDataset {
    return { ...this.catalog, people: this.allPeople(), cases: this.allCases() };
  }

  nextCaseNumber(): number {
    const r = this.db.prepare("SELECT MAX(CAST(SUBSTR(id, 4) AS INTEGER)) AS n FROM cases").get() as Row;
    return ((r.n as number | null) ?? 2000) + 1;
  }

  nextPersonNumber(): number {
    const r = this.db.prepare("SELECT MAX(CAST(SUBSTR(id, 13) AS INTEGER)) AS n FROM people").get() as Row;
    return ((r.n as number | null) ?? 0) + 1;
  }

  insertPerson(p: Person) {
    this.db.prepare("INSERT INTO people (id, doc, is_created) VALUES (?, ?, 1)").run(p.id, JSON.stringify(p));
    this.peopleCache = null;
  }

  insertCase(c: QueueCase) {
    const { version, workflow, ...rest } = c;
    this.db.prepare(
      "INSERT INTO cases (id, person_id, static_doc, is_created, version, status, assigned_to, follow_up_at, review_status, created_at, updated_at) VALUES (?,?,?,1,?,?,?,?,?,?,?)",
    ).run(c.id, c.personId, JSON.stringify(rest), version, workflow.status, workflow.assignedToUserId, workflow.followUpAt, workflow.reviewStatus, workflow.createdAt, workflow.updatedAt);
  }

  /** Applies a status/assignment change and bumps the version. Returns the new version. */
  updateWorkflow(caseId: string, patch: { status?: string; assignedToUserId?: string | null; reviewStatus?: string; followUpAt?: string | null }, updatedAt: string): number {
    const cur = this.db.prepare("SELECT version, status, assigned_to, review_status, follow_up_at FROM cases WHERE id = ?").get(caseId) as Row;
    const version = (cur.version as number) + 1;
    this.db.prepare("UPDATE cases SET version = ?, status = ?, assigned_to = ?, review_status = ?, follow_up_at = ?, updated_at = ? WHERE id = ?").run(
      version,
      patch.status ?? (cur.status as string),
      patch.assignedToUserId === undefined ? (cur.assigned_to as string | null) : patch.assignedToUserId,
      patch.reviewStatus ?? (cur.review_status as string),
      patch.followUpAt === undefined ? (cur.follow_up_at as string | null) : patch.followUpAt,
      updatedAt,
      caseId,
    );
    return version;
  }

  addNote(n: CaseNote & { caseId: string }) {
    this.db.prepare("INSERT INTO notes (id, case_id, author_id, text, created_at) VALUES (?,?,?,?,?)").run(n.id, n.caseId, n.authorUserId, n.text, n.createdAt);
  }

  getNote(caseId: string, noteId: string): CaseNote | null {
    return this.notesByCase(caseId).get(caseId)?.find((n) => n.id === noteId) ?? null;
  }

  /** Replaces a note's text, keeping the previous wording in note_edits. */
  updateNote(noteId: string, text: string, editorId: string, at: string) {
    const prev = this.db.prepare("SELECT text FROM notes WHERE id = ?").get(noteId) as Row;
    this.db.prepare("INSERT INTO note_edits (note_id, previous_text, edited_by, edited_at) VALUES (?,?,?,?)").run(noteId, prev.text as string, editorId, at);
    this.db.prepare("UPDATE notes SET text = ?, edited_at = ?, edited_by = ? WHERE id = ?").run(text, at, editorId, noteId);
  }

  noteCount(): number {
    return (this.db.prepare("SELECT COUNT(*) AS n FROM notes").get() as Row).n as number;
  }

  logAction(id: string, type: string, actorId: string, createdAt: string, items: { caseId: string; before: WorkflowSnapshot; after: WorkflowSnapshot; resultingVersion: number }[]) {
    this.db.prepare("INSERT INTO workflow_actions (id, type, actor_id, created_at) VALUES (?,?,?,?)").run(id, type, actorId, createdAt);
    const add = this.db.prepare("INSERT INTO workflow_action_items (action_id, case_id, before_doc, after_doc, resulting_version) VALUES (?,?,?,?,?)");
    for (const i of items) add.run(id, i.caseId, JSON.stringify(i.before), JSON.stringify(i.after), i.resultingVersion);
  }

  getAction(id: string) {
    const a = this.db.prepare("SELECT * FROM workflow_actions WHERE id = ?").get(id) as Row | undefined;
    if (!a) return null;
    const items = (this.db.prepare("SELECT * FROM workflow_action_items WHERE action_id = ?").all(id) as Row[]).map((r) => ({
      caseId: r.case_id as string,
      before: JSON.parse(r.before_doc as string) as WorkflowSnapshot,
      after: JSON.parse(r.after_doc as string) as WorkflowSnapshot,
      resultingVersion: r.resulting_version as number,
    }));
    return {
      id: a.id as string, type: a.type as string, actorId: a.actor_id as string, createdAt: a.created_at as string,
      undoneAt: a.undone_at as string | null, items,
    };
  }

  markUndone(id: string, by: string, at: string) {
    this.db.prepare("UPDATE workflow_actions SET undone_at = ?, undone_by = ? WHERE id = ?").run(at, by, id);
  }
}
