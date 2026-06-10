/**
 * Regression test: the unified server (the `npx -y dokoro` default entrypoint)
 * must register the advisory file-claim, archive, and presence tools — a tool
 * missing here is invisible to every per-project install even though
 * core-server has it.
 *
 * Mirrors core-server.test.ts: mock the db and the server runtime so importing
 * unified-server.ts to inspect its exported `unifiedTools` does NOT start a
 * real MCP server as an import side-effect.
 */
import Database from 'better-sqlite3';
import { jest } from '@jest/globals';

// Mock db and ESM-only modules the same way other dokoro tool tests do.
jest.mock('../db/index.js', () => ({
  getSqliteDb: () => {
    const test = (globalThis as { __TEST_DB__?: Database.Database }).__TEST_DB__;
    if (test) return test;
    throw new Error('test DB not set');
  },
  ensureVectorTables: () => {},
}));

jest.mock('../utils/render-output.js', () => ({
  renderOutput: (data: unknown) => JSON.stringify(data),
}));
jest.mock('../utils/color-setup.js', () => ({}));

// Stub the server runtime so importing unified-server.ts does not start a server.
jest.mock('./base-server.js', () => ({
  createDokoroServer: () => ({}),
  startServer: () => Promise.resolve(),
}));

function getUnifiedToolNames(): string[] {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { unifiedTools } = require('./unified-server.js') as typeof import('./unified-server.js');
  return unifiedTools.map((t: { name: string }) => t.name);
}

describe('unified-server tool registration', () => {
  it('exported unifiedTools has no undefined entries', () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { unifiedTools } = require('./unified-server.js') as typeof import('./unified-server.js');
    expect(unifiedTools.length).toBeGreaterThan(0);
    expect(unifiedTools.every((t: { name?: string }) => typeof t?.name === 'string')).toBe(true);
  });

  it('includes the advisory file-claim tools', () => {
    const names = getUnifiedToolNames();
    expect(names).toContain('dokoro_file_claim');
    expect(names).toContain('dokoro_file_release');
    expect(names).toContain('dokoro_claim_list');
  });

  it('includes the archive maintenance tools', () => {
    const names = getUnifiedToolNames();
    expect(names).toContain('dokoro_archive_sweep');
  });

  it('includes the presence (heartbeat) tools so claim liveness labels work', () => {
    const names = getUnifiedToolNames();
    expect(names).toContain('dokoro_presence_ping');
    expect(names).toContain('dokoro_presence_list');
  });

  it('registers no duplicate tool names', () => {
    const names = getUnifiedToolNames();
    expect(new Set(names).size).toBe(names.length);
  });
});
