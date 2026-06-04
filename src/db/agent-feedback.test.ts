import Database from 'better-sqlite3';
import { ensureAgentFeedbackTable } from './agent-feedback.js';

describe('agent_feedback table', () => {
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
  });

  afterEach(() => db.close());

  it('records a tool outcome and reads it back', () => {
    db.prepare(`
      INSERT INTO agent_feedback
        (agent_id, tool_name, outcome, confidence, latency_ms, error_message, doc_id, session_id, recorded_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
    `).run('claude-opus-4-7', 'dokoro_entity_extract_deep', 'success', 0.91, 1240, null, null, null);

    const row = db.prepare(`SELECT outcome, confidence FROM agent_feedback WHERE tool_name = ?`)
      .get('dokoro_entity_extract_deep') as { outcome: string; confidence: number };

    expect(row.outcome).toBe('success');
    expect(row.confidence).toBeCloseTo(0.91, 2);
  });

  it('computes per-tool success rate', () => {
    const insert = db.prepare(`
      INSERT INTO agent_feedback (agent_id, tool_name, outcome, confidence, recorded_at)
      VALUES (?, ?, ?, ?, datetime('now'))
    `);
    insert.run('a', 't', 'success', 1.0);
    insert.run('a', 't', 'success', 1.0);
    insert.run('a', 't', 'failure', 0.0);

    const stats = db.prepare(`
      SELECT
        COUNT(*) AS total,
        SUM(CASE WHEN outcome = 'success' THEN 1 ELSE 0 END) AS wins
      FROM agent_feedback WHERE tool_name = ?
    `).get('t') as { total: number; wins: number };

    expect(stats.total).toBe(3);
    expect(stats.wins).toBe(2);
  });
});
