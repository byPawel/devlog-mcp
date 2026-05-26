# Memory-Layer Bug Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make devlog-mcp's three advertised-but-broken memory capabilities actually work — bi-temporal contradiction-closing (semantic), feedback-driven routing (affective), and cross-session recall (episodic) — and fix the schema/concurrency foundations they depend on.

**Architecture:** Fix in dependency order: (1) schema + a real migration runner, because the `entity_relations` primary key currently *forbids* the bi-temporal writes the logic attempts; (2) the missing/incorrect write paths; (3) read-side logic (datetime normalization, graph traversal, routing math); (4) concurrency + performance. Each fix is test-first against the real schema (`ensureEntityTables` / `ensureAgentFeedbackTable`), not an ad-hoc inline schema. Keep `README.md` honest per-PR: soften each claim until its code lands, then restore strong wording.

**Tech Stack:** TypeScript (strict ESM), better-sqlite3 + Drizzle, jest + ts-jest (tests inject `globalThis.__TEST_DB__`), LanceDB. Node >= 18.

---

## Execution status (branch `fix/memory-episodic-foundations`, updated 2026-05-26)

| Task | Status | Commit |
|---|---|---|
| 1 — migration runner (wired into startup) | ✅ done | `689954c` |
| 3 — FK pragma on every connection | ✅ done | `e4370f5` |
| 2 — bi-temporal PK + partial-unique-open + ISO datetime + composite index | ✅ done | `f9cb37c` |
| 4 — bi-temporal upsert | 🔧 revised (see below), fix in progress | `65c82ea` + fix |
| 5 — persistence tests on real schema | ✅ done (with Task 4) | `65c82ea` |
| 8, 9 — `as_of` ISO-normalize + UNION ALL (read path) | ⬜ pending | |
| 7, 10 — affective auto-record + `devlog_feedback_route` | ⬜ pending | |
| 6 — episodic `conversation_summaries` write path | ⬜ pending | |
| 15 — README reconciliation | ⬜ pending | |

### ⚠️ Revision to Task 4 (learned during execution)
The first implementation closed **every** open target for a `(source, relation_type)` when a new target arrived — i.e. it assumed all relations are single-valued. A multi-model review found this is **wrong for all four extracted relation types** (`implements`, `depends_on`, `blocks`, `authored_by` are all many-valued): `auth depends_on jwt` then `auth depends_on oauth` would falsely close the jwt window, corrupting the graph.

**Corrected design:** window-closing is gated by an explicit, exported `FUNCTIONAL_RELATION_TYPES` set (relations where a source has at most one valid target). It is **empty for today's taxonomy** → re-extraction never falsely evicts; `upsertRelation` stays idempotent (no-op on an already-open tuple) and simply accumulates multiple open slices for many-valued relations. The window-close path remains tested via a synthetic functional type.

**Consequence for Task 15 (README):** do NOT claim automatic contradiction-detection across re-extractions. The truthful bi-temporal story is: relations carry `valid_from`/`valid_to`; **`as_of` queries return point-in-time state (time-travel)**; closing a window (`valid_to`) removes a fact from current/after views while it stays visible to historical `as_of` reads; for single-valued (functional) relations a superseding fact auto-closes the prior window.

---

## The bug list (verified: 3 Sonnet agents + Gemini synthesis)

Three README claims are currently **false in code**:
- **Bi-temporal contradiction-closing** — `valid_to` is never written; PK forbids time-slices.
- **Affective routing** — `agent_feedback` is write-only; nothing reads it to route.
- **Episodic recall** — `conversation_summaries` has no insert path; `devlog_session_recall` is always empty.

| ID | Sev | Bug | Evidence |
|----|-----|-----|----------|
| BUG-1 | P0 | `entity_relations` PK `(source_id,target_id,relation_type)` allows only one row/tuple → can't store bi-temporal time-slices; reopening a closed fact is dropped | `entity-tables.ts:48` |
| BUG-2 | P0 | Relation write is `INSERT OR IGNORE (... weight)` — never sets `valid_to`, never closes prior window on contradiction | `entity-extractor.ts:666-668` |
| BUG-3 | P0 | `agent_feedback` write-only: no code reads it to route/bias tool or model selection | `feedback-tools.ts`; grep of `src/` |
| BUG-4 | P0 | `conversation_summaries` has no insert path → `devlog_session_recall` always returns `(no past sessions)` | `workspace-tools.ts:590-598` |
| BUG-5 | P1 | No version-gated migration runner; `schema_version` written once, never bumped | `index.ts:230-249` |
| BUG-6 | P1 | `as_of`/`valid_from` datetime format mismatch: `CURRENT_TIMESTAMP` = `'YYYY-MM-DD HH:MM:SS'` vs ISO-`'...T...Z'`; lexicographic `valid_from <= ?` breaks on real data | `entity-tables.ts:45`, `entity-tools.ts:103-107` |
| BUG-7 | P1 | `valid_from` defaults to wall-clock insert time, not document time | `entity-extractor.ts:667` |
| BUG-8 | P1 | Persistence tests inline a schema lacking `valid_from`/`valid_to` → bi-temporal untested at write layer | `entity-extractor.test.ts:176-181,265-271` |
| BUG-9 | P1 | `success_rate` has no minimum-sample guard (1 success = 100%) | `feedback-tools.ts:113` |
| BUG-10 | P1 | No temporal decay — stale failures weighted equally forever | `feedback-tools.ts:108-119` |
| BUG-11 | P1 | `partial`/`rejected`/`timeout` dilute `success_rate` but are invisible | `feedback-tools.ts:111-112` |
| BUG-12 | P1 | No composite index `(agent_id,tool_name,recorded_at)` for the routing query | `schema.sql:367-372` |
| BUG-13 | P1 | FK enforcement is per-connection; `getSqliteDb()` callers may run with FKs OFF | `index.ts:124` |
| BUG-14 | P2 | Recursive CTE uses `UNION` (not `UNION ALL`) → can prune valid paths | `entity-tools.ts:318-328` |
| BUG-15 | P2 | No composite temporal index `(source_id,valid_from,valid_to)` | `entity-tables.ts:69-75` |
| BUG-16 | P2 | `avg_confidence` inflated — NULL confidence on failures excluded by `AVG` | `feedback-tools.ts:66,114` |
| BUG-17 | P2 | Cross-agent contamination when no `agent_id` filter (`GROUP BY tool_name` only) | `feedback-tools.ts:116` |
| BUG-18 | P2 | `since` param unvalidated string → wrong results | `feedback-tools.ts:90,105` |
| BUG-19 | P2 | Lock TOCTOU between `checkLock()` and `fs.rename()` | `lock-manager.ts:42-82` |
| BUG-20 | P2 | `session_log`/`question_add` read-then-write without lock → lost entries | `workspace-tools.ts:306-309`, `question-tools.ts:76-80` |
| BUG-21 | P2 | `workspace_dump` `INSERT OR REPLACE` drops enriched columns + orphans FTS tags | `workspace-tools.ts:500-503` |
| BUG-22 | P2 | No retention/pruning; `CompactionService` never deletes compacted sources → unbounded growth | `compaction-service.ts` |
| BUG-23 | P2 | `entity_content_hashes` no FK on `doc_id` → stale hashes skip re-extraction | `background-indexer.ts:27-33` |
| BUG-24 | P2 | `context_relevance` dead table (never written) | `schema.sql:286-297` |
| BUG-25 | P3 | `questions.json` concurrent-write loss; LIKE wildcards unescaped; entities NULL `canonical_name` bypasses dedup; no `CHECK` on `outcome` | various |

**Tasks below cover P0 + foundational P1 (BUG-1..13). P2/P3 (BUG-14..25) are the backlog at the end.**

---

## File Structure

- `src/db/migrations.ts` — **new.** Version-gated migration runner: ordered `{version, up(db)}` list; applies only those `> MAX(schema_version)`; records each. Single migration entry point replacing scattered `ensureX()` calls.
- `src/db/entity-tables.ts` — **modify.** `entity_relations` gets a surrogate `id` PK + partial unique index on open facts; ISO-8601 datetime defaults; composite temporal index.
- `src/services/entity-extractor.ts` — **modify.** `EntityPersistence` relation write becomes a real bi-temporal upsert (close prior open window on contradiction, then insert) accepting a logical `validFrom`.
- `src/db/agent-feedback.ts` / `src/db/schema.sql` — **modify.** Composite routing index; ISO datetime; `CHECK(outcome IN …)`.
- `src/tools/feedback-tools.ts` — **modify.** Add `devlog_feedback_route` read path (Wilson lower bound + recency decay, min-sample guard, per-agent, outcome breakdown).
- `src/servers/base-server.ts` — **modify.** `withToolTracking` auto-records outcome+latency into `agent_feedback`.
- `src/tools/workspace-tools.ts` — **modify.** Add `conversation_summaries` insert path.
- `src/db/index.ts` — **modify.** `PRAGMA foreign_keys = ON` on every handle; route schema setup through `migrations.ts`.
- `README.md` — **modify.** Reconcile the 3 claims with now-true behavior.
- Tests co-located as `*.test.ts`; all use the real schema via `ensureEntityTables(db)` / the migration runner, injected through `globalThis.__TEST_DB__`.

---

## Phase 1 — Schema & Migrations (unblocks everything)

### Task 1: Version-gated migration runner

**Files:** Create `src/db/migrations.ts`, `src/db/migrations.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// src/db/migrations.test.ts
import Database from 'better-sqlite3';
import { runMigrations, MIGRATIONS } from './migrations.js';

describe('runMigrations', () => {
  let db: Database.Database;
  beforeEach(() => { db = new Database(':memory:'); });
  afterEach(() => db.close());

  it('applies all migrations on a fresh db and records versions', () => {
    runMigrations(db);
    const max = (db.prepare('SELECT MAX(version) v FROM schema_version').get() as { v: number }).v;
    expect(max).toBe(MIGRATIONS[MIGRATIONS.length - 1].version);
  });

  it('is idempotent: a second run applies nothing new', () => {
    runMigrations(db);
    const before = (db.prepare('SELECT COUNT(*) c FROM schema_version').get() as { c: number }).c;
    runMigrations(db);
    const after = (db.prepare('SELECT COUNT(*) c FROM schema_version').get() as { c: number }).c;
    expect(after).toBe(before);
  });
});
```

- [ ] **Step 2: Run to verify it fails** — `npx jest src/db/migrations.test.ts` → FAIL `Cannot find module './migrations.js'`.

- [ ] **Step 3: Write minimal implementation**

```typescript
// src/db/migrations.ts
import type Database from 'better-sqlite3';
import { ensureEntityTables } from './entity-tables.js';
import { ensureAgentFeedbackTable } from './agent-feedback.js';

export interface Migration { version: number; name: string; up: (db: Database.Database) => void; }

// Ordered. Never renumber or delete an applied migration; only append.
export const MIGRATIONS: Migration[] = [
  { version: 1, name: 'entity+feedback tables', up: (db) => { ensureEntityTables(db); ensureAgentFeedbackTable(db); } },
];

export function runMigrations(db: Database.Database): void {
  db.prepare(`CREATE TABLE IF NOT EXISTS schema_version (
    version INTEGER PRIMARY KEY, name TEXT, applied_at TEXT DEFAULT CURRENT_TIMESTAMP
  )`).run();
  const row = db.prepare('SELECT MAX(version) v FROM schema_version').get() as { v: number | null };
  const current = row.v ?? 0;
  const record = db.prepare('INSERT OR IGNORE INTO schema_version (version, name) VALUES (?, ?)');
  const apply = db.transaction((m: Migration) => { m.up(db); record.run(m.version, m.name); });
  for (const m of MIGRATIONS) if (m.version > current) apply(m);
}
```

- [ ] **Step 4: Run to verify it passes** — `npx jest src/db/migrations.test.ts` → PASS (2).

- [ ] **Step 5: Commit**

```bash
git add src/db/migrations.ts src/db/migrations.test.ts
git commit -m "feat(db): add version-gated migration runner (BUG-5)"
```

---

### Task 2: Redesign `entity_relations` PK for bi-temporal time-slices

**Why first:** BUG-2's upsert needs multiple rows per `(source,target,type)` tuple. The current `PRIMARY KEY (source_id,target_id,relation_type)` forbids that. Use a surrogate `id` PK + a **partial unique index** allowing many closed rows but only one *open* row per tuple.

**Files:** Modify `src/db/entity-tables.ts:38-50` + `:69-75`; append a migration in `src/db/migrations.ts`; create `src/db/entity-tables.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// src/db/entity-tables.test.ts
import Database from 'better-sqlite3';
import { ensureEntityTables } from './entity-tables.js';

describe('entity_relations schema (bi-temporal)', () => {
  let db: Database.Database;
  beforeEach(() => { db = new Database(':memory:'); ensureEntityTables(db);
    db.prepare(`INSERT INTO entities (id,type,name) VALUES (1,'file','a'),(2,'file','b')`).run(); });
  afterEach(() => db.close());

  it('allows multiple time-slices for the same tuple (one closed, one open)', () => {
    db.prepare(`INSERT INTO entity_relations (source_id,target_id,relation_type,valid_from,valid_to)
      VALUES (1,2,'uses','2026-01-01T00:00:00Z','2026-05-01T00:00:00Z')`).run();
    db.prepare(`INSERT INTO entity_relations (source_id,target_id,relation_type,valid_from,valid_to)
      VALUES (1,2,'uses','2026-05-01T00:00:00Z',NULL)`).run();
    const n = (db.prepare(`SELECT COUNT(*) c FROM entity_relations WHERE source_id=1 AND target_id=2 AND relation_type='uses'`).get() as {c:number}).c;
    expect(n).toBe(2);
  });

  it('forbids two OPEN rows for the same tuple (partial unique index)', () => {
    db.prepare(`INSERT INTO entity_relations (source_id,target_id,relation_type,valid_to) VALUES (1,2,'uses',NULL)`).run();
    expect(() => db.prepare(`INSERT INTO entity_relations (source_id,target_id,relation_type,valid_to) VALUES (1,2,'uses',NULL)`).run())
      .toThrow(/UNIQUE/);
  });
});
```

- [ ] **Step 2: Run to verify it fails** — `npx jest src/db/entity-tables.test.ts` → FAIL (old PK rejects the second slice with `UNIQUE constraint failed`).

- [ ] **Step 3: Implement** — in `src/db/entity-tables.ts` replace the `entity_relations` CREATE (lines 38-50) with:

```typescript
  sqlite.prepare(`
    CREATE TABLE IF NOT EXISTS entity_relations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source_id INTEGER NOT NULL,
      target_id INTEGER NOT NULL,
      relation_type TEXT NOT NULL,
      weight REAL DEFAULT 1.0,
      metadata_json TEXT,
      valid_from TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
      valid_to TEXT,
      created_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
    )
  `).run();
```

Add after the existing indexes (after line 75):

```typescript
  // Only one OPEN (valid_to IS NULL) row per tuple; closed slices may accumulate.
  sqlite.prepare(`CREATE UNIQUE INDEX IF NOT EXISTS uq_entity_rel_open
    ON entity_relations(source_id, target_id, relation_type) WHERE valid_to IS NULL`).run();
  // Hot path: temporal traversal per node.
  sqlite.prepare(`CREATE INDEX IF NOT EXISTS idx_entity_rel_temporal
    ON entity_relations(source_id, valid_from, valid_to)`).run();
```

For existing databases (table already has the old PK), append to `MIGRATIONS` in `src/db/migrations.ts` (statements run individually, not as a multi-statement script):

```typescript
  { version: 2, name: 'entity_relations surrogate PK + partial-unique open index', up: (db) => {
    const ddl = db.prepare(`SELECT sql FROM sqlite_master WHERE type='table' AND name='entity_relations'`).get() as { sql?: string } | undefined;
    if (!ddl?.sql || ddl.sql.includes('id INTEGER PRIMARY KEY AUTOINCREMENT')) return; // already new shape
    const statements = [
      `ALTER TABLE entity_relations RENAME TO entity_relations_old`,
      `CREATE TABLE entity_relations (
        id INTEGER PRIMARY KEY AUTOINCREMENT, source_id INTEGER NOT NULL, target_id INTEGER NOT NULL,
        relation_type TEXT NOT NULL, weight REAL DEFAULT 1.0, metadata_json TEXT,
        valid_from TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
        valid_to TEXT, created_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')))`,
      `INSERT INTO entity_relations (source_id,target_id,relation_type,weight,metadata_json,valid_from,valid_to,created_at)
        SELECT source_id,target_id,relation_type,weight,metadata_json,valid_from,valid_to,created_at FROM entity_relations_old`,
      `DROP TABLE entity_relations_old`,
      `CREATE UNIQUE INDEX IF NOT EXISTS uq_entity_rel_open ON entity_relations(source_id,target_id,relation_type) WHERE valid_to IS NULL`,
      `CREATE INDEX IF NOT EXISTS idx_entity_rel_temporal ON entity_relations(source_id,valid_from,valid_to)`,
      `CREATE INDEX IF NOT EXISTS idx_entity_rel_source ON entity_relations(source_id)`,
      `CREATE INDEX IF NOT EXISTS idx_entity_rel_target ON entity_relations(target_id)`,
      `CREATE INDEX IF NOT EXISTS idx_entity_rel_valid_to ON entity_relations(valid_to)`,
    ];
    for (const s of statements) db.prepare(s).run();
  }},
```

- [ ] **Step 4: Run to verify it passes** — `npx jest src/db/entity-tables.test.ts` → PASS (2).

- [ ] **Step 5: Commit**

```bash
git add src/db/entity-tables.ts src/db/entity-tables.test.ts src/db/migrations.ts
git commit -m "feat(db): bi-temporal entity_relations PK + partial-unique open index (BUG-1, BUG-15)"
```

---

### Task 3: Enforce `PRAGMA foreign_keys = ON` on every connection (BUG-13)

**Files:** Modify `src/db/index.ts` (the `getSqliteDb` factory); create `src/db/index.fk.test.ts`

- [ ] **Step 1: Failing test**

```typescript
// src/db/index.fk.test.ts
import { getSqliteDb } from './index.js';
it('every sqlite handle has foreign_keys ON', () => {
  const db = getSqliteDb({ projectPath: process.cwd(), devlogFolder: '.devlog-test' });
  expect((db.prepare('PRAGMA foreign_keys').get() as { foreign_keys: number }).foreign_keys).toBe(1);
});
```

- [ ] **Step 2: Run** `npx jest src/db/index.fk.test.ts` → FAIL (`0`).
- [ ] **Step 3: Implement** — in `getSqliteDb`, immediately after `new Database(...)`, add `db.pragma('foreign_keys = ON');` before caching/returning.
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `git commit -am "fix(db): enforce foreign_keys=ON on all connections (BUG-13)"`

---

## Phase 2 — Core Write Paths

### Task 4: Bi-temporal relation upsert that closes the prior window (BUG-2, BUG-7)

**Files:** Modify `src/services/entity-extractor.ts:666-668` + `persistForDocument`; create `src/services/entity-persistence.bitemporal.test.ts`

- [ ] **Step 1: Failing test**

```typescript
// src/services/entity-persistence.bitemporal.test.ts
import Database from 'better-sqlite3';
import { ensureEntityTables } from '../db/entity-tables.js';
import { EntityPersistence } from './entity-extractor.js';

function seed(db: Database.Database) {
  ensureEntityTables(db);
  db.prepare(`INSERT INTO entities (id,type,name,canonical_name) VALUES
    (1,'file','auth','auth'),(2,'concept','jwt','jwt'),(3,'concept','oauth','oauth')`).run();
}

describe('EntityPersistence bi-temporal writes', () => {
  let db: Database.Database;
  beforeEach(() => { db = new Database(':memory:'); seed(db); });
  afterEach(() => db.close());

  it('closes the prior open window when a contradicting relation arrives', () => {
    const p = new EntityPersistence(db);
    p.upsertRelation(1, 2, 'uses', 1.0, '2026-01-01T00:00:00Z');
    p.upsertRelation(1, 3, 'uses', 1.0, '2026-05-01T00:00:00Z');
    const jwt = db.prepare(`SELECT valid_to FROM entity_relations WHERE source_id=1 AND target_id=2`).get() as { valid_to: string | null };
    const oauth = db.prepare(`SELECT valid_to FROM entity_relations WHERE source_id=1 AND target_id=3`).get() as { valid_to: string | null };
    expect(jwt.valid_to).toBe('2026-05-01T00:00:00Z');
    expect(oauth.valid_to).toBeNull();
  });

  it('re-asserting the same open fact is a no-op (stays single open row)', () => {
    const p = new EntityPersistence(db);
    p.upsertRelation(1, 2, 'uses', 1.0, '2026-01-01T00:00:00Z');
    p.upsertRelation(1, 2, 'uses', 1.0, '2026-02-01T00:00:00Z');
    const n = (db.prepare(`SELECT COUNT(*) c FROM entity_relations WHERE source_id=1 AND target_id=2 AND valid_to IS NULL`).get() as {c:number}).c;
    expect(n).toBe(1);
  });
});
```

- [ ] **Step 2: Run** `npx jest src/services/entity-persistence.bitemporal.test.ts` → FAIL (`upsertRelation` not a function).

- [ ] **Step 3: Implement** — in the `EntityPersistence` constructor replace the single `stmtUpsertEntityRelation` with three statements:

```typescript
    this.stmtFindOpenSameTuple = db.prepare(
      `SELECT id FROM entity_relations WHERE source_id=? AND target_id=? AND relation_type=? AND valid_to IS NULL`
    );
    this.stmtCloseOpenForSourceType = db.prepare(
      `UPDATE entity_relations SET valid_to=? WHERE source_id=? AND relation_type=? AND valid_to IS NULL AND target_id<>?`
    );
    this.stmtInsertRelation = db.prepare(
      `INSERT INTO entity_relations (source_id,target_id,relation_type,weight,valid_from,valid_to)
       VALUES (?,?,?,?,?,NULL)`
    );
```

Add the public method, and update the corresponding `private stmt…: Database.Statement` field declarations (remove `stmtUpsertEntityRelation`):

```typescript
  // Relations where a source has at most ONE valid target at a time. Only these
  // evict prior open windows. The currently-extracted types (implements,
  // depends_on, blocks, authored_by) are all MANY-valued, so this is empty —
  // preventing false invalidation of legitimate multi-target facts.
  export const FUNCTIONAL_RELATION_TYPES = new Set<string>([]);

  /** Bi-temporal upsert: idempotent; for functional relations, close the prior open window first. */
  upsertRelation(sourceId: number, targetId: number, relationType: string, weight: number, validFrom?: string): void {
    const now = validFrom ?? new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
    if (this.stmtFindOpenSameTuple.get(sourceId, targetId, relationType)) return; // already open — idempotent no-op
    if (FUNCTIONAL_RELATION_TYPES.has(relationType)) {
      this.stmtCloseOpenForSourceType.run(now, sourceId, relationType, targetId); // close superseded window (functional only)
    }
    this.stmtInsertRelation.run(sourceId, targetId, relationType, weight, now);
  }
```

In `persistForDocument`, replace the old `this.stmtUpsertEntityRelation.run(...)` call with `this.upsertRelation(sourceId, targetId, rel.relationType, rel.weight ?? 1.0, documentValidFrom)`, threading a `documentValidFrom` (the doc's `created_at` if available, else `undefined`).

- [ ] **Step 4: Run** → PASS (2).
- [ ] **Step 5: Commit** `git add -A && git commit -m "feat(semantic): close prior window on contradiction; doc-time valid_from (BUG-2, BUG-7)"`

---

### Task 5: Fix persistence tests to use the real schema (BUG-8)

**Files:** Modify `src/services/entity-extractor.test.ts:176-181,265-271`

- [ ] **Step 1** Replace both inline `CREATE TABLE entity_relations (...)` blocks with `ensureEntityTables(db);` (import from `../db/entity-tables.js`), matching `entity-tools-bitemporal.test.ts:34`.
- [ ] **Step 2** Run `npx jest src/services/entity-extractor.test.ts` → PASS (now exercises the production schema incl. `valid_from`/`valid_to`).
- [ ] **Step 3** Commit `git commit -am "test(semantic): persistence tests use real ensureEntityTables schema (BUG-8)"`

---

### Task 6: `conversation_summaries` write path (BUG-4 — episodic recall)

**Files:** Modify `src/tools/workspace-tools.ts`; create `src/tools/workspace-tools.summary.test.ts`

- [ ] **Step 1: Failing test** (reuse the `sessions` + `conversation_summaries` setup from `workspace-tools.recall.test.ts`)

```typescript
it('session_summary_add inserts a row that session_recall returns', async () => {
  const add = workspaceTools.find(t => t.name === 'devlog_session_summary_add')!;
  await add.handler({ session_id: 's1', ai_model: 'claude-opus-4-7', summary: 'fixed login race', message_count: 10 });
  const recall = workspaceTools.find(t => t.name === 'devlog_session_recall')!;
  const res = await recall.handler({ query: 'login' });
  const text = res.content?.[0]?.type === 'text' ? res.content[0].text : '';
  expect(text).toMatch(/fixed login race/);
});
```

- [ ] **Step 2: Run** → FAIL (tool not found).
- [ ] **Step 3: Implement** — add to `workspaceTools`:

```typescript
  {
    name: 'devlog_session_summary_add',
    title: 'Record a session summary',
    description: 'Persist a conversation summary into episodic memory (conversation_summaries).',
    inputSchema: {
      session_id: z.string(), ai_model: z.string(), summary: z.string(),
      key_decisions: z.array(z.string()).optional(), key_topics: z.array(z.string()).optional(),
      message_count: z.number().int().optional(), token_count: z.number().int().optional(),
    },
    handler: async (args): Promise<CallToolResult> => {
      try {
        const a = args as { session_id: string; ai_model: string; summary: string;
          key_decisions?: string[]; key_topics?: string[]; message_count?: number; token_count?: number };
        db().prepare(`INSERT INTO conversation_summaries
          (session_id, ai_model, summary, key_decisions_json, key_topics_json, message_count, token_count, started_at)
          VALUES (?,?,?,?,?,?,?, strftime('%Y-%m-%dT%H:%M:%SZ','now'))`).run(
          a.session_id, a.ai_model, a.summary,
          a.key_decisions ? JSON.stringify(a.key_decisions) : null,
          a.key_topics ? JSON.stringify(a.key_topics) : null,
          a.message_count ?? null, a.token_count ?? null);
        return { content: [{ type: 'text' as const, text: `summary recorded for session ${a.session_id}` }] };
      } catch (e) { return { isError: true, content: [{ type: 'text' as const, text: `session_summary_add failed: ${(e as Error).message}` }] }; }
    },
  },
```

- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `git add -A && git commit -m "feat(episodic): conversation_summaries write path so session_recall is populated (BUG-4)"`

---

### Task 7: Auto-record tool outcomes into `agent_feedback` (BUG-3 write side)

**Files:** Modify `src/servers/base-server.ts` (the `withToolTracking` wrapper); create `src/servers/auto-feedback.test.ts`

- [ ] **Step 1: Failing test** — wrap a handler that throws → assert an `agent_feedback` row with `outcome='failure'` and a numeric `latency_ms`; wrap one that resolves → assert `outcome='success'`.
- [ ] **Step 2: Run** → FAIL (no rows written).
- [ ] **Step 3: Implement** — in `withToolTracking`, capture `const t0 = Date.now()`, run the handler in try/catch/finally, and call a new `recordFeedback(db, { agent_id, tool_name, outcome, latency_ms: Date.now()-t0 })` (success on resolve, failure on throw then rethrow). Reuse the insert from `feedback-tools.ts:58-72`. Gate on `process.env.DEVLOG_AUTO_FEEDBACK !== 'false'`.
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `git commit -am "feat(affective): auto-record tool outcome+latency into agent_feedback (BUG-3 write)"`

---

## Phase 3 — Read / Logic

### Task 8: ISO-8601 datetime normalization for `as_of` (BUG-6)

**Files:** Modify `src/tools/entity-tools.ts:103-118`; extend `entity-tools-bitemporal.test.ts`

- [ ] **Step 1: Failing test** — seed a relation whose `valid_from` uses the new ISO default; query `devlog_entity_graph` with `as_of` in `'YYYY-MM-DD HH:MM:SS'` (space) form and assert it resolves.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** — normalize both sides to ISO-Z: `const norm = (s: string) => new Date(s).toISOString().replace(/\.\d{3}Z$/, 'Z'); const effectiveAsOf = norm(asOf ?? new Date().toISOString());`. (`valid_from`/`valid_to` already stored ISO-Z by Task 2's `strftime` defaults.) Keep the CTE comparison string-based.
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `git commit -am "fix(semantic): normalize as_of/valid_from to ISO-8601 Z (BUG-6)"`

### Task 9: `UNION ALL` graph traversal (BUG-14)

**Files:** Modify `src/tools/entity-tools.ts:318-328`; extend bitemporal test with a cyclic graph.

- [ ] **Step 1: Failing test** — build A→B→C→A; assert a depth-3 traversal returns all reachable nodes.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** — change `UNION` to `UNION ALL` in the recursive CTE; add a `depth`-capped guard and `SELECT DISTINCT` on the outer projection (not in the CTE).
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `git commit -am "fix(semantic): UNION ALL in graph CTE to stop early path pruning (BUG-14)"`

### Task 10: Feedback routing read-path — Wilson lower bound + decay (BUG-3 read, 9, 10, 11, 12, 16, 17)

**Files:** Modify `src/db/agent-feedback.ts` + `src/db/schema.sql`; modify `src/tools/feedback-tools.ts`; create `src/tools/feedback-route.test.ts`

- [ ] **Step 1: Failing test** — assert: a tool with 1 success does NOT outrank a tool with 95/100 (min-sample/Wilson); recent successes outweigh old failures (decay); outcome breakdown (partial/rejected/timeout) is present; filtering by `agent_id` isolates per-agent stats.
- [ ] **Step 2: Run** → FAIL (tool not found).
- [ ] **Step 3: Implement** —
  - Add composite index in `agent-feedback.ts` + `schema.sql`: `CREATE INDEX IF NOT EXISTS idx_feedback_agent_tool_time ON agent_feedback(agent_id, tool_name, recorded_at)`. Add `CHECK(outcome IN ('success','failure','partial','rejected','timeout'))` via a `version:3` migration that rebuilds the table for existing DBs (statements-loop pattern from Task 2).
  - Add `devlog_feedback_route({ tool_name?, agent_id?, half_life_days=14, min_samples=5 })` returning, per tool: `n`, the five outcome counts, recency-weighted success rate `Σ(success·0.5^(age/half_life)) / Σ(0.5^(age/half_life))`, **Wilson lower bound** `(p̂ + z²/2n − z·√((p̂(1−p̂)+z²/4n)/n))/(1+z²/n)` (z=1.96) as the sort key, and `confident: n >= min_samples`. Use `COALESCE(confidence,0)` (BUG-16); include `agent_id` in `GROUP BY` when unfiltered (BUG-17).
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `git add -A && git commit -m "feat(affective): devlog_feedback_route with Wilson bound + recency decay (BUG-3 read,9,10,11,12,16,17)"`

---

## Phase 4 — Concurrency & Perf (condensed)

### Task 11: Atomic lock acquisition (BUG-19)
- [ ] Test: two concurrent `acquireLock` calls — exactly one succeeds. FAIL → implement with `fs.open(LOCK_FILE, 'wx')` (O_EXCL); on `EEXIST`, read for stale-timeout logic → PASS → commit.

### Task 12: Serialize workspace/question writes (BUG-20, BUG-25 questions.json)
- [ ] Test: concurrent `session_log` calls retain all entries. FAIL → use `fs.appendFile` (atomic for small writes) or acquire the workspace lock before read-modify-write → PASS → commit.

### Task 13: `workspace_dump` upsert preserves enriched columns (BUG-21)
- [ ] Test: dump a doc, set `embedding_id`, re-dump — `embedding_id` survives. FAIL → replace `INSERT OR REPLACE` with `INSERT … ON CONFLICT(id) DO UPDATE SET` listing only dump-owned columns → PASS → commit.

### Task 14: Pruning + content-hash FK + dead table (BUG-22, 23, 24)
- [ ] Test: `CompactionService.compact()` deletes merged source rows. FAIL → DELETE merged sources inside the compaction transaction; add `FOREIGN KEY(doc_id) REFERENCES docs(id) ON DELETE CASCADE` to `entity_content_hashes` (migration); drop dead `context_relevance` via `drop-dead-tables` → PASS → commit.

---

## Task 15: Reconcile README with reality

**Files:** Modify `README.md`

- [ ] After Tasks 4/6/7/10 land, the three claims become true. Update README examples to match reality:
  - **Bi-temporal** — frame it as **point-in-time time-travel**, not automatic contradiction-detection. Truthful wording: "relations carry `valid_from`/`valid_to`; pass `as_of` to query the graph as it was at any past timestamp; closing a window removes a fact from current views while it stays visible to historical `as_of` reads; for single-valued (functional) relations a superseding fact auto-closes the prior window." Show an `as_of` example returning a historical slice. Do NOT claim cross-re-extraction contradiction detection (the functional set is empty for the default taxonomy).
  - **Affective** — call **`devlog_feedback_route`** (not `devlog_feedback_query`) and show the Wilson-ranked, decay-weighted output; note outcomes are auto-recorded.
  - **Episodic** — reference `devlog_session_summary_add` as the write backing `devlog_session_recall`.
  - If any task is deferred, soften the corresponding claim to "planned" rather than asserting it.
- [ ] Commit `git commit -am "docs: align README memory claims with implemented behavior"`

---

## P2/P3 Backlog (file as issues if not done inline)

BUG-18 (`since` validation), BUG-25 (LIKE wildcard escaping, entities `canonical_name NOT NULL`, `outcome` CHECK if not already done in Task 10). Each is a small, independent test-first fix.

---

## Self-Review

**1. Spec coverage:** P0 → Tasks 2/4 (BUG-1,2), 7/10 (BUG-3), 6 (BUG-4). Foundational P1 → 1 (BUG-5), 8 (BUG-6), 4 (BUG-7), 5 (BUG-8), 10 (BUG-9,10,11,12,16,17), 3 (BUG-13). P2/P3 → Tasks 9,11–14 + backlog. README → Task 15. Fix sequence honored (schema/PK before upsert). ✅
**2. Placeholder scan:** Phase 4 tasks are condensed but each names the exact file, the failing-test assertion, and the concrete implementation approach — no "TBD". Expand to full steps at execution time if desired.
**3. Type consistency:** `upsertRelation(sourceId,targetId,relationType,weight,validFrom?)` consistent (Task 4); `runMigrations`/`MIGRATIONS` consistent (1,2,10,14); `devlog_feedback_route` / `devlog_session_summary_add` names stable across tasks and README.

---
