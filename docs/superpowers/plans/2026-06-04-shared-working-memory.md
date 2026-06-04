# Shared working memory for simultaneous multi-agent work

Date: 2026-06-04
Status: implemented (smallest correct increment)

## Goal

Let multiple agents working in the SAME project collaborate on live working
memory at the same time (Letta-style shared blocks), WITHIN a project only.
The /council verdict rejected cross-project/global memory, so there is
intentionally NO global or shared-across-projects store.

Today the workspace lock (`src/utils/lock-manager.ts`) is single-active-claimant:
one agent holds the `current.md` workspace; others wait or steal-stale. The goal
is a minimal, correct increment that lets agents append to and read a shared
notes stream concurrently without contending for that exclusive lock.

## Approach (landed)

Add a SQLite-backed append-only `shared_notes` table (migration v8) to the
existing per-project database, which already runs in WAL mode with
`busy_timeout=5000`. Two new tools — `dokoro_shared_note_append` and
`dokoro_shared_note_read` — let multiple agents concurrently write and read
short notes scoped to the current project.

The file-based workspace lock is NOT touched: shared notes live entirely in the
DB and bypass the `current.md` ownership model. They are additive, not
exclusive, so an agent need not hold the workspace claim to record a note.

Per-project isolation is structural: each project has a distinct
`.dokoro/db/dokoro.sqlite` file. No global or cross-project store is introduced.

## Schema (migration v8)

```sql
CREATE TABLE IF NOT EXISTS shared_notes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  agent_id TEXT NOT NULL,
  content TEXT NOT NULL,
  note_type TEXT DEFAULT 'scratch',
  metadata_json TEXT,
  created_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_shared_notes_created_at ON shared_notes(created_at);
CREATE INDEX IF NOT EXISTS idx_shared_notes_agent_id   ON shared_notes(agent_id);
```

Statements run individually (not `db.exec`), consistent with v2/v7. No `down()`
path (consistent with v1–v7): drop `shared_notes` manually to revert.

## Tools

- `dokoro_shared_note_append(agent_id, content, note_type?, metadata?)`
  — appends one agent-tagged row; `note_type` ∈ scratch|decision|blocker|handoff
  (default scratch). Returns `note appended by {agent_id}`.
- `dokoro_shared_note_read(agent_id?, note_type?, since?, limit?)`
  — newest-first read with optional filters; `since` is a YYYY-MM-DD prefix
  lower bound; `limit` ≤ 200 (default 50). Formats rows as
  `[{created_at}] [{note_type}] agent={agent_id}: {content}`.

Both registered in `core-server.ts` alongside the affective-memory tools.

## Concurrency correctness

SQLite WAL + `busy_timeout` handles concurrent INSERTs gracefully. If two agents
INSERT simultaneously, SQLite serialises them under the write lock rather than
losing data — last-writer-safe. `lock-manager.ts` is unchanged.

## Deferred

- Relaxing `lock-manager.ts` itself to allow concurrent writes to a shared
  SECTION of `current.md` while still protecting exclusive sections. The DB-backed
  approach sidesteps this entirely for working notes; coordinated locking would
  only be needed if shared notes must be transactionally consistent with
  `current.md` content.
- Vector indexing / embeddings of shared notes for semantic recall.
- A compaction/retention policy for the append-only stream.

## Files

- `src/db/migrations.ts` (v8) + `src/db/migrations.test.ts`
- `src/tools/shared-notes-tools.ts` + `src/tools/shared-notes-tools.test.ts`
- `src/servers/core-server.ts` + `src/servers/core-server.test.ts`
