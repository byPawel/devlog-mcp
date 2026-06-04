import Database from 'better-sqlite3';
import { jest } from '@jest/globals';
import { z } from 'zod';

// Mock '../db/index.js' so importing shared-notes-tools doesn't trigger evaluation
// of src/db/index.ts (which uses import.meta.url and trips ts-jest's CJS transform).
// In tests we always short-circuit through globalThis.__TEST_DB__, so the mock
// implementation is never called.
jest.mock('../db/index.js', () => ({
  getSqliteDb: () => { throw new Error('getSqliteDb should not be called in tests (use __TEST_DB__)'); },
}));

// Import after the mock is registered.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { sharedNotesTools } = require('./shared-notes-tools.js') as typeof import('./shared-notes-tools.js');

function findTool(name: string) {
  const t = sharedNotesTools.find((x) => x.name === name);
  if (!t) throw new Error(`tool ${name} not found`);
  return t;
}

function textOf(res: { content?: Array<{ type: string; text?: string }> }): string {
  return res.content?.[0]?.type === 'text' ? (res.content[0].text ?? '') : '';
}

describe('shared-notes-tools', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(':memory:');
    db.exec(`
      CREATE TABLE IF NOT EXISTS shared_notes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        agent_id TEXT NOT NULL,
        content TEXT NOT NULL,
        note_type TEXT DEFAULT 'scratch',
        metadata_json TEXT,
        created_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
      );
      CREATE INDEX IF NOT EXISTS idx_shared_notes_created_at ON shared_notes(created_at);
      CREATE INDEX IF NOT EXISTS idx_shared_notes_agent_id ON shared_notes(agent_id);
    `);
    (globalThis as Record<string, unknown>).__TEST_DB__ = db;
  });

  afterEach(() => {
    db.close();
    delete (globalThis as Record<string, unknown>).__TEST_DB__;
  });

  it('dokoro_shared_note_append inserts a row and returns success text', async () => {
    const append = findTool('dokoro_shared_note_append');
    const res = await append.handler({ agent_id: 'claude-a', content: 'investigating the lock manager' });
    expect(res.isError).toBeFalsy();
    expect(textOf(res)).toMatch(/claude-a/);
    const n = db.prepare('SELECT COUNT(*) AS n FROM shared_notes').get() as { n: number };
    expect(n.n).toBe(1);
    const row = db.prepare('SELECT agent_id, content, note_type FROM shared_notes').get() as {
      agent_id: string; content: string; note_type: string;
    };
    expect(row).toMatchObject({ agent_id: 'claude-a', content: 'investigating the lock manager', note_type: 'scratch' });
  });

  it('dokoro_shared_note_append persists note_type and metadata', async () => {
    const append = findTool('dokoro_shared_note_append');
    await append.handler({
      agent_id: 'claude-b',
      content: 'blocked on migration numbering',
      note_type: 'blocker',
      metadata: { ticket: 'BUG-99' },
    });
    const row = db.prepare('SELECT note_type, metadata_json FROM shared_notes').get() as {
      note_type: string; metadata_json: string;
    };
    expect(row.note_type).toBe('blocker');
    expect(JSON.parse(row.metadata_json)).toEqual({ ticket: 'BUG-99' });
  });

  it('dokoro_shared_note_append rejects a missing agent_id at the schema boundary', () => {
    const append = findTool('dokoro_shared_note_append');
    const schema = z.object(append.inputSchema);
    expect(schema.safeParse({ content: 'orphan note' }).success).toBe(false);
  });

  it('dokoro_shared_note_read returns rows in created_at DESC order', async () => {
    db.prepare(`INSERT INTO shared_notes (agent_id, content, created_at) VALUES
      ('a', 'oldest', '2026-01-01T00:00:00Z'),
      ('b', 'middle', '2026-03-01T00:00:00Z'),
      ('c', 'newest', '2026-06-01T00:00:00Z')`).run();

    const read = findTool('dokoro_shared_note_read');
    const res = await read.handler({});
    expect(res.isError).toBeFalsy();
    const text = textOf(res);
    const idxNewest = text.indexOf('newest');
    const idxMiddle = text.indexOf('middle');
    const idxOldest = text.indexOf('oldest');
    expect(idxNewest).toBeGreaterThanOrEqual(0);
    expect(idxNewest).toBeLessThan(idxMiddle);
    expect(idxMiddle).toBeLessThan(idxOldest);
  });

  it('dokoro_shared_note_read with agent_id filter returns only that agent notes', async () => {
    db.prepare(`INSERT INTO shared_notes (agent_id, content) VALUES
      ('agent-x', 'from x'), ('agent-y', 'from y')`).run();

    const read = findTool('dokoro_shared_note_read');
    const res = await read.handler({ agent_id: 'agent-x' });
    const text = textOf(res);
    expect(text).toMatch(/from x/);
    expect(text).not.toMatch(/from y/);
  });

  it('dokoro_shared_note_read respects limit', async () => {
    const append = findTool('dokoro_shared_note_append');
    for (let i = 0; i < 5; i++) {
      await append.handler({ agent_id: 'a', content: `note-${i}` });
    }
    const read = findTool('dokoro_shared_note_read');
    const res = await read.handler({ limit: 2 });
    const text = textOf(res);
    const lines = text.split('\n').filter((l) => l.includes('agent='));
    expect(lines).toHaveLength(2);
  });

  it('dokoro_shared_note_read with since filters by created_at lower bound', async () => {
    db.prepare(`INSERT INTO shared_notes (agent_id, content, created_at) VALUES
      ('a', 'too-old', '2020-01-01T00:00:00Z'),
      ('a', 'recent', '2026-05-01T00:00:00Z')`).run();

    const read = findTool('dokoro_shared_note_read');
    const res = await read.handler({ since: '2026-01-01' });
    const text = textOf(res);
    expect(text).toMatch(/recent/);
    expect(text).not.toMatch(/too-old/);
  });

  it('dokoro_shared_note_read with note_type filters by type', async () => {
    db.prepare(`INSERT INTO shared_notes (agent_id, content, note_type) VALUES
      ('a', 'a decision', 'decision'),
      ('a', 'a scratch', 'scratch')`).run();

    const read = findTool('dokoro_shared_note_read');
    const res = await read.handler({ note_type: 'decision' });
    const text = textOf(res);
    expect(text).toMatch(/a decision/);
    expect(text).not.toMatch(/a scratch/);
  });

  it('dokoro_shared_note_read rejects a malformed since value', () => {
    const read = findTool('dokoro_shared_note_read');
    const schema = z.object(read.inputSchema);
    expect(schema.safeParse({ since: 'last week' }).success).toBe(false);
  });

  it('concurrent appends from two agents all land with correct agent_id', async () => {
    const append = findTool('dokoro_shared_note_append');
    // Simulate two agents writing into the same shared block (WAL serialises writes).
    await Promise.all([
      append.handler({ agent_id: 'agent-1', content: 'from agent 1' }),
      append.handler({ agent_id: 'agent-2', content: 'from agent 2' }),
    ]);
    const rows = db.prepare('SELECT agent_id, content FROM shared_notes ORDER BY agent_id').all() as Array<{
      agent_id: string; content: string;
    }>;
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.agent_id)).toEqual(['agent-1', 'agent-2']);
  });

  it('dokoro_shared_note_read returns a friendly message when there are no notes', async () => {
    const read = findTool('dokoro_shared_note_read');
    const res = await read.handler({});
    expect(res.isError).toBeFalsy();
    expect(textOf(res)).toMatch(/no shared notes/i);
  });
});
