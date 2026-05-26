import Database from 'better-sqlite3';
import { ensureEntityTables } from '../db/entity-tables.js';
import { EntityPersistence } from './entity-extractor.js';

function seed(db: Database.Database) {
  ensureEntityTables(db);
  db.prepare(`INSERT INTO entities (id,type,name,canonical_name) VALUES
    (1,'file','auth','auth'),(2,'concept','jwt','jwt'),(3,'concept','oauth','oauth')`).run();
}

describe('EntityPersistence bi-temporal writes', () => {
  let db: Database.Database;
  beforeEach(() => { db = new Database(':memory:'); seed(db); });
  afterEach(() => db.close());

  it('closes the prior open window when a contradicting relation arrives', () => {
    const p = new EntityPersistence(db);
    p.upsertRelation(1, 2, 'uses', 1.0, '2026-01-01T00:00:00Z');
    p.upsertRelation(1, 3, 'uses', 1.0, '2026-05-01T00:00:00Z');
    const jwt = db.prepare(`SELECT valid_to FROM entity_relations WHERE source_id=1 AND target_id=2`).get() as { valid_to: string | null };
    const oauth = db.prepare(`SELECT valid_to FROM entity_relations WHERE source_id=1 AND target_id=3`).get() as { valid_to: string | null };
    expect(jwt.valid_to).toBe('2026-05-01T00:00:00Z');
    expect(oauth.valid_to).toBeNull();
  });

  it('re-asserting the same open fact is a no-op (single open row)', () => {
    const p = new EntityPersistence(db);
    p.upsertRelation(1, 2, 'uses', 1.0, '2026-01-01T00:00:00Z');
    p.upsertRelation(1, 2, 'uses', 1.0, '2026-02-01T00:00:00Z');
    const n = (db.prepare(`SELECT COUNT(*) c FROM entity_relations WHERE source_id=1 AND target_id=2 AND valid_to IS NULL`).get() as {c:number}).c;
    expect(n).toBe(1);
  });
});
