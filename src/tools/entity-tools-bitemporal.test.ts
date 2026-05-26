import Database from 'better-sqlite3';
import { jest } from '@jest/globals';
import { ensureEntityTables } from '../db/entity-tables.js';

// Mock '../db/index.js' so importing entity-tools doesn't trigger evaluation
// of src/db/index.ts (which uses import.meta.url and trips ts-jest's CJS transform).
// In tests we always short-circuit through globalThis.__TEST_DB__, so the mock
// implementation is never called.
jest.mock('../db/index.js', () => ({
  getSqliteDb: () => { throw new Error('getSqliteDb should not be called in tests (use __TEST_DB__)'); },
}));

// Import after the mock is registered.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { entityTools } = require('./entity-tools.js') as typeof import('./entity-tools.js');

function findTool(name: string) {
  const t = entityTools.find((x) => x.name === name);
  if (!t) throw new Error(`tool ${name} not found`);
  return t;
}

function extractText(res: Awaited<ReturnType<(typeof entityTools)[number]['handler']>>): string {
  const first = res.content?.[0];
  if (!first || first.type !== 'text') return '';
  return first.text;
}

describe('devlog_entity_graph bi-temporal filtering', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(':memory:');
    ensureEntityTables(db);

    // Three entities: alice (1), phoenix (2), titan (3), atlas (4)
    db.prepare(`INSERT INTO entities (id, type, name, canonical_name) VALUES (1, 'person', 'alice', 'alice')`).run();
    db.prepare(`INSERT INTO entities (id, type, name, canonical_name) VALUES (2, 'project', 'phoenix', 'phoenix')`).run();
    db.prepare(`INSERT INTO entities (id, type, name, canonical_name) VALUES (3, 'project', 'titan', 'titan')`).run();
    db.prepare(`INSERT INTO entities (id, type, name, canonical_name) VALUES (4, 'project', 'atlas', 'atlas')`).run();

    // Three relations from alice (1), each exercising a different validity window:
    //   alice -[works_on]-> phoenix  : OPEN now (valid_from 2025-01-01, valid_to NULL)
    //   alice -[worked_on]-> titan   : HISTORICAL (valid_from 2024-01-01, valid_to 2024-12-31)
    //   alice -[will_work_on]-> atlas: FUTURE     (valid_from 2027-01-01, valid_to NULL)
    const insert = db.prepare(`
      INSERT INTO entity_relations
        (source_id, target_id, relation_type, weight, valid_from, valid_to)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    insert.run(1, 2, 'works_on',     1.0, '2025-01-01T00:00:00Z', null);
    insert.run(1, 3, 'worked_on',    1.0, '2024-01-01T00:00:00Z', '2024-12-31T23:59:59Z');
    insert.run(1, 4, 'will_work_on', 1.0, '2027-01-01T00:00:00Z', null);

    (globalThis as Record<string, unknown>).__TEST_DB__ = db;
  });

  afterEach(() => {
    db.close();
    delete (globalThis as Record<string, unknown>).__TEST_DB__;
  });

  it('default (no as_of): returns only the currently-open fact (valid_from in past, valid_to NULL)', async () => {
    const tool = findTool('devlog_entity_graph');
    const res = await tool.handler({ entityId: 1, depth: 2 });
    expect(res.isError).toBeFalsy();
    const text = extractText(res);
    expect(text).toMatch(/works_on/);
    expect(text).not.toMatch(/worked_on/);
    expect(text).not.toMatch(/will_work_on/);
  });

  it('as_of in 2024: returns only the historical closed fact (open at that time)', async () => {
    const tool = findTool('devlog_entity_graph');
    const res = await tool.handler({ entityId: 1, depth: 2, as_of: '2024-06-01T00:00:00Z' });
    expect(res.isError).toBeFalsy();
    const text = extractText(res);
    expect(text).toMatch(/worked_on/);
    expect(text).not.toMatch(/works_on[^_]/); // works_on (the open fact) hadn't started yet
    expect(text).not.toMatch(/will_work_on/);
  });

  it('as_of in 2025: returns only the open fact (historical closed; future not yet started)', async () => {
    const tool = findTool('devlog_entity_graph');
    const res = await tool.handler({ entityId: 1, depth: 2, as_of: '2025-06-01T00:00:00Z' });
    expect(res.isError).toBeFalsy();
    const text = extractText(res);
    expect(text).toMatch(/works_on/);
    expect(text).not.toMatch(/worked_on/);
    expect(text).not.toMatch(/will_work_on/);
  });

  // BUG-6: as_of with milliseconds should be normalized and still match stored Z timestamps
  it('BUG-6: as_of WITH milliseconds normalizes correctly and returns the open relation', async () => {
    const tool = findTool('devlog_entity_graph');
    // Pass as_of with explicit milliseconds — before the fix this could mis-sort
    // against the millisecond-free stored values like '2025-01-01T00:00:00Z'.
    const res = await tool.handler({ entityId: 1, depth: 2, as_of: '2026-06-01T00:00:00.000Z' });
    expect(res.isError).toBeFalsy();
    const text = extractText(res);
    // The open relation (works_on, valid_from 2025-01-01Z) must be visible
    expect(text).toMatch(/works_on/);
    // Historical and future relations must NOT appear
    expect(text).not.toMatch(/worked_on/);
    expect(text).not.toMatch(/will_work_on/);
  });
});

describe('devlog_entity_graph cycle traversal (BUG-14)', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(':memory:');
    ensureEntityTables(db);

    // Four entities: A(1), B(2), C(3)
    db.prepare(`INSERT INTO entities (id, type, name, canonical_name) VALUES (1, 'concept', 'A', 'a')`).run();
    db.prepare(`INSERT INTO entities (id, type, name, canonical_name) VALUES (2, 'concept', 'B', 'b')`).run();
    db.prepare(`INSERT INTO entities (id, type, name, canonical_name) VALUES (3, 'concept', 'C', 'c')`).run();

    // Cycle: A→B, B→C, C→A — all open (valid_from past, valid_to NULL)
    const insert = db.prepare(`
      INSERT INTO entity_relations
        (source_id, target_id, relation_type, weight, valid_from, valid_to)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    insert.run(1, 2, 'a_to_b', 1.0, '2025-01-01T00:00:00Z', null);
    insert.run(2, 3, 'b_to_c', 1.0, '2025-01-01T00:00:00Z', null);
    insert.run(3, 1, 'c_to_a', 1.0, '2025-01-01T00:00:00Z', null);

    (globalThis as Record<string, unknown>).__TEST_DB__ = db;
  });

  afterEach(() => {
    db.close();
    delete (globalThis as Record<string, unknown>).__TEST_DB__;
  });

  // BUG-14: UNION ALL allows traversal through cyclic graphs up to depth limit;
  // the old UNION deduplication could prune valid deeper paths.
  it('BUG-14: depth-3 traversal through a cycle A→B→C→A returns all three relations', async () => {
    const tool = findTool('devlog_entity_graph');
    const res = await tool.handler({ entityId: 1, depth: 3 });
    expect(res.isError).toBeFalsy();
    const text = extractText(res);
    // All three edges in the cycle must be reachable from A at depth 3
    expect(text).toMatch(/a_to_b/);
    expect(text).toMatch(/b_to_c/);
    expect(text).toMatch(/c_to_a/);
  });
});
