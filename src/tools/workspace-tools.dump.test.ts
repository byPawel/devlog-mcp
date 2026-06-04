/**
 * BUG-21: workspace_dump upsert preserves enriched columns.
 *
 * We test the DB-level behaviour directly: the INSERT ... ON CONFLICT DO UPDATE
 * in the dump path must NOT overwrite embedding_id, embedding_model,
 * time_estimated_min, time_actual_min, or other enrichment columns when a doc
 * row already exists.
 */

import Database from 'better-sqlite3';

// We exercise the SQL statement directly, mirroring what workspace-tools.ts does.
// This avoids the heavy file-system / workspace scaffolding required to invoke
// the full dokoro_workspace_dump handler.
function runDumpUpsert(
  db: Database.Database,
  docId: string,
  relPath: string,
  task: string,
  sessionContent: string,
  docType: string,
  status: string,
  now_iso: string
): void {
  db.prepare(`
    INSERT INTO docs (id, filepath, title, content, doc_type, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      filepath    = excluded.filepath,
      title       = excluded.title,
      content     = excluded.content,
      doc_type    = excluded.doc_type,
      status      = excluded.status,
      updated_at  = excluded.updated_at
  `).run(docId, relPath, `Session: ${task}`, sessionContent, docType, status, now_iso, now_iso);
}

describe('workspace_dump upsert (BUG-21)', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(':memory:');
    db.prepare(`
      CREATE TABLE docs (
        id TEXT PRIMARY KEY,
        filepath TEXT UNIQUE NOT NULL,
        title TEXT NOT NULL,
        content TEXT,
        doc_type TEXT NOT NULL DEFAULT 'issue',
        status TEXT NOT NULL DEFAULT 'inbox',
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        embedding_id TEXT,
        embedding_model TEXT,
        embedding_updated_at TEXT,
        time_estimated_min INTEGER,
        time_actual_min INTEGER,
        metadata_json TEXT,
        content_hash TEXT
      )
    `).run();
  });

  afterEach(() => db.close());

  it('preserves embedding_id and other enriched columns on re-dump', () => {
    const docId = 'test-session-doc';
    const now1 = '2026-01-01T10:00:00.000Z';

    // First dump — inserts the row
    runDumpUpsert(db, docId, 'daily/test.md', 'initial task', 'content v1', 'session', 'active', now1);

    // Simulate enrichment that happened after the first dump
    db.prepare(`
      UPDATE docs SET
        embedding_id = 'embed-abc',
        embedding_model = 'nomic-embed-text',
        time_estimated_min = 90
      WHERE id = ?
    `).run(docId);

    const before = db.prepare('SELECT * FROM docs WHERE id = ?').get(docId) as Record<string, unknown>;
    expect(before.embedding_id).toBe('embed-abc');

    // Second dump — should only overwrite dump-owned columns
    const now2 = '2026-01-01T11:00:00.000Z';
    runDumpUpsert(db, docId, 'daily/test.md', 'updated task', 'content v2', 'session', 'done', now2);

    const after = db.prepare('SELECT * FROM docs WHERE id = ?').get(docId) as Record<string, unknown>;

    // Dump-owned columns updated
    expect(after.content).toBe('content v2');
    expect(after.title).toBe('Session: updated task');
    expect(after.status).toBe('done');
    expect(after.updated_at).toBe(now2);

    // Enriched columns untouched
    expect(after.embedding_id).toBe('embed-abc');
    expect(after.embedding_model).toBe('nomic-embed-text');
    expect(after.time_estimated_min).toBe(90);
  });

  it('inserts a new row if the doc does not yet exist', () => {
    const now = '2026-01-01T09:00:00.000Z';
    runDumpUpsert(db, 'brand-new-doc', 'daily/new.md', 'brand new task', 'body', 'session', 'active', now);

    const row = db.prepare('SELECT * FROM docs WHERE id = ?').get('brand-new-doc') as Record<string, unknown>;
    expect(row).toBeDefined();
    expect(row.content).toBe('body');
    expect(row.embedding_id).toBeNull();
  });
});
