/**
 * Tests for context-inspect-tools.
 *
 * Strategy: DOKORO_PATH is captured into a module-level constant at import time
 * in context-inspect-tools.ts (via ../shared/dokoro-utils.js). So we set
 * process.env.DOKORO_PATH to a fresh temp dir, then load a fresh module
 * instance via jest.isolateModules() so its STORE_DIR points at the temp dir.
 * This isolates all reads/writes to the temp dir; the real dokoro folder is
 * never touched.
 */

import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';

type ContextInspectTools = typeof import('./context-inspect-tools.js');

let tmpDir: string;
let mod: ContextInspectTools;

function freshModule(): Promise<ContextInspectTools> {
  return new Promise<ContextInspectTools>((resolve) => {
    jest.isolateModules(() => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      resolve(require('./context-inspect-tools.js') as ContextInspectTools);
    });
  });
}

function findTool(name: string) {
  const t = mod.contextInspectTools.find((x) => x.name === name);
  if (!t) throw new Error(`tool ${name} not found`);
  return t;
}

function textOf(res: { content?: Array<{ type: string; text?: string }> }): string {
  return res.content?.[0]?.type === 'text' ? (res.content[0].text ?? '') : '';
}

interface MakeEventOpts {
  timestamp?: string;
  turn?: number;
  sessionId?: string;
  reason?: string;
  snippet?: string;
  source?: string;
  event?: string;
}

function makeEvent(opts: MakeEventOpts = {}): Record<string, unknown> {
  return {
    event: opts.event ?? 'context_inspect',
    sessionId: opts.sessionId ?? 'sess-1',
    turn: opts.turn ?? 1,
    timestamp: opts.timestamp ?? '2026-06-08T15:30:22.528Z',
    budgetTokens: 8000,
    totalEstimate: 1234,
    layers: [
      {
        name: 'working',
        reason: opts.reason ?? 'recent turns',
        score: 0.9,
        tokenEstimate: 200,
        source: opts.source ?? 'working-memory',
        contentSnippet: opts.snippet ?? 'hello world snippet',
      },
    ],
    dropped: [{ source: 'old-thing', reason: 'over budget', score: 0.1, tokenEstimate: 50 }],
  };
}

describe('context-inspect-tools', () => {
  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'dokoro-ctxinspect-test-'));
    process.env['DOKORO_PATH'] = tmpDir;
    mod = await freshModule();
  });

  afterEach(async () => {
    delete process.env['DOKORO_PATH'];
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('log writes a valid JSONL line that round-trips', async () => {
    const event = makeEvent();
    const res = await findTool('dokoro_context_log').handler({ event });
    expect(res.isError).toBeFalsy();

    const file = path.join(tmpDir, 'context-inspect', '2026-06-08.jsonl');
    const raw = await fs.readFile(file, 'utf-8');
    const lines = raw.split('\n').filter((l) => l.trim());
    expect(lines).toHaveLength(1);

    const parsed = JSON.parse(lines[0]);
    expect(parsed.event).toBe('context_inspect');
    expect(parsed.sessionId).toBe('sess-1');
    expect(parsed.turn).toBe(1);
    expect(parsed.totalEstimate).toBe(1234);
    expect(parsed.layers[0].reason).toBe('recent turns');
    expect(parsed.layers[0].contentSnippet).toBe('hello world snippet');
  });

  it('log rejects a non-context_inspect event with isError', async () => {
    const event = makeEvent({ event: 'something_else' });
    const res = await findTool('dokoro_context_log').handler({ event });
    expect(res.isError).toBe(true);
    expect(textOf(res)).toMatch(/not a context_inspect event/i);

    // Nothing should be written.
    const dir = path.join(tmpDir, 'context-inspect');
    const exists = await fs
      .access(dir)
      .then(() => true)
      .catch(() => false);
    if (exists) {
      const files = await fs.readdir(dir);
      expect(files).toHaveLength(0);
    }
  });

  it('truncates a contentSnippet longer than 500 chars on log', async () => {
    const long = 'x'.repeat(1000);
    const event = makeEvent({ snippet: long });
    const res = await findTool('dokoro_context_log').handler({ event });
    expect(res.isError).toBeFalsy();

    const file = path.join(tmpDir, 'context-inspect', '2026-06-08.jsonl');
    const raw = await fs.readFile(file, 'utf-8');
    const parsed = JSON.parse(raw.trim());
    expect(parsed.layers[0].contentSnippet.length).toBe(500);
  });

  it('last returns the newest N events in newest-first order', async () => {
    const log = findTool('dokoro_context_log');
    // Two different dates, three events total.
    await log.handler({ event: makeEvent({ turn: 1, timestamp: '2026-06-07T10:00:00.000Z' }) });
    await log.handler({ event: makeEvent({ turn: 2, timestamp: '2026-06-08T10:00:00.000Z' }) });
    await log.handler({ event: makeEvent({ turn: 3, timestamp: '2026-06-08T11:00:00.000Z' }) });

    const res = await findTool('dokoro_context_last').handler({ limit: 2 });
    expect(res.isError).toBeFalsy();
    const events = JSON.parse(textOf(res)) as Array<{ turn: number }>;
    expect(events).toHaveLength(2);
    expect(events[0].turn).toBe(3); // newest first
    expect(events[1].turn).toBe(2);
  });

  it('last returns a clear message when there are no events', async () => {
    const res = await findTool('dokoro_context_last').handler({});
    expect(res.isError).toBeFalsy();
    expect(textOf(res)).toMatch(/no context events/i);
  });

  it('search finds events by a term in a layer reason and respects limit', async () => {
    const log = findTool('dokoro_context_log');
    await log.handler({
      event: makeEvent({ turn: 1, timestamp: '2026-06-08T10:00:00.000Z', reason: 'special-needle here' }),
    });
    await log.handler({
      event: makeEvent({ turn: 2, timestamp: '2026-06-08T11:00:00.000Z', reason: 'special-needle again' }),
    });
    await log.handler({
      event: makeEvent({ turn: 3, timestamp: '2026-06-08T12:00:00.000Z', reason: 'unrelated' }),
    });

    const res = await findTool('dokoro_context_search').handler({ query: 'SPECIAL-NEEDLE' });
    expect(res.isError).toBeFalsy();
    const matches = JSON.parse(textOf(res)) as Array<{ turn: number }>;
    expect(matches).toHaveLength(2);
    // newest match first
    expect(matches[0].turn).toBe(2);
    expect(matches[1].turn).toBe(1);

    const limited = await findTool('dokoro_context_search').handler({ query: 'special-needle', limit: 1 });
    const limitedMatches = JSON.parse(textOf(limited)) as Array<{ turn: number }>;
    expect(limitedMatches).toHaveLength(1);
    expect(limitedMatches[0].turn).toBe(2);
  });

  it('search finds events by a term in a contentSnippet', async () => {
    const log = findTool('dokoro_context_log');
    await log.handler({ event: makeEvent({ snippet: 'the quick brown fox' }) });
    const res = await findTool('dokoro_context_search').handler({ query: 'brown fox' });
    const matches = JSON.parse(textOf(res)) as unknown[];
    expect(matches).toHaveLength(1);
  });

  it('log with a calendar-invalid timestamp falls back to the current UTC date file', async () => {
    const today = new Date().toISOString().slice(0, 10);
    const event = makeEvent({ turn: 42, timestamp: '2026-13-99T00:00:00.000Z' });
    const res = await findTool('dokoro_context_log').handler({ event });
    expect(res.isError).toBeFalsy();

    const dir = path.join(tmpDir, 'context-inspect');
    const files = await fs.readdir(dir);
    // The bad date must NOT become a file; it lands in today's file instead.
    expect(files).not.toContain('2026-13-99.jsonl');
    expect(files).toContain(`${today}.jsonl`);

    // And the event is retrievable via last.
    const last = await findTool('dokoro_context_last').handler({});
    const events = JSON.parse(textOf(last)) as Array<{ turn: number }>;
    expect(events[0].turn).toBe(42);
  });

  it('last and search skip malformed lines without throwing', async () => {
    // Write a file by hand mixing valid and malformed JSONL lines.
    const dir = path.join(tmpDir, 'context-inspect');
    await fs.mkdir(dir, { recursive: true });
    const valid = JSON.stringify(makeEvent({ turn: 9, timestamp: '2026-06-08T09:00:00.000Z', reason: 'findme' }));
    const file = path.join(dir, '2026-06-08.jsonl');
    await fs.writeFile(file, ['{ not json', '', '   ', valid, 'also not json'].join('\n') + '\n', 'utf-8');

    const last = await findTool('dokoro_context_last').handler({});
    expect(last.isError).toBeFalsy();
    const lastEvents = JSON.parse(textOf(last)) as Array<{ turn: number }>;
    expect(lastEvents).toHaveLength(1);
    expect(lastEvents[0].turn).toBe(9);

    const search = await findTool('dokoro_context_search').handler({ query: 'findme' });
    expect(search.isError).toBeFalsy();
    const searchEvents = JSON.parse(textOf(search)) as unknown[];
    expect(searchEvents).toHaveLength(1);
  });
});
