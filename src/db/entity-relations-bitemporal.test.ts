import Database from 'better-sqlite3';
import { ensureEntityTables } from './entity-tables.js';

describe('bi-temporal entity_relations', () => {
  let db: Database.Database;
  beforeEach(() => {
    db = new Database(':memory:');
    ensureEntityTables(db);
    db.prepare(`INSERT INTO entities (id, type, name, canonical_name) VALUES (1, 'person', 'alice', 'alice')`).run();
    db.prepare(`INSERT INTO entities (id, type, name, canonical_name) VALUES (2, 'project', 'phoenix', 'phoenix')`).run();
  });
  afterEach(() => db.close());

  it('stores valid_from / valid_to', () => {
    db.prepare(`
      INSERT INTO entity_relations
        (source_id, target_id, relation_type, weight, valid_from, valid_to)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(1, 2, 'works_on', 1.0, '2026-01-01T00:00:00Z', null);
    const row = db.prepare(
      `SELECT valid_from, valid_to FROM entity_relations WHERE source_id = 1`
    ).get() as { valid_from: string; valid_to: string | null };
    expect(row.valid_from).toBe('2026-01-01T00:00:00Z');
    expect(row.valid_to).toBeNull();
  });

  it('invalidating a fact sets valid_to instead of deleting', () => {
    db.prepare(`
      INSERT INTO entity_relations
        (source_id, target_id, relation_type, valid_from, valid_to)
      VALUES (?, ?, ?, ?, ?)
    `).run(1, 2, 'works_on', '2026-01-01T00:00:00Z', null);

    db.prepare(`
      UPDATE entity_relations
      SET valid_to = ?
      WHERE source_id = 1 AND target_id = 2 AND relation_type = 'works_on' AND valid_to IS NULL
    `).run('2026-05-22T00:00:00Z');

    const open = db.prepare(
      `SELECT COUNT(*) AS n FROM entity_relations
       WHERE source_id = 1 AND target_id = 2 AND valid_to IS NULL`
    ).get() as { n: number };
    expect(open.n).toBe(0);

    const all = db.prepare(`SELECT COUNT(*) AS n FROM entity_relations`).get() as { n: number };
    expect(all.n).toBe(1);
  });
});
