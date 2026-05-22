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
    db.prepare(`INSERT INTO entities (id, type, name) VALUES (1, 'person', 'alice')`).run();
    db.prepare(`INSERT INTO entities (id, type, name) VALUES (2, 'project', 'phoenix')`).run();
    db.prepare(`INSERT INTO entities (id, type, name) VALUES (3, 'project', 'titan')`).run();
    db.prepare(`INSERT INTO entities (id, type, name) VALUES (4, 'project', 'atlas')`).run();

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
});
