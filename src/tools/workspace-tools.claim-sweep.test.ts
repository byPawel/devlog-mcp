/**
 * T7: opportunistic archive sweep on dokoro_workspace_claim.
 *
 * The sweep must NEVER fail the claim: empty sweeps and lock-skips stay
 * silent, moved files produce a one-line summary, and sweep errors surface as
 * a warning while the claim still succeeds.
 *
 * DOKORO_PATH is captured at module import time, so each test points
 * process.env.DOKORO_PATH at a temp dir and loads fresh modules via
 * jest.isolateModules() (same pattern as src/utils/archive.test.ts).
 */

import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { jest } from '@jest/globals';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

jest.mock('../db/index.js', () => ({
  getSqliteDb: () => { throw new Error('getSqliteDb should not be called in these tests'); },
}));

// Mock ESM-only modules that chalk/ink bring in and break ts-jest CJS transform
jest.mock('../utils/render-output.js', () => ({
  renderOutput: (data: unknown) => JSON.stringify(data),
}));
jest.mock('../utils/color-setup.js', () => ({}));

// Offline embedder stub — avoids loading LanceDB / hitting Ollama at import.
jest.mock('../services/embedding-service.js', () => ({
  EmbeddingService: class {
    async embed(): Promise<{ embedding: number[]; tokenCount: number }> {
      return { embedding: [1, 0, 0], tokenCount: 1 };
    }
  },
}));

type WorkspaceToolsModule = typeof import('./workspace-tools.js');
type HeartbeatModule = typeof import('../utils/heartbeat-manager.js');

interface FreshModules {
  workspaceTools: WorkspaceToolsModule['workspaceTools'];
  stopHeartbeat: HeartbeatModule['stopHeartbeat'];
}

const MS_PER_DAY = 86_400_000;

let tmpDir: string;
let mods: FreshModules;

/** Load workspace-tools AND its heartbeat-manager from ONE isolated registry,
 *  so the interval started by the claim handler can be stopped after the test. */
function freshModules(): Promise<FreshModules> {
  return new Promise<FreshModules>((resolve) => {
    jest.isolateModules(() => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const wt = require('./workspace-tools.js') as WorkspaceToolsModule;
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const hb = require('../utils/heartbeat-manager.js') as HeartbeatModule;
      resolve({ workspaceTools: wt.workspaceTools, stopHeartbeat: hb.stopHeartbeat });
    });
  });
}

function claimTool(): WorkspaceToolsModule['workspaceTools'][number] {
  const tool = mods.workspaceTools.find((t) => t.name === 'dokoro_workspace_claim');
  if (!tool) throw new Error('dokoro_workspace_claim not found');
  return tool;
}

function textOf(res: CallToolResult): string {
  return res.content.map((c) => ((c as { text?: string }).text ?? '')).join('\n');
}

const dailyDir = (): string => path.join(tmpDir, 'daily');

/** Daily file named with the real slug shape, dated `n` days ago (UTC). */
async function writeOldDaily(n: number, suffix = 'session'): Promise<string> {
  const stamp = new Date(Date.now() - n * MS_PER_DAY).toISOString().slice(0, 10);
  const name = `${stamp}-10h00-someday-${suffix}.md`;
  await fs.mkdir(dailyDir(), { recursive: true });
  await fs.writeFile(path.join(dailyDir(), name), '# stub\n');
  return name;
}

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'dokoro-claim-sweep-test-'));
  process.env['DOKORO_PATH'] = tmpDir;
  mods = await freshModules();
});

afterEach(async () => {
  mods.stopHeartbeat();
  delete process.env['DOKORO_PATH'];
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe('dokoro_workspace_claim — opportunistic sweep', () => {
  it('claims silently when the sweep finds nothing to move', async () => {
    const res = await claimTool().handler({ task: 'test task' });
    const text = textOf(res);

    expect(res.isError).toBeUndefined();
    expect(text).toContain('Workspace Claimed');
    expect(text).not.toContain('🧹');
    expect(text).not.toContain('sweep');
  });

  it('appends a one-line summary when the sweep moves old daily files', async () => {
    const name = await writeOldDaily(20);

    const res = await claimTool().handler({ task: 'test task' });
    const text = textOf(res);

    expect(res.isError).toBeUndefined();
    expect(text).toContain('Workspace Claimed');
    expect(text).toContain('🧹 archived 1 old daily file(s)');
    // The file really moved into archive/daily/<week>/.
    await expect(fs.access(path.join(dailyDir(), name))).rejects.toBeDefined();
    const weeks = await fs.readdir(path.join(tmpDir, 'archive', 'daily'));
    expect(weeks).toHaveLength(1);
    await expect(
      fs.access(path.join(tmpDir, 'archive', 'daily', weeks[0], name)),
    ).resolves.toBeUndefined();
  });

  it('still claims successfully when the sweep hits errors', async () => {
    await writeOldDaily(20);
    // Make archive/ a FILE so the daily move fails (ENOTDIR) inside the sweep.
    await fs.writeFile(path.join(tmpDir, 'archive'), 'not a directory');

    const res = await claimTool().handler({ task: 'test task' });
    const text = textOf(res);

    expect(res.isError).toBeUndefined();
    expect(text).toContain('Workspace Claimed');
    expect(text).toContain('⚠ sweep hit 1 file error(s)');
    expect(text).toContain('.mcp/archive-status.json');
  });
});
