import type Database from 'better-sqlite3';
import { ensureEntityTables } from './entity-tables.js';
import { ensureAgentFeedbackTable } from './agent-feedback.js';

export interface Migration { version: number; description: string; up: (db: Database.Database) => void; }

// Ordered. Never renumber or delete an applied migration; only append.
export const MIGRATIONS: Migration[] = [
  { version: 1, description: 'entity+feedback tables', up: (db) => { ensureEntityTables(db); ensureAgentFeedbackTable(db); } },
  // Rebuild entity_relations from the legacy composite-PK shape to a surrogate
  // `id` PK so the same (source,target,relation_type) tuple can hold multiple
  // bi-temporal slices. A partial unique index keeps exactly one OPEN row per
  // tuple while letting closed history accumulate (BUG-1, BUG-15). Statements run
  // individually (NOT db.exec) so each is a discrete prepared step.
  { version: 2, description: 'entity_relations surrogate PK + partial-unique open index', up: (db) => {
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
  } },
  // Add composite routing index on agent_feedback for the devlog_feedback_route read path.
  // Without this index, the Wilson-bound + decay query performs a full scan per tool
  // group (BUG-12). Statements run individually — NOT db.exec — consistent with v2.
  { version: 3, description: 'agent_feedback composite routing index (BUG-12)', up: (db) => {
    const statements = [
      `CREATE INDEX IF NOT EXISTS idx_feedback_agent_tool_time ON agent_feedback(agent_id, tool_name, recorded_at)`,
    ];
    for (const s of statements) db.prepare(s).run();
  } },
  // Add ON DELETE CASCADE FK to entity_content_hashes so stale hashes are pruned
  // when their parent doc is deleted (BUG-23).  For existing DBs the table is
  // rebuilt (rename → create-with-FK → copy → drop).  Guard: skip if the FK is
  // already present (i.e. table was created by the updated ensureEntityHashTable).
  { version: 4, description: 'entity_content_hashes ON DELETE CASCADE FK (BUG-23)', up: (db) => {
    // Check whether entity_content_hashes even exists yet.  If not, the updated
    // ensureEntityHashTable() will create it correctly on first run, so nothing
    // to do here.
    const tableRow = db.prepare(
      `SELECT name FROM sqlite_master WHERE type='table' AND name='entity_content_hashes'`
    ).get() as { name: string } | undefined;
    if (!tableRow) return;

    // Check if a FK already references docs(id).
    const fkRows = db.prepare(`PRAGMA foreign_key_list(entity_content_hashes)`).all() as Array<{ table: string }>;
    const hasFk = fkRows.some((r) => r.table === 'docs');
    if (hasFk) return; // already correct shape

    const statements = [
      `ALTER TABLE entity_content_hashes RENAME TO entity_content_hashes_old`,
      `CREATE TABLE entity_content_hashes (
        doc_id TEXT PRIMARY KEY REFERENCES docs(id) ON DELETE CASCADE,
        content_hash TEXT NOT NULL,
        last_extracted TEXT DEFAULT CURRENT_TIMESTAMP
      )`,
      `INSERT INTO entity_content_hashes (doc_id, content_hash, last_extracted)
        SELECT doc_id, content_hash, last_extracted FROM entity_content_hashes_old`,
      `DROP TABLE entity_content_hashes_old`,
    ];
    for (const s of statements) db.prepare(s).run();
  } },
  // Drop the unused context_relevance table that was defined in schema.sql but
  // never read or written by any production code (BUG-24).
  { version: 5, description: 'drop unused context_relevance table (BUG-24)', up: (db) => {
    db.prepare(`DROP TABLE IF EXISTS context_relevance`).run();
  } },
  // Backfill entities.canonical_name NULLs → lower(name) so that the
  // UNIQUE(type, canonical_name) dedup constraint is effective on all rows
  // (BUG-25).  SQLite treats each NULL as a distinct value, which allows
  // unlimited duplicates to bypass the constraint.
  //
  // A full table-rebuild to enforce NOT NULL on the column itself is heavy
  // and risky on existing production DBs.  The minimal safe approach is:
  //   1. Backfill any NULL canonical_name to lower(name) — idempotent.
  //   2. The updated CREATE TABLE (ensureEntityTables) uses NOT NULL DEFAULT
  //      (lower(name)) for all new databases going forward.
  // Existing databases with the old nullable column definition continue to
  // work; the app always sets canonical_name explicitly, so NULLs can only
  // accumulate from very old inserts.  The backfill closes that hole.
  { version: 6, description: 'backfill entities.canonical_name NULLs to lower(name) (BUG-25)', up: (db) => {
    // Only backfill if the table exists
    const tableRow = db.prepare(
      `SELECT name FROM sqlite_master WHERE type='table' AND name='entities'`
    ).get() as { name: string } | undefined;
    if (!tableRow) return;
    for (const s of [
      `UPDATE entities SET canonical_name = lower(name) WHERE canonical_name IS NULL`,
    ]) db.prepare(s).run();
  } },
];

export function runMigrations(db: Database.Database): void {
  db.prepare(`CREATE TABLE IF NOT EXISTS schema_version (
    version INTEGER PRIMARY KEY, description TEXT, applied_at TEXT DEFAULT CURRENT_TIMESTAMP
  )`).run();
  const row = db.prepare('SELECT MAX(version) v FROM schema_version').get() as { v: number | null };
  const current = row.v ?? 0;
  // INSERT OR IGNORE: the legacy initializeSchema() init path may also write the
  // version row (e.g. v1 from schema.sql), so ignore conflicts on the PK.
  const record = db.prepare('INSERT OR IGNORE INTO schema_version (version, description) VALUES (?, ?)');
  const apply = db.transaction((m: Migration) => { m.up(db); record.run(m.version, m.description); });
  for (const m of MIGRATIONS) if (m.version > current) apply(m);
}
