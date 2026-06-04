# Memory Leverage Moves Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Convert three "paper-only" memory differentiators into shipped, live behaviour: (1) automatic episodic compaction, (2) semantic session recall, (3) self-healing bi-temporal contradiction-closing.

**Architecture:** Each move wires or extends code that already exists. Move 1 calls the already-written `CompactionService` from the summary-write path + a startup recovery hook. Move 2 embeds session summaries on write (reusing `EmbeddingService` + its cache) and adds a cosine-ranked recall path with substring fallback. Move 3 adds one genuinely single-valued relation (`superseded_by`) that the extractor produces, then registers it in `FUNCTIONAL_RELATION_TYPES` so the existing bi-temporal window-closing machinery fires.

**Tech Stack:** TypeScript (ESM, `.js` import suffixes), better-sqlite3, Drizzle, LanceDB, Ollama (`nomic-embed-text`), Jest. Tests inject a DB via `globalThis.__TEST_DB__`.

**Design corrections baked in (verified against source):**
- `db()` in `workspace-tools.ts:16` already honours `__TEST_DB__`, so handler tests need no mocking.
- `withToolTracking` is applied globally at `base-server.ts:47` — affective auto-recording is already live; do not touch it.
- `HybridSearchService.search()` (`vector-service.ts:517`) is scoped to the **docs** corpus (`docs_fts` + indexed doc chunks). Session summaries live in the separate `conversation_summaries` table, so Move 2 does **not** call `search()` — it reuses `EmbeddingService` only.
- `FUNCTIONAL_RELATION_TYPES` (`entity-extractor.ts:635`) is empty **on purpose**: `implements`/`depends_on`/`blocks`/`authored_by` are all many-valued. Move 3 adds a NEW single-valued relation rather than wrongly flagging an existing one.

---

## File Structure

| File | Responsibility | Move |
|---|---|---|
| `src/tools/workspace-tools.ts` | `devlog_session_summary_add` triggers compaction; `devlog_session_recall` gains semantic ranking | 1, 2 |
| `src/services/compaction-service.ts` | Add `recoverAll()` convenience for startup recovery (existing class) | 1 |
| `src/servers/base-server.ts` | Run compaction recovery once after connect | 1 |
| `src/db/episodic-tables.ts` (new) | Idempotent migration: add `summary_embedding BLOB` to `conversation_summaries` | 2 |
| `src/utils/vector-math.ts` (new) | `cosineSimilarity`, `floatArrayToBlob`, `blobToFloatArray` | 2 |
| `src/services/entity-extractor.ts` | Add `superseded_by` relation type + trigger; register it as functional | 3 |

---

## Task 1: Auto-compact episodic memory on summary write

**Files:**
- Modify: `src/tools/workspace-tools.ts:579-622` (the `devlog_session_summary_add` handler)
- Test: `src/tools/workspace-tools.compaction.test.ts` (create)

- [ ] **Step 1: Write the failing test**

Create `src/tools/workspace-tools.compaction.test.ts`:

```typescript
import Database from 'better-sqlite3';
import { workspaceTools } from './workspace-tools.js';

function makeDb(): Database.Database {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE sessions (id TEXT PRIMARY KEY, summary TEXT, metadata_json TEXT);
    CREATE TABLE conversation_summaries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT, ai_model TEXT, summary TEXT,
      key_decisions_json TEXT, key_topics_json TEXT,
      message_count INTEGER, token_count INTEGER,
      started_at TEXT, ended_at TEXT
    );
  `);
  db.prepare('INSERT INTO sessions (id) VALUES (?)').run('s1');
  return db;
}

const summaryAdd = workspaceTools.find(t => t.name === 'devlog_session_summary_add')!;

describe('session_summary_add auto-compaction', () => {
  afterEach(() => { delete (globalThis as Record<string, unknown>).__TEST_DB__; });

  it('compacts the session once cumulative tokens exceed the threshold', async () => {
    const db = makeDb();
    (globalThis as Record<string, unknown>).__TEST_DB__ = db;

    // Two summaries of 25k tokens each => 50k > 40k threshold.
    for (const i of [1, 2]) {
      await summaryAdd.handler({
        session_id: 's1', ai_model: 'opus', summary: `chunk ${i}`,
        token_count: 25000,
      });
    }

    const remaining = db.prepare(
      'SELECT COUNT(*) AS n FROM conversation_summaries WHERE session_id = ?'
    ).get('s1') as { n: number };
    const session = db.prepare('SELECT summary FROM sessions WHERE id = ?')
      .get('s1') as { summary: string | null };

    expect(remaining.n).toBe(0);                 // source rows merged away
    expect(session.summary).toContain('chunk 1'); // collapsed into sessions.summary
    expect(session.summary).toContain('chunk 2');
  });

  it('does NOT compact below the threshold', async () => {
    const db = makeDb();
    (globalThis as Record<string, unknown>).__TEST_DB__ = db;
    await summaryAdd.handler({
      session_id: 's1', ai_model: 'opus', summary: 'small', token_count: 100,
    });
    const remaining = db.prepare(
      'SELECT COUNT(*) AS n FROM conversation_summaries'
    ).get() as { n: number };
    expect(remaining.n).toBe(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/tools/workspace-tools.compaction.test.ts`
Expected: FAIL — first test sees `remaining.n === 2` (no compaction wired yet).

- [ ] **Step 3: Wire CompactionService into the handler**

In `src/tools/workspace-tools.ts`, add the import near the other service imports (after line 30):

```typescript
import { CompactionService } from '../services/compaction-service.js';
```

Then in the `devlog_session_summary_add` handler, replace the `return` after the `INSERT ... run(...)` block (currently `workspace-tools.ts:614`) with:

```typescript
        // Episodic compaction: once cumulative summary tokens exceed the
        // threshold, merge this session's summaries into sessions.summary.
        const compactor = new CompactionService(db());
        let note = '';
        if (compactor.needsCompaction(a.session_id)) {
          const res = await compactor.compact(a.session_id);
          note = ` (compacted ${res.compactedSummaries} summaries, ~${res.compactedTokens} tokens)`;
        }
        return { content: [{ type: 'text' as const, text: `summary recorded for session ${a.session_id}${note}` }] };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest src/tools/workspace-tools.compaction.test.ts`
Expected: PASS (both tests).

- [ ] **Step 5: Commit**

```bash
git add src/tools/workspace-tools.ts src/tools/workspace-tools.compaction.test.ts
git commit -m "feat(episodic): auto-compact session summaries past token threshold"
```

---

## Task 2: Crash-recovery of pending compactions on startup

**Files:**
- Modify: `src/services/compaction-service.ts:129-135` (add `recoverAll`)
- Modify: `src/servers/base-server.ts:54` (call recovery after connect)
- Test: `src/services/compaction-service.recover.test.ts` (create)

- [ ] **Step 1: Write the failing test**

Create `src/services/compaction-service.recover.test.ts`:

```typescript
import Database from 'better-sqlite3';
import { CompactionService } from './compaction-service.js';

function makeDb(): Database.Database {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE sessions (id TEXT PRIMARY KEY, summary TEXT, metadata_json TEXT);
    CREATE TABLE conversation_summaries (
      id INTEGER PRIMARY KEY AUTOINCREMENT, session_id TEXT, ai_model TEXT,
      summary TEXT, token_count INTEGER, started_at TEXT
    );
  `);
  return db;
}

it('recoverAll re-compacts every session left mid-compaction', async () => {
  const db = makeDb();
  db.prepare('INSERT INTO sessions (id, metadata_json) VALUES (?, ?)')
    .run('s1', JSON.stringify({ compactionPending: true }));
  db.prepare(
    'INSERT INTO conversation_summaries (session_id, ai_model, summary, token_count, started_at) VALUES (?,?,?,?,?)'
  ).run('s1', 'opus', 'orphaned chunk', 100, '2026-05-27T00:00:00Z');

  const svc = new CompactionService(db);
  const recovered = await svc.recoverAll();

  expect(recovered).toEqual(['s1']);
  const session = db.prepare('SELECT summary, metadata_json FROM sessions WHERE id = ?')
    .get('s1') as { summary: string; metadata_json: string };
  expect(session.summary).toContain('orphaned chunk');
  expect(JSON.parse(session.metadata_json).compactionPending).toBeUndefined();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/services/compaction-service.recover.test.ts`
Expected: FAIL — `svc.recoverAll is not a function`.

- [ ] **Step 3: Add `recoverAll` to CompactionService**

In `src/services/compaction-service.ts`, after the `recoverPending()` method (ends at line 135), add:

```typescript
  /**
   * Re-compact every session that was mid-compaction at last exit.
   * Returns the list of session ids that were recovered.
   */
  async recoverAll(): Promise<string[]> {
    const pending = this.recoverPending();
    for (const sessionId of pending) {
      await this.compact(sessionId);
    }
    return pending;
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest src/services/compaction-service.recover.test.ts`
Expected: PASS.

- [ ] **Step 5: Call recovery at server startup**

In `src/servers/base-server.ts`, add the imports at the top of the file (with the other imports):

```typescript
import { CompactionService } from '../services/compaction-service.js';
import { getSqliteDb } from '../db/index.js';
import path from 'node:path';
import { DEVLOG_PATH } from '../shared/config.js';
```

> Note: if `DEVLOG_PATH` is already imported in this file, reuse the existing import instead of adding a duplicate.

Then in `startServer`, immediately after `await server.connect(transport);` (line 54) and inside the `if (devlogExists)` branch is cleanest — insert just before `console.error(\`✅ ...`)` at line 64:

```typescript
    try {
      const projectPath = path.dirname(DEVLOG_PATH);
      const sqlite = getSqliteDb({ projectPath, devlogFolder: path.basename(DEVLOG_PATH) });
      const recovered = await new CompactionService(sqlite).recoverAll();
      if (recovered.length) {
        console.error(`   Recovered ${recovered.length} pending compaction(s).`);
      }
    } catch (e) {
      console.error('   Compaction recovery skipped:', (e as Error).message);
    }
```

- [ ] **Step 6: Verify build + existing tests still pass**

Run: `npm run build && npx jest src/services/compaction-service`
Expected: build succeeds; all compaction tests PASS.

- [ ] **Step 7: Commit**

```bash
git add src/services/compaction-service.ts src/services/compaction-service.recover.test.ts src/servers/base-server.ts
git commit -m "feat(episodic): recover pending compactions on server startup"
```

---

## Task 3: Semantic session recall (embed-on-write + cosine rank)

**Files:**
- Create: `src/utils/vector-math.ts`
- Create: `src/db/episodic-tables.ts`
- Modify: `src/tools/workspace-tools.ts` (summary write embeds; recall ranks semantically)
- Test: `src/utils/vector-math.test.ts`, `src/tools/workspace-tools.recall.test.ts`

### 3a: Vector math helpers

- [ ] **Step 1: Write the failing test**

Create `src/utils/vector-math.test.ts`:

```typescript
import { cosineSimilarity, floatArrayToBlob, blobToFloatArray } from './vector-math.js';

it('cosineSimilarity is 1 for identical vectors, 0 for orthogonal', () => {
  expect(cosineSimilarity([1, 0, 0], [1, 0, 0])).toBeCloseTo(1);
  expect(cosineSimilarity([1, 0, 0], [0, 1, 0])).toBeCloseTo(0);
});

it('blob round-trips a float array', () => {
  const v = [0.1, -0.5, 3.14];
  const round = blobToFloatArray(floatArrayToBlob(v));
  expect(round[0]).toBeCloseTo(0.1);
  expect(round[2]).toBeCloseTo(3.14);
});

it('cosineSimilarity returns 0 on length mismatch or zero vector', () => {
  expect(cosineSimilarity([1, 2], [1, 2, 3])).toBe(0);
  expect(cosineSimilarity([0, 0], [1, 1])).toBe(0);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/utils/vector-math.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the helpers**

Create `src/utils/vector-math.ts`:

```typescript
/** Cosine similarity in [-1, 1]. Returns 0 on length mismatch or zero-norm. */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

/** Pack a float array into a Float64 BLOB (mirrors embedding_cache storage). */
export function floatArrayToBlob(vec: number[]): Buffer {
  return Buffer.from(new Float64Array(vec).buffer);
}

/** Unpack a Float64 BLOB back into a number[]. */
export function blobToFloatArray(blob: Buffer): number[] {
  const f = new Float64Array(blob.buffer, blob.byteOffset, Math.floor(blob.byteLength / 8));
  return Array.from(f);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest src/utils/vector-math.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/utils/vector-math.ts src/utils/vector-math.test.ts
git commit -m "feat(util): add cosine + float-blob helpers for semantic recall"
```

### 3b: Migration for the embedding column

- [ ] **Step 6: Write the failing test**

Create `src/db/episodic-tables.test.ts`:

```typescript
import Database from 'better-sqlite3';
import { ensureEpisodicEmbeddingColumn } from './episodic-tables.js';

it('adds summary_embedding column idempotently', () => {
  const db = new Database(':memory:');
  db.exec(`CREATE TABLE conversation_summaries (id INTEGER PRIMARY KEY, summary TEXT);`);

  ensureEpisodicEmbeddingColumn(db);
  ensureEpisodicEmbeddingColumn(db); // second call must not throw

  const cols = db.prepare(`PRAGMA table_info(conversation_summaries)`).all() as Array<{ name: string }>;
  expect(cols.some(c => c.name === 'summary_embedding')).toBe(true);
});
```

- [ ] **Step 7: Run test to verify it fails**

Run: `npx jest src/db/episodic-tables.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 8: Implement the migration**

Create `src/db/episodic-tables.ts`:

```typescript
import type Database from 'better-sqlite3';

/**
 * Idempotently add a summary_embedding BLOB column to conversation_summaries.
 * Stores the Float64-packed embedding of each summary for semantic recall.
 */
export function ensureEpisodicEmbeddingColumn(sqlite: Database.Database): void {
  const cols = sqlite.prepare(`PRAGMA table_info(conversation_summaries)`).all() as Array<{ name: string }>;
  if (!cols.some(c => c.name === 'summary_embedding')) {
    sqlite.prepare(`ALTER TABLE conversation_summaries ADD COLUMN summary_embedding BLOB`).run();
  }
}
```

- [ ] **Step 9: Run test to verify it passes**

Run: `npx jest src/db/episodic-tables.test.ts`
Expected: PASS.

- [ ] **Step 10: Commit**

```bash
git add src/db/episodic-tables.ts src/db/episodic-tables.test.ts
git commit -m "feat(db): add summary_embedding column for semantic recall"
```

### 3c: Embed on write, rank on recall

**Design:** `EmbeddingService.embed()` returns `{ embedding }` and already fails soft (empty vector) when Ollama is down, with an LRU cache. On write we embed and store the BLOB. On recall, when a `query` is given, we embed the query, load candidate summaries with their stored embeddings, and rank by cosine similarity; rows lacking an embedding (or any failure) fall back to the existing substring + recency behaviour.

- [ ] **Step 11: Write the failing test**

Create `src/tools/workspace-tools.recall.test.ts`:

```typescript
import Database from 'better-sqlite3';
import { workspaceTools } from './workspace-tools.js';
import { floatArrayToBlob } from '../utils/vector-math.js';

function makeDb(): Database.Database {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE conversation_summaries (
      id INTEGER PRIMARY KEY AUTOINCREMENT, session_id TEXT, ai_model TEXT,
      summary TEXT, message_count INTEGER, token_count INTEGER,
      started_at TEXT, ended_at TEXT, summary_embedding BLOB
    );
  `);
  return db;
}
const recall = workspaceTools.find(t => t.name === 'devlog_session_recall')!;

it('ranks semantically when a query embeds; closest summary comes first', async () => {
  const db = makeDb();
  (globalThis as Record<string, unknown>).__TEST_DB__ = db;
  // Two summaries with hand-set embeddings; query embeds to [1,0,0] in the stub.
  const ins = db.prepare(
    'INSERT INTO conversation_summaries (session_id, ai_model, summary, started_at, summary_embedding) VALUES (?,?,?,?,?)'
  );
  ins.run('s1', 'opus', 'about databases', '2026-01-01T00:00:00Z', floatArrayToBlob([0, 1, 0]));
  ins.run('s2', 'opus', 'about caching',   '2026-01-02T00:00:00Z', floatArrayToBlob([1, 0, 0]));

  // Stub the embedder so the test is deterministic and offline.
  const mod = await import('../services/vector-service.js');
  jest.spyOn(mod.EmbeddingService.prototype, 'embed').mockResolvedValue({ embedding: [1, 0, 0] } as never);

  const res = await recall.handler({ query: 'caching' });
  const text = (res.content[0] as { text: string }).text;
  expect(text.indexOf('about caching')).toBeLessThan(text.indexOf('about databases'));
  delete (globalThis as Record<string, unknown>).__TEST_DB__;
});
```

- [ ] **Step 12: Run test to verify it fails**

Run: `npx jest src/tools/workspace-tools.recall.test.ts`
Expected: FAIL — recall still orders by `started_at DESC`, so `s2` (caching) and `s1` ordering won't reflect similarity, OR the column/embedding path is ignored.

- [ ] **Step 13: Embed summaries on write**

In `src/tools/workspace-tools.ts`, add imports (near line 30):

```typescript
import { EmbeddingService } from '../services/vector-service.js';
import { floatArrayToBlob, blobToFloatArray, cosineSimilarity } from '../utils/vector-math.js';
import { ensureEpisodicEmbeddingColumn } from '../db/episodic-tables.js';
```

In the `devlog_session_summary_add` handler, replace the single `INSERT` statement (currently `workspace-tools.ts:603-613`) with an embed-then-insert block (place it before the compaction block from Task 1):

```typescript
        ensureEpisodicEmbeddingColumn(db());
        let embeddingBlob: Buffer | null = null;
        try {
          const { embedding } = await new EmbeddingService().embed(a.summary);
          if (embedding && embedding.length) embeddingBlob = floatArrayToBlob(embedding);
        } catch { /* Ollama down -> store null, recall falls back to substring */ }

        db().prepare(`INSERT INTO conversation_summaries
          (session_id, ai_model, summary, key_decisions_json, key_topics_json, message_count, token_count, started_at, summary_embedding)
          VALUES (?,?,?,?,?,?,?, strftime('%Y-%m-%dT%H:%M:%SZ','now'), ?)`).run(
          a.session_id,
          a.ai_model,
          a.summary,
          a.key_decisions ? JSON.stringify(a.key_decisions) : null,
          a.key_topics ? JSON.stringify(a.key_topics) : null,
          a.message_count ?? null,
          a.token_count ?? null,
          embeddingBlob,
        );
```

- [ ] **Step 14: Rank semantically on recall**

In `src/tools/workspace-tools.ts`, in the `devlog_session_recall` handler, after the rows are fetched (currently `workspace-tools.ts:644-650`) and before building `text`, insert semantic re-ranking. Replace the block from the `const rows = ...` query through the `const text = rows.map(...)` line with:

```typescript
        ensureEpisodicEmbeddingColumn(db());
        const rows = db().prepare(`
          SELECT session_id, ai_model, summary, message_count, token_count, started_at, ended_at, summary_embedding
          FROM conversation_summaries
          ${whereSql}
          ORDER BY started_at DESC
          LIMIT ?
        `).all(...params, a.limit ?? 10) as Array<Record<string, unknown>>;

        // Semantic re-rank when a query is provided and embeds successfully.
        let ordered = rows;
        if (a.query) {
          try {
            const { embedding } = await new EmbeddingService().embed(a.query);
            if (embedding && embedding.length) {
              ordered = [...rows]
                .map((r) => {
                  const blob = r['summary_embedding'] as Buffer | null;
                  const sim = blob ? cosineSimilarity(embedding, blobToFloatArray(blob)) : -1;
                  return { r, sim };
                })
                .sort((x, y) => y.sim - x.sim)
                .map((x) => x.r);
            }
          } catch { /* keep recency order on embed failure */ }
        }

        const text = ordered.map((r) =>
          `[${r['started_at']}] session=${r['session_id']} model=${r['ai_model']} msgs=${r['message_count']}\n  ${r['summary']}`
        ).join('\n\n') || '(no past sessions)';
```

> Note: keep the existing `summary LIKE ?` filter in `where` (line 639) — it now acts as a candidate pre-filter before semantic ranking, which is the cheap-then-precise hybrid pattern.

- [ ] **Step 15: Run test to verify it passes**

Run: `npx jest src/tools/workspace-tools.recall.test.ts`
Expected: PASS — "about caching" ranks before "about databases".

- [ ] **Step 16: Run the full workspace suite to check for regressions**

Run: `npx jest src/tools/workspace-tools`
Expected: all PASS (summary-add, compaction, recall).

- [ ] **Step 17: Commit**

```bash
git add src/tools/workspace-tools.ts src/tools/workspace-tools.recall.test.ts
git commit -m "feat(episodic): semantic session_recall via summary embeddings with substring fallback"
```

---

## Task 4: Self-healing contradiction-closing via a functional relation

**Files:**
- Modify: `src/services/entity-extractor.ts:18` (RelationType union), `:441-447` (triggers), `:635` (functional set)
- Test: `src/services/entity-extractor.superseded.test.ts` (create)

**Design:** `depends_on`/`implements`/`blocks`/`authored_by` are many-valued, so flagging them would cause false invalidation. Instead introduce `superseded_by` — an entity has at most ONE current successor ("X replaced by Y", "deprecated in favor of Y"). This is genuinely functional, so a later contradiction (`X superseded_by Z`) should close the earlier open `X superseded_by Y` window. The bi-temporal close machinery already exists in `EntityPersistence.upsertRelation` (`entity-extractor.ts:706`); we only need to feed it a functional relation.

- [ ] **Step 1: Write the failing test**

Create `src/services/entity-extractor.superseded.test.ts`:

```typescript
import Database from 'better-sqlite3';
import { ensureEntityTables } from '../db/entity-tables.js';
import { EntityPersistence, FUNCTIONAL_RELATION_TYPES } from './entity-extractor.js';

function makeDb(): Database.Database {
  const db = new Database(':memory:');
  ensureEntityTables(db);
  // Seed three entities A, B, C.
  const ins = db.prepare('INSERT INTO entities (type, name, canonical_name) VALUES (?,?,?)');
  ins.run('component', 'A', 'a');
  ins.run('component', 'B', 'b');
  ins.run('component', 'C', 'c');
  return db;
}

it('registers superseded_by as a functional relation', () => {
  expect(FUNCTIONAL_RELATION_TYPES.has('superseded_by')).toBe(true);
});

it('closes the prior superseded_by window when the successor changes', () => {
  const db = makeDb();
  const p = new EntityPersistence(db);
  // A superseded_by B (t1), then A superseded_by C (t2) -> B window must close.
  p.upsertRelation(1, 2, 'superseded_by', 1.0, '2026-01-01T00:00:00Z');
  p.upsertRelation(1, 3, 'superseded_by', 1.0, '2026-02-01T00:00:00Z');

  const open = db.prepare(
    "SELECT target_id FROM entity_relations WHERE source_id=1 AND relation_type='superseded_by' AND valid_to IS NULL"
  ).all() as Array<{ target_id: number }>;
  const closed = db.prepare(
    "SELECT target_id, valid_to FROM entity_relations WHERE source_id=1 AND relation_type='superseded_by' AND valid_to IS NOT NULL"
  ).all() as Array<{ target_id: number; valid_to: string }>;

  expect(open).toEqual([{ target_id: 3 }]);        // only C is current
  expect(closed).toEqual([{ target_id: 2, valid_to: '2026-02-01T00:00:00Z' }]); // B closed at t2
});

it('keeps depends_on many-valued (no false invalidation)', () => {
  const db = makeDb();
  const p = new EntityPersistence(db);
  p.upsertRelation(1, 2, 'depends_on', 1.0, '2026-01-01T00:00:00Z');
  p.upsertRelation(1, 3, 'depends_on', 1.0, '2026-02-01T00:00:00Z');
  const open = db.prepare(
    "SELECT target_id FROM entity_relations WHERE source_id=1 AND relation_type='depends_on' AND valid_to IS NULL"
  ).all() as Array<{ target_id: number }>;
  expect(open.map(o => o.target_id).sort()).toEqual([2, 3]); // both stay open
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/services/entity-extractor.superseded.test.ts`
Expected: FAIL — `superseded_by` is not in the union/set, so the first two tests fail.

- [ ] **Step 3: Add `superseded_by` to the RelationType union**

In `src/services/entity-extractor.ts:18`, change:

```typescript
export type RelationType = 'mentions' | 'implements' | 'depends_on' | 'blocks' | 'authored_by';
```

to:

```typescript
export type RelationType = 'mentions' | 'implements' | 'depends_on' | 'blocks' | 'authored_by' | 'superseded_by';
```

- [ ] **Step 4: Add the trigger patterns**

In `src/services/entity-extractor.ts`, add to `TRIGGER_PATTERNS` (after line 446, before the closing `];`):

```typescript
  { regex: /\b(?:replaced\s+by|superseded\s+by|deprecated\s+in\s+favor\s+of|renamed\s+to)\s+/gi, relationType: 'superseded_by', passive: true },
```

> `passive: true` matches the established convention for "X <trigger> Y" phrasings where the grammatical subject (X) is the source being superseded — consistent with how `blocked by` / `authored by` already swap direction.

- [ ] **Step 5: Register it as functional**

In `src/services/entity-extractor.ts:635`, change:

```typescript
export const FUNCTIONAL_RELATION_TYPES = new Set<string>([]);
```

to:

```typescript
export const FUNCTIONAL_RELATION_TYPES = new Set<string>(['superseded_by']);
```

- [ ] **Step 6: Run test to verify it passes**

Run: `npx jest src/services/entity-extractor.superseded.test.ts`
Expected: PASS (all three tests).

- [ ] **Step 7: Run the entity suite for regressions**

Run: `npx jest src/services/entity-extractor`
Expected: all PASS — existing many-valued relations unchanged.

- [ ] **Step 8: Commit**

```bash
git add src/services/entity-extractor.ts src/services/entity-extractor.superseded.test.ts
git commit -m "feat(semantic): add functional superseded_by relation to enable contradiction-closing"
```

---

## Final verification

- [ ] **Run the full suite + lint + build**

Run: `npm run lint && npm test && npm run build`
Expected: lint clean, all tests pass, build succeeds.

- [ ] **Manual smoke (optional)**

Run the core server (`npm run dev:core`), then from an MCP client:
1. `devlog_session_summary_add` twice with `token_count: 25000` → second response notes "compacted".
2. `devlog_session_recall` with a `query` → results ordered by semantic relevance.
3. Extract two docs: "ModuleA replaced by ModuleB" then "ModuleA replaced by ModuleC" → `devlog_entity_graph` shows only the ModuleC edge open.

---

## Self-Review

**Spec coverage:**
- Move 1 (wire CompactionService) → Tasks 1 + 2. ✅
- Move 2 (semantic recall through existing vector stack) → Task 3 (reuses `EmbeddingService` + cache; corrected away from the doc-scoped `HybridSearchService`). ✅
- Move 3 (enable contradiction-closing) → Task 4 (corrected to add a genuinely functional relation rather than mis-flagging `depends_on`). ✅

**Placeholder scan:** No TBD/"add error handling"/"write tests for the above" — every code step shows real code and exact commands. ✅

**Type consistency:** `cosineSimilarity`/`floatArrayToBlob`/`blobToFloatArray` defined in 3a are used unchanged in 3c; `recoverAll` defined in Task 2 is the only new `CompactionService` method referenced; `superseded_by` is added to the union before it is used in triggers and the functional set. ✅

**Known assumptions to confirm at execution time:**
- `DEVLOG_PATH` import path in `base-server.ts` (Task 2 Step 5) — verify the actual export location (`../shared/config.js` vs wherever `workspace-tools.ts:12` imports it from) and reuse the existing import if present.
- `EmbeddingService` constructor takes no required args (it defaults `ollamaUrl`/`model`); confirmed at `vector-service.ts:95`.
