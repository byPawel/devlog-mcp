/**
 * T7: dokoro_archive_sweep tool — dry run, normal sweep, status_only readout.
 *
 * DOKORO_PATH is captured at module import time, so each test points
 * process.env.DOKORO_PATH at a temp dir and loads a fresh archive-tools
 * instance via jest.isolateModules() (same pattern as src/utils/archive.test.ts).
 */

import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { jest } from '@jest/globals';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

jest.mock('../db/index.js', () => ({
  getSqliteDb: () => { throw new Error('getSqliteDb should not be called in these tests'); },
}));

type ArchiveToolsModule = typeof import('./archive-tools.js');

const MS_PER_DAY = 86_400_000;

let tmpDir: string;
let mod: ArchiveToolsModule;

function freshModule(): Promise<ArchiveToolsModule> {
  return new Promise<ArchiveToolsModule>((resolve) => {
    jest.isolateModules(() => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      resolve(require('./archive-tools.js') as ArchiveToolsModule);
    });
  });
}

function sweepTool(): ArchiveToolsModule['archiveTools'][number] {
  const tool = mod.archiveTools.find((t) => t.name === 'dokoro_archive_sweep');
  if (!tool) throw new Error('dokoro_archive_sweep not found');
  return tool;
}

function textOf(res: CallToolResult): string {
  return res.content.map((c) => ((c as { text?: string }).text ?? '')).join('\n');
}

const dailyDir = (): string => path.join(tmpDir, 'daily');
const statusPath = (): string => path.join(tmpDir, '.mcp', 'archive-status.json');

/** Daily file named with the real slug shape, dated `n` days ago (UTC). */
async function writeOldDaily(n: number, suffix = 'session'): Promise<string> {
  const stamp = new Date(Date.now() - n * MS_PER_DAY).toISOString().slice(0, 10);
  const name = `${stamp}-10h00-someday-${suffix}.md`;
  await fs.writeFile(path.join(dailyDir(), name), '# stub\n');
  return name;
}

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'dokoro-archive-tools-test-'));
  process.env['DOKORO_PATH'] = tmpDir;
  await fs.mkdir(dailyDir(), { recursive: true });
  mod = await freshModule();
});

afterEach(async () => {
  delete process.env['DOKORO_PATH'];
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe('dokoro_archive_sweep — dryRun', () => {
  it('shows the DRY RUN banner and would-move list without touching anything', async () => {
    const name = await writeOldDaily(20);

    const res = await sweepTool().handler({ dryRun: true });
    const text = textOf(res);

    expect(res.isError).toBeUndefined();
    expect(text).toContain('DRY RUN — nothing moved');
    expect(text).toContain('would move:** 1');
    expect(text).toContain(name);
    // Nothing actually moved, no status written for dry runs.
    await expect(fs.access(path.join(dailyDir(), name))).resolves.toBeUndefined();
    await expect(fs.access(statusPath())).rejects.toBeDefined();
  });
});

describe('dokoro_archive_sweep — normal sweep', () => {
  it('moves eligible files and reports counts + moved list', async () => {
    const name = await writeOldDaily(20);

    const res = await sweepTool().handler({});
    const text = textOf(res);

    expect(res.isError).toBeUndefined();
    expect(text).not.toContain('DRY RUN');
    expect(text).toContain('Daily files moved:** 1');
    expect(text).toContain(name);
    expect(text).toContain('Errors:** 0');
    await expect(fs.access(path.join(dailyDir(), name))).rejects.toBeDefined();
    // Status file written by the non-dry sweep.
    await expect(fs.access(statusPath())).resolves.toBeUndefined();
  });

  it('truncates long moved lists at 20 with "+N more"', async () => {
    for (let i = 0; i < 25; i++) {
      await writeOldDaily(20, `file-${String(i).padStart(2, '0')}`);
    }

    const text = textOf(await sweepTool().handler({}));

    expect(text).toContain('Daily files moved:** 25');
    expect(text).toContain('(+5 more)');
  });

  it('reports per-file errors and the status file last_error', async () => {
    await writeOldDaily(20);
    // archive/ as a FILE breaks the daily move (ENOTDIR) inside the sweep.
    await fs.writeFile(path.join(tmpDir, 'archive'), 'not a directory');

    const res = await sweepTool().handler({});
    const text = textOf(res);

    // Per-file errors do not fail the tool.
    expect(res.isError).toBeUndefined();
    expect(text).toContain('Errors:** 1');
    expect(text).toContain('Last error (from .mcp/archive-status.json):');
  });
});

describe('dokoro_archive_sweep — status_only', () => {
  it('reports when no sweep has run yet', async () => {
    const text = textOf(await sweepTool().handler({ status_only: true }));

    expect(text).toContain('No sweep has run yet');
  });

  it('pretty-prints the last run without sweeping', async () => {
    const moved = await writeOldDaily(20);
    await sweepTool().handler({});
    const untouched = await writeOldDaily(21, 'untouched');

    const text = textOf(await sweepTool().handler({ status_only: true }));

    expect(text).toContain('Archive Status (last sweep)');
    expect(text).toContain('Last run:');
    expect(text).toContain('Daily files moved:** 1');
    expect(text).toContain('Last error:** none');
    // status_only did NOT sweep: the second old file is still live.
    await expect(fs.access(path.join(dailyDir(), untouched))).resolves.toBeUndefined();
    await expect(fs.access(path.join(dailyDir(), moved))).rejects.toBeDefined();
  });
});
