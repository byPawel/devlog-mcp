/**
 * T7: archive-aware plan reads + auto-archive on validate.
 *
 * DOKORO_PATH is captured at module import time, so each test points
 * process.env.DOKORO_PATH at a temp dir and loads a fresh plan-tools instance
 * via jest.isolateModules() (same pattern as src/utils/archive.test.ts).
 */

import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { jest } from '@jest/globals';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { monthDir } from '../utils/timestamp.js';

jest.mock('../db/index.js', () => ({
  getSqliteDb: () => { throw new Error('getSqliteDb should not be called in these tests'); },
}));

// Mock ESM-only modules that chalk/ink bring in and break ts-jest CJS transform
jest.mock('../utils/render-output.js', () => ({
  renderOutput: (data: unknown) => JSON.stringify(data),
}));
jest.mock('../utils/color-setup.js', () => ({}));

type PlanToolsModule = typeof import('./plan-tools.js');

let tmpDir: string;
let mod: PlanToolsModule;

function freshModule(): Promise<PlanToolsModule> {
  return new Promise<PlanToolsModule>((resolve) => {
    jest.isolateModules(() => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      resolve(require('./plan-tools.js') as PlanToolsModule);
    });
  });
}

const plansDir = (): string => path.join(tmpDir, '.mcp', 'plans');
const indexPath = (): string => path.join(plansDir(), 'index.json');

function getTool(name: string): PlanToolsModule['planTools'][number] {
  const tool = mod.planTools.find((t) => t.name === name);
  if (!tool) throw new Error(`tool not found: ${name}`);
  return tool;
}

function textOf(res: CallToolResult): string {
  return res.content.map((c) => ((c as { text?: string }).text ?? '')).join('\n');
}

interface PlanFile {
  id: string;
  title: string;
  items: Array<{ id: string; text: string; completed: boolean; created_at: string; completed_at?: string }>;
  created_at: string;
  updated_at: string;
  status: string;
  completion_percentage: number;
}

function makePlan(id: string, title: string, status: string, completed = true): PlanFile {
  const now = new Date().toISOString();
  return {
    id,
    title,
    items: [{ id: 'item-0', text: 'do the thing', completed, created_at: now, completed_at: completed ? now : undefined }],
    created_at: now,
    updated_at: now,
    status,
    completion_percentage: completed ? 100 : 0,
  };
}

async function readIndex(): Promise<Record<string, unknown>> {
  return JSON.parse(await fs.readFile(indexPath(), 'utf-8')) as Record<string, unknown>;
}

async function writeIndex(index: Record<string, unknown>): Promise<void> {
  await fs.writeFile(indexPath(), JSON.stringify(index, null, 2));
}

/** Write a LIVE plan file + bare-title index entry. */
async function writeLivePlan(plan: PlanFile): Promise<void> {
  await fs.writeFile(path.join(plansDir(), `${plan.id}.json`), JSON.stringify(plan, null, 2));
  const index = await fs.readFile(indexPath(), 'utf-8').then(
    (c) => JSON.parse(c) as Record<string, unknown>,
    () => ({}) as Record<string, unknown>,
  );
  index[plan.id] = plan.title;
  await writeIndex(index);
}

/** Write an ARCHIVED plan file + archived index entry (as archivePlan leaves them). */
async function writeArchivedPlan(plan: PlanFile, partition = '2026-01'): Promise<string> {
  const relPath = `archive/${partition}/${plan.id}.json`;
  await fs.mkdir(path.join(plansDir(), 'archive', partition), { recursive: true });
  await fs.writeFile(path.join(plansDir(), relPath), JSON.stringify(plan, null, 2));
  const index = await fs.readFile(indexPath(), 'utf-8').then(
    (c) => JSON.parse(c) as Record<string, unknown>,
    () => ({}) as Record<string, unknown>,
  );
  index[plan.id] = { title: plan.title, archived: true, archive_path: relPath };
  await writeIndex(index);
  return relPath;
}

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'dokoro-plan-archive-test-'));
  process.env['DOKORO_PATH'] = tmpDir;
  await fs.mkdir(plansDir(), { recursive: true });
  mod = await freshModule();
});

afterEach(async () => {
  delete process.env['DOKORO_PATH'];
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe('dokoro_plan_validate — auto-archive hook', () => {
  it('archives a fully-completed plan after validation and reports the archive path', async () => {
    await writeLivePlan(makePlan('plan-v', 'Validate Me', 'active'));

    const res = await getTool('dokoro_plan_validate').handler({ planId: 'plan-v' });
    const text = textOf(res);

    const expectedRel = `archive/${monthDir(new Date())}/plan-v.json`;
    expect(res.isError).toBeUndefined();
    expect(text).toContain('Plan archived to');
    expect(text).toContain(expectedRel);
    // File moved out of the live dir; index entry upgraded to archived metadata.
    await expect(fs.access(path.join(plansDir(), 'plan-v.json'))).rejects.toBeDefined();
    await expect(fs.access(path.join(plansDir(), expectedRel))).resolves.toBeUndefined();
    expect((await readIndex())['plan-v']).toMatchObject({ archived: true, archive_path: expectedRel });
  });

  it('does NOT archive a failed validation (requireComplete on an incomplete plan)', async () => {
    await writeLivePlan(makePlan('plan-f', 'Incomplete', 'active', false));

    const res = await getTool('dokoro_plan_validate').handler({ planId: 'plan-f', requireComplete: true });

    expect(textOf(res)).not.toContain('Plan archived to');
    await expect(fs.access(path.join(plansDir(), 'plan-f.json'))).resolves.toBeUndefined();
  });

  it('refuses to re-validate an archived plan', async () => {
    await writeArchivedPlan(makePlan('plan-a', 'Done Plan', 'validated'));

    const res = await getTool('dokoro_plan_validate').handler({ planId: 'plan-a' });

    expect(res.isError).toBe(true);
    expect(textOf(res)).toMatch(/archived and read-only/);
  });
});

describe('dokoro_plan_list — archived plans stay visible', () => {
  it('shows archived plans with an (archived) marker, after live plans', async () => {
    await writeArchivedPlan(makePlan('plan-a', 'Old Archived Plan', 'validated'));
    await writeLivePlan(makePlan('plan-b', 'Live Plan', 'active', false));

    const text = textOf(await getTool('dokoro_plan_list').handler({ status: 'all' }));

    expect(text).toContain('Old Archived Plan (archived)');
    expect(text).toContain('Live Plan');
    expect(text).not.toContain('Live Plan (archived)');
    // Live plans listed first, archived after.
    expect(text.indexOf('Live Plan')).toBeLessThan(text.indexOf('Old Archived Plan (archived)'));
  });

  it('still applies the status filter to archived plans', async () => {
    await writeArchivedPlan(makePlan('plan-a', 'Old Archived Plan', 'validated'));
    await writeLivePlan(makePlan('plan-b', 'Live Plan', 'active', false));

    const text = textOf(await getTool('dokoro_plan_list').handler({ status: 'validated' }));

    expect(text).toContain('Old Archived Plan (archived)');
    expect(text).not.toContain('Live Plan');
  });
});

describe('dokoro_plan_status — archive-aware read', () => {
  it('resolves an archived plan and marks it read-only', async () => {
    const relPath = await writeArchivedPlan(makePlan('plan-a', 'Old Archived Plan', 'validated'));

    const res = await getTool('dokoro_plan_status').handler({ planId: 'plan-a' });
    const text = textOf(res);

    expect(res.isError).toBeUndefined();
    expect(text).toContain('Old Archived Plan (archived)');
    expect(text).toContain(relPath);
    expect(text).toContain('read-only');
  });

  it('heals the crash window: stale string index entry but file only in the archive', async () => {
    await writeArchivedPlan(makePlan('plan-a', 'Crash Window Plan', 'validated'));
    // Simulate the crash: index still has the pre-archive bare-title entry.
    await writeIndex({ 'plan-a': 'Crash Window Plan' });

    const text = textOf(await getTool('dokoro_plan_status').handler({ planId: 'plan-a' }));

    expect(text).toContain('Crash Window Plan (archived)');
  });
});

describe('write tools on archived plans — read-only', () => {
  it('dokoro_plan_check returns isError with a clear message', async () => {
    const relPath = await writeArchivedPlan(makePlan('plan-a', 'Old Archived Plan', 'validated'));

    const res = await getTool('dokoro_plan_check').handler({ planId: 'plan-a', itemIndex: 1 });

    expect(res.isError).toBe(true);
    expect(textOf(res)).toContain(`Plan plan-a is archived and read-only`);
    expect(textOf(res)).toContain(relPath);
    // Nothing was written back to the archive.
    const archived = JSON.parse(await fs.readFile(path.join(plansDir(), relPath), 'utf-8')) as PlanFile;
    expect(archived.title).toBe('Old Archived Plan');
  });

  it('dokoro_plan_blocker returns isError', async () => {
    await writeArchivedPlan(makePlan('plan-a', 'Old Archived Plan', 'validated'));

    const res = await getTool('dokoro_plan_blocker').handler({ planId: 'plan-a', itemIndex: 1, blocker: 'nope' });

    expect(res.isError).toBe(true);
    expect(textOf(res)).toMatch(/archived and read-only/);
  });
});
