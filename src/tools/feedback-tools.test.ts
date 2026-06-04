import Database from 'better-sqlite3';
import { jest } from '@jest/globals';
import { z } from 'zod';
import { ensureAgentFeedbackTable } from '../db/agent-feedback.js';

// Mock '../db/index.js' so importing feedback-tools doesn't trigger evaluation
// of src/db/index.ts (which uses import.meta.url and trips ts-jest's CJS transform).
// In tests we always short-circuit through globalThis.__TEST_DB__, so the mock
// implementation is never called.
jest.mock('../db/index.js', () => ({
  getSqliteDb: () => { throw new Error('getSqliteDb should not be called in tests (use __TEST_DB__)'); },
}));

// Import after the mock is registered.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { feedbackTools } = require('./feedback-tools.js') as typeof import('./feedback-tools.js');

function findTool(name: string) {
  const t = feedbackTools.find((x) => x.name === name);
  if (!t) throw new Error(`tool ${name} not found`);
  return t;
}

describe('feedback-tools', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(':memory:');
    // Create prerequisite tables that agent_feedback references
    db.exec(`
      CREATE TABLE IF NOT EXISTS docs (
        id TEXT PRIMARY KEY,
        filepath TEXT UNIQUE NOT NULL,
        title TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        started_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        status TEXT NOT NULL DEFAULT 'active'
      );
    `);
    ensureAgentFeedbackTable(db);
    (globalThis as Record<string, unknown>).__TEST_DB__ = db;
  });

  afterEach(() => {
    db.close();
    delete (globalThis as Record<string, unknown>).__TEST_DB__;
  });

  it('dokoro_feedback_record persists a row', async () => {
    const tool = findTool('dokoro_feedback_record');
    const res = await tool.handler({
      agent_id: 'claude-opus-4-7',
      tool_name: 'dokoro_entity_extract_deep',
      outcome: 'success',
      confidence: 0.9,
      latency_ms: 1200,
    });
    expect(res.isError).toBeFalsy();
    const n = db.prepare('SELECT COUNT(*) AS n FROM agent_feedback').get() as { n: number };
    expect(n.n).toBe(1);
  });

  it('dokoro_feedback_query returns success rate per tool', async () => {
    const rec = findTool('dokoro_feedback_record');
    await rec.handler({ agent_id: 'a', tool_name: 't', outcome: 'success', confidence: 1 });
    await rec.handler({ agent_id: 'a', tool_name: 't', outcome: 'failure', confidence: 0 });

    const q = findTool('dokoro_feedback_query');
    const res = await q.handler({ tool_name: 't' });
    const text = res.content?.[0]?.type === 'text' ? res.content[0].text : '';
    expect(text).toMatch(/success.*1/i);
    expect(text).toMatch(/failure.*1/i);
    expect(text).toMatch(/success_rate.*0\.5/i);
  });

  describe('dokoro_feedback_query since param validation (BUG-18)', () => {
    it('rejects a malformed since value ("last week")', () => {
      const q = findTool('dokoro_feedback_query');
      const schema = z.object(q.inputSchema);
      const result = schema.safeParse({ since: 'last week' });
      expect(result.success).toBe(false);
    });

    it('rejects an ISO datetime with trailing Z (no date-only prefix)', () => {
      const q = findTool('dokoro_feedback_query');
      const schema = z.object(q.inputSchema);
      // Strings not starting with YYYY-MM-DD should fail
      const result = schema.safeParse({ since: 'T14:30:00Z' });
      expect(result.success).toBe(false);
    });

    it('accepts a valid ISO date prefix (YYYY-MM-DD)', () => {
      const q = findTool('dokoro_feedback_query');
      const schema = z.object(q.inputSchema);
      expect(schema.safeParse({ since: '2026-05-01' }).success).toBe(true);
    });

    it('accepts ISO datetime with YYYY-MM-DD prefix', () => {
      const q = findTool('dokoro_feedback_query');
      const schema = z.object(q.inputSchema);
      expect(schema.safeParse({ since: '2026-05-01T00:00:00Z' }).success).toBe(true);
    });

    it('valid since filters results correctly', async () => {
      // Insert one old row and one recent row
      db.prepare(`
        INSERT INTO agent_feedback (agent_id, tool_name, outcome, recorded_at)
        VALUES ('a', 'tool_old', 'success', '2020-01-01 00:00:00'),
               ('a', 'tool_new', 'success', '2026-05-01 00:00:00')
      `).run();

      const q = findTool('dokoro_feedback_query');
      const res = await q.handler({ since: '2026-01-01' });
      const text = res.content?.[0]?.type === 'text' ? res.content[0].text : '';
      expect(text).toMatch(/tool_new/);
      expect(text).not.toMatch(/tool_old/);
    });
  });
});
