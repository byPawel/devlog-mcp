import Database from 'better-sqlite3';
import { jest } from '@jest/globals';

jest.mock('../db/index.js', () => ({
  getSqliteDb: () => { throw new Error('getSqliteDb should not be called in tests (use __TEST_DB__)'); },
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { presenceTools } = require('./presence-tools.js') as typeof import('./presence-tools.js');

function findTool(name: string) {
  const t = presenceTools.find((x) => x.name === name);
  if (!t) throw new Error(`tool ${name} not found`);
  return t;
}
function textOf(res: { content?: Array<{ type: string; text?: string }> }): string {
  return res.content?.[0]?.type === 'text' ? (res.content[0].text ?? '') : '';
}

describe('presence-tools', () => {
  let db: Database.Database;
  beforeEach(() => {
    db = new Database(':memory:');
    db.exec(`
      CREATE TABLE agent_presence (
        agent_id TEXT PRIMARY KEY,
        session_id TEXT,
        status TEXT NOT NULL DEFAULT 'active',
        current_focus TEXT,
        last_heartbeat INTEGER NOT NULL,
        heartbeat_seq INTEGER NOT NULL DEFAULT 0
      );
    `);
    (globalThis as Record<string, unknown>).__TEST_DB__ = db;
  });
  afterEach(() => { db.close(); delete (globalThis as Record<string, unknown>).__TEST_DB__; });

  it('presence_ping upserts one row per agent and bumps heartbeat_seq', async () => {
    const ping = findTool('dokoro_presence_ping');
    await ping.handler({ agent_id: 'a', current_focus: 'auth' });
    await ping.handler({ agent_id: 'a', current_focus: 'auth refactor' });
    const row = db.prepare('SELECT current_focus, heartbeat_seq FROM agent_presence WHERE agent_id=?').get('a') as
      { current_focus: string; heartbeat_seq: number };
    expect(row.current_focus).toBe('auth refactor');
    expect(row.heartbeat_seq).toBe(2);
    const n = db.prepare('SELECT COUNT(*) AS n FROM agent_presence').get() as { n: number };
    expect(n.n).toBe(1); // upsert, not insert
  });

  it('presence_list returns only agents alive within the TTL (read-time liveness)', async () => {
    // 'fresh' just pinged; 'stale' last beat well beyond the TTL.
    await findTool('dokoro_presence_ping').handler({ agent_id: 'fresh', current_focus: 'now' });
    db.prepare(`INSERT INTO agent_presence (agent_id, status, last_heartbeat, heartbeat_seq) VALUES ('stale','active', strftime('%s','now') - 99999, 1)`).run();
    const res = await findTool('dokoro_presence_list').handler({});
    const t = textOf(res);
    expect(t).toMatch(/fresh/);
    expect(t).not.toMatch(/stale/);
  });
});
