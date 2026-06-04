# Compacted Summaries Stay Recallable — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** After episodic compaction, `devlog_session_recall` still surfaces the consolidated history — closing the recall-coverage gap that auto-compaction (shipped in PR #12) introduced, so the tachibot↔devlog agentic loop's "devlog recalls what's relevant" leg stays complete.

**Architecture (Option B, chosen via planner_maker pipeline):** Instead of summarize-and-**drop**, compaction becomes summarize-and-**retain**. `compact()` re-inserts the merged text as a single `conversation_summaries` row flagged `compacted=1`, so it remains in the recall corpus (`session_recall` already reads that table). To prevent an infinite re-compaction loop, `needsCompaction()` counts only **non-compacted** rows — a merged row never re-triggers itself, but new summaries piling on top still re-compact (Letta-style recursive consolidation). The merged row's `summary_embedding` stays `NULL` (recall falls back to substring/recency for it); keeping `CompactionService` free of any Ollama/`EmbeddingService` dependency.

**Why this approach:** 2026 SOTA (Letta recall/archival tiers, Zep soft-delete timestamps) is explicit that pure "summarize-and-drop" is the anti-pattern; consolidated history must stay retrievable. Option A (cap `token_count` below threshold) is lossy and can freeze re-compaction; Option B is precise and matches best practice.

**Tech Stack:** TypeScript (ESM, `.js` imports), better-sqlite3, Jest (plain `npx jest`, in-memory SQLite, `globalThis.__TEST_DB__`).

**Dependency graph (from kimi_decompose):** `T1 (add column) → T2 (needsCompaction filter) → T3 (compact re-insert) → T4 (recall-after-compaction test) → T5 (docs)`.

---

## Task 1: `compacted` column + migration

**Files:**
- Modify: `src/db/episodic-tables.ts` (add `ensureCompactedColumn`, mirroring `ensureEpisodicEmbeddingColumn`)
- Modify: `src/services/compaction-service.ts` (call it in the constructor)
- Test: `src/db/episodic-tables.test.ts` (extend)

- [ ] **Step 1: Failing test for the migration**

Append to `src/db/episodic-tables.test.ts`:

```typescript
import { ensureCompactedColumn } from './episodic-tables.js';

it('adds compacted column idempotently', () => {
  const db = new Database(':memory:');
  db.exec(`CREATE TABLE conversation_summaries (id INTEGER PRIMARY KEY, summary TEXT);`);
  ensureCompactedColumn(db);
  ensureCompactedColumn(db); // idempotent
  const cols = db.prepare(`PRAGMA table_info(conversation_summaries)`).all() as Array<{ name: string }>;
  expect(cols.some((c) => c.name === 'compacted')).toBe(true);
});
```

- [ ] **Step 2: Run → FAIL** (`ensureCompactedColumn` not exported). `npx jest src/db/episodic-tables.test.ts`

- [ ] **Step 3: Implement** — add to `src/db/episodic-tables.ts`:

```typescript
/**
 * Idempotently add a `compacted` flag (0/1) to conversation_summaries.
 * Rows written by compaction are marked 1 so they remain recallable but do
 * NOT count toward the compaction trigger (preventing a re-compaction loop).
 */
export function ensureCompactedColumn(sqlite: Database.Database): void {
  const cols = sqlite
    .prepare(`PRAGMA table_info(conversation_summaries)`)
    .all() as Array<{ name: string }>;
  if (!cols.some((c) => c.name === 'compacted')) {
    sqlite.prepare(`ALTER TABLE conversation_summaries ADD COLUMN compacted INTEGER DEFAULT 0`).run();
  }
}
```

- [ ] **Step 4: Call it from `CompactionService`** so the column always exists before its queries run. In `src/services/compaction-service.ts`, import and call in the constructor:

```typescript
import { ensureCompactedColumn } from '../db/episodic-tables.js';
// ...
  constructor(db: Database.Database, tokenThreshold = DEFAULT_TOKEN_THRESHOLD) {
    this.db = db;
    this.tokenThreshold = tokenThreshold;
    ensureCompactedColumn(db);
  }
```

- [ ] **Step 5: Run → PASS.** `npx jest src/db/episodic-tables.test.ts`

- [ ] **Step 6: Commit** — `git commit -m "feat(episodic): add compacted flag column for recallable compaction"`

---

## Task 2: `needsCompaction` counts only non-compacted rows

**Files:** Modify `src/services/compaction-service.ts:29-35`; Test `src/services/compaction-service.test.ts`

- [ ] **Step 1: Failing test** — append to `src/services/compaction-service.test.ts` (mirror its existing `makeDb`):

```typescript
it('needsCompaction ignores already-compacted rows (no self-retrigger)', () => {
  const db = /* makeDb() per the file's existing helper */ makeTestDb();
  // A single compacted row larger than the threshold must NOT trigger.
  db.prepare(
    `INSERT INTO conversation_summaries (session_id, ai_model, summary, token_count, started_at, compacted)
     VALUES ('s1','compaction','merged', 99999, '2026-01-01T00:00:00Z', 1)`,
  ).run();
  expect(new CompactionService(db).needsCompaction('s1')).toBe(false);
});
```
> Use the file's existing in-memory DB helper; ensure its `conversation_summaries` DDL is created (the `CompactionService` constructor will `ALTER`-add `compacted` if missing).

- [ ] **Step 2: Run → FAIL** (current `SUM(token_count)` counts the compacted row → returns true).

- [ ] **Step 3: Implement** — in `needsCompaction()`:

```typescript
  needsCompaction(sessionId: string): boolean {
    const row = this.db.prepare(`
      SELECT COALESCE(SUM(token_count), 0) as total_tokens
      FROM conversation_summaries
      WHERE session_id = ? AND COALESCE(compacted, 0) = 0
    `).get(sessionId) as { total_tokens: number };
    return row.total_tokens > this.tokenThreshold;
  }
```

- [ ] **Step 4: Run → PASS.** `npx jest src/services/compaction-service.test.ts`

- [ ] **Step 5: Commit** — `git commit -m "feat(episodic): exclude compacted rows from compaction trigger"`

---

## Task 3: `compact()` re-inserts the merged row (flagged compacted)

**Files:** Modify `src/services/compaction-service.ts` (the transaction, ~85-115); Test `src/services/compaction-service.test.ts`

- [ ] **Step 1: Update the existing contract test + add fold-in test.** In `src/services/compaction-service.test.ts`, the assertion that expects **0** rows after `compact()` must become **1 compacted row** holding the merged text. Add:

```typescript
it('retains the merged summary as a single compacted, recallable row', async () => {
  const db = makeTestDb();
  const ins = db.prepare(
    `INSERT INTO conversation_summaries (session_id, ai_model, summary, token_count, started_at)
     VALUES ('s1','opus',?,25000,?)`,
  );
  ins.run('alpha note', '2026-01-01T00:00:00Z');
  ins.run('beta note', '2026-01-02T00:00:00Z'); // 50k > 40k

  await new CompactionService(db).compact('s1');

  const rows = db.prepare(
    `SELECT summary, compacted FROM conversation_summaries WHERE session_id='s1'`,
  ).all() as Array<{ summary: string; compacted: number }>;
  expect(rows).toHaveLength(1);
  expect(rows[0].compacted).toBe(1);
  expect(rows[0].summary).toContain('alpha note');
  expect(rows[0].summary).toContain('beta note');
  // And it must not re-trigger:
  expect(new CompactionService(db).needsCompaction('s1')).toBe(false);
});
```

- [ ] **Step 2: Run → FAIL** (current `compact()` deletes all rows, leaves 0).

- [ ] **Step 3: Implement** — inside the `compact()` transaction, after the existing `DELETE FROM conversation_summaries WHERE id IN (...)`, add the merged-row INSERT. The merged row uses the latest source `started_at` so it sorts at the recency position of the newest folded content:

```typescript
      // Retain the consolidated history as ONE compacted row so it stays in the
      // recall corpus. compacted=1 keeps it out of the compaction trigger.
      const latestStartedAt = summaries[summaries.length - 1].started_at;
      this.db.prepare(`
        INSERT INTO conversation_summaries
          (session_id, ai_model, summary, token_count, started_at, compacted)
        VALUES (?, 'compaction', ?, ?, ?, 1)
      `).run(sessionId, compacted, totalTokens, latestStartedAt);
```
> `summaries` is already ordered `started_at ASC`, and the SELECT pulls ALL rows (compacted + new), so a second compaction folds the prior merged row back in. The new row is not in `sourceIds`, so the preceding DELETE leaves it intact.

- [ ] **Step 4: Run → PASS.** `npx jest src/services/compaction-service.test.ts`

- [ ] **Step 5: Run the recover suite** (the empty-summaries guard still returns early before this INSERT): `npx jest src/services/compaction-service.recover.test.ts`

- [ ] **Step 6: Commit** — `git commit -m "feat(episodic): retain compacted summary as a recallable row"`

---

## Task 4: Prove recall surfaces compacted history end-to-end

**Files:** Test `src/tools/workspace-tools.compaction.test.ts` (extend — it already mocks `db/index.js`, `vector-service.js`, etc.)

- [ ] **Step 1: Add the end-to-end test** — after summaries are auto-compacted via `devlog_session_summary_add`, `devlog_session_recall` returns the merged content:

```typescript
it('session_recall surfaces compacted history', async () => {
  const recall = workspaceTools.find((t: { name: string }) => t.name === 'devlog_session_recall')!;
  for (const i of [1, 2]) {
    await summaryAdd.handler({ session_id: 's1', ai_model: 'opus', summary: `chunk ${i}`, token_count: 25000 });
  }
  // Auto-compaction fired (50k > 40k); the merged row must still be recallable.
  const res = await recall.handler({ query: 'chunk' });
  const text = (res.content[0] as { text: string }).text;
  expect(text).toContain('chunk 1');
  expect(text).toContain('chunk 2');
});
```
> The compaction test's `beforeEach` must create `conversation_summaries` (the `CompactionService` ctor will add `compacted`; `session_recall` calls `ensureEpisodicEmbeddingColumn`). Confirm the table has the columns `session_recall` selects.

- [ ] **Step 2: Run → it should PASS** with Tasks 1–3 in place (the merged row is a normal `conversation_summaries` row). If it fails, the recall path is filtering out `compacted=1` rows — fix by ensuring `session_recall` does NOT add a `compacted` predicate.

- [ ] **Step 3: Commit** — `git commit -m "test(episodic): verify recall surfaces compacted history"`

---

## Task 5: Documentation truth-up

**Files:** Modify `README.md` (~line 56 and the agentic-loop section ~312-325)

- [ ] **Step 1:** Update README line 56 — recall is no longer substring-only; it now semantically re-ranks (PR #12) and surfaces compacted history. Replace the parenthetical "(filtered by `query` substring and an ISO `since` bound)" with language reflecting hybrid substring + semantic re-rank, and add a sentence: "Long sessions are auto-compacted, and the consolidated summary remains recallable."

- [ ] **Step 2:** In the "agentic loop" section, optionally add a line noting that compaction keeps the recall leg complete (consolidated reasoning is not dropped).

- [ ] **Step 3: Commit** — `git commit -m "docs: recall is semantic + compaction-aware"`

---

## Final verification

- [ ] `npm run lint && npm test && npm run build` — all green, test count ≥ 824 + new (no regressions).
- [ ] Manual smoke: add summaries past 40k tokens in one session → `devlog_session_recall { query }` returns the merged text; add more summaries → re-compaction folds them in; only one `compacted=1` row remains per session.

## Self-Review

- **Spec coverage:** recall-after-compaction (T3+T4), no infinite loop (T2 + T3 test), no regression (existing compaction test updated in T3, full suite in final), docs (T5). ✅
- **Loop safety:** `needsCompaction` excludes `compacted=1`; the merged row alone can never re-trigger; new uncompacted rows still re-compact and fold the merged row back in. ✅
- **Blast radius:** `CompactionService` stays Ollama-free; only one new column + one INSERT + one WHERE clause; recall path unchanged (already reads `conversation_summaries`). ✅
- **Type consistency:** `ensureCompactedColumn` defined in T1 is used in T1's ctor wiring; `compacted` column used by T2/T3/T4 all reference the same `INTEGER 0/1`. ✅
- **Known follow-up:** merged row has `NULL` embedding, so semantic queries rank it via the `sim=-1` fallback (last). Embedding compacted rows is a future enhancement (would require an embedding step at the `workspace-tools` layer post-`compact()`, since `CompactionService` is intentionally Ollama-free).
