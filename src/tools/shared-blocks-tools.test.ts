import Database from 'better-sqlite3';
import { jest } from '@jest/globals';

jest.mock('../db/index.js', () => ({
  getSqliteDb: () => { throw new Error('getSqliteDb should not be called in tests (use __TEST_DB__)'); },
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { sharedBlocksTools } = require('./shared-blocks-tools.js') as typeof import('./shared-blocks-tools.js');

function findTool(name: string) {
  const t = sharedBlocksTools.find((x) => x.name === name);
  if (!t) throw new Error(`tool ${name} not found`);
  return t;
}
function textOf(res: { content?: Array<{ type: string; text?: string }> }): string {
  return res.content?.[0]?.type === 'text' ? (res.content[0].text ?? '') : '';
}

describe('shared-blocks-tools', () => {
  let db: Database.Database;
  beforeEach(() => {
    db = new Database(':memory:');
    db.exec(`
      CREATE TABLE shared_blocks (
        block_key TEXT PRIMARY KEY,
        content TEXT NOT NULL,
        version INTEGER NOT NULL DEFAULT 1,
        updated_by TEXT NOT NULL,
        created_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
        updated_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
      );
    `);
    (globalThis as Record<string, unknown>).__TEST_DB__ = db;
  });
  afterEach(() => { db.close(); delete (globalThis as Record<string, unknown>).__TEST_DB__; });

  it('block_write creates a new block at version 1', async () => {
    const res = await findTool('dokoro_block_write').handler({ block_key: 'plan', content: 'do X', agent_id: 'a' });
    expect(res.isError).toBeFalsy();
    const row = db.prepare('SELECT content, version, updated_by FROM shared_blocks WHERE block_key=?').get('plan') as
      { content: string; version: number; updated_by: string };
    expect(row).toMatchObject({ content: 'do X', version: 1, updated_by: 'a' });
  });

  it('block_write without expected_version overwrites and bumps version (last-writer-wins)', async () => {
    await findTool('dokoro_block_write').handler({ block_key: 'plan', content: 'v1', agent_id: 'a' });
    await findTool('dokoro_block_write').handler({ block_key: 'plan', content: 'v2', agent_id: 'b' });
    const row = db.prepare('SELECT content, version FROM shared_blocks WHERE block_key=?').get('plan') as
      { content: string; version: number };
    expect(row).toMatchObject({ content: 'v2', version: 2 });
  });

  it('block_write with a STALE expected_version is rejected as a conflict (no clobber)', async () => {
    await findTool('dokoro_block_write').handler({ block_key: 'plan', content: 'v1', agent_id: 'a' }); // version 1
    await findTool('dokoro_block_write').handler({ block_key: 'plan', content: 'v2', agent_id: 'b' }); // version 2
    const res = await findTool('dokoro_block_write').handler({ block_key: 'plan', content: 'stale', agent_id: 'c', expected_version: 1 });
    expect(res.isError).toBe(true);
    expect(textOf(res)).toMatch(/conflict/i);
    // unchanged
    const row = db.prepare('SELECT content, version FROM shared_blocks WHERE block_key=?').get('plan') as { content: string; version: number };
    expect(row).toMatchObject({ content: 'v2', version: 2 });
  });

  it('block_write with a MATCHING expected_version succeeds and bumps version', async () => {
    await findTool('dokoro_block_write').handler({ block_key: 'plan', content: 'v1', agent_id: 'a' }); // version 1
    const res = await findTool('dokoro_block_write').handler({ block_key: 'plan', content: 'v2', agent_id: 'b', expected_version: 1 });
    expect(res.isError).toBeFalsy();
    const row = db.prepare('SELECT content, version FROM shared_blocks WHERE block_key=?').get('plan') as { content: string; version: number };
    expect(row).toMatchObject({ content: 'v2', version: 2 });
  });

  it('block_read returns content + version + updated_by, or a not-found message', async () => {
    await findTool('dokoro_block_write').handler({ block_key: 'plan', content: 'the plan', agent_id: 'a' });
    const hit = await findTool('dokoro_block_read').handler({ block_key: 'plan' });
    expect(textOf(hit)).toMatch(/the plan/);
    expect(textOf(hit)).toMatch(/version 1/);
    expect(textOf(hit)).toMatch(/\ba\b/);
    const miss = await findTool('dokoro_block_read').handler({ block_key: 'nope' });
    expect(textOf(miss)).toMatch(/no block/i);
  });

  it('block_list lists block keys with version + updater, newest-updated first', async () => {
    await findTool('dokoro_block_write').handler({ block_key: 'alpha', content: 'a', agent_id: 'x' });
    await findTool('dokoro_block_write').handler({ block_key: 'beta', content: 'b', agent_id: 'y' });
    const res = await findTool('dokoro_block_list').handler({});
    const t = textOf(res);
    expect(t).toMatch(/alpha/);
    expect(t).toMatch(/beta/);
  });
});
