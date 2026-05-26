import Database from 'better-sqlite3';
import { jest } from '@jest/globals';
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

  it('devlog_feedback_record persists a row', async () => {
    const tool = findTool('devlog_feedback_record');
    const res = await tool.handler({
      agent_id: 'claude-opus-4-7',
      tool_name: 'devlog_entity_extract_deep',
      outcome: 'success',
      confidence: 0.9,
      latency_ms: 1200,
    });
    expect(res.isError).toBeFalsy();
    const n = db.prepare('SELECT COUNT(*) AS n FROM agent_feedback').get() as { n: number };
    expect(n.n).toBe(1);
  });

  it('devlog_feedback_query returns success rate per tool', async () => {
    const rec = findTool('devlog_feedback_record');
    await rec.handler({ agent_id: 'a', tool_name: 't', outcome: 'success', confidence: 1 });
    await rec.handler({ agent_id: 'a', tool_name: 't', outcome: 'failure', confidence: 0 });

    const q = findTool('devlog_feedback_query');
    const res = await q.handler({ tool_name: 't' });
    const text = res.content?.[0]?.type === 'text' ? res.content[0].text : '';
    expect(text).toMatch(/success.*1/i);
    expect(text).toMatch(/failure.*1/i);
    expect(text).toMatch(/success_rate.*0\.5/i);
  });
});
