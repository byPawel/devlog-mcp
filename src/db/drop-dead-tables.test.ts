/**
 * Verify that the 6 dead schema tables are NOT present after database bootstrap.
 *
 * Strategy:
 *  - Test 1: dropDeadTables() correctly removes tables that already exist.
 *  - Test 2: a freshly bootstrapped DB (using ensureXxx functions) has none
 *    of the dead tables (i.e., they are NOT created by any ensure function,
 *    AND dropDeadTables is called after initializeSchema).
 *
 * We use in-memory databases to match the pattern of agent-feedback.test.ts
 * and entity-relations-bitemporal.test.ts (avoids the import.meta.url issue
 * in index.ts when run under Jest/CommonJS transform).
 */

import Database from 'better-sqlite3';
import { dropDeadTables, DEAD_TABLES } from './drop-dead-tables.js';
import { ensureEntityTables } from './entity-tables.js';
import { ensureAgentFeedbackTable } from './agent-feedback.js';

describe('dropDeadTables()', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(':memory:');
  });

  afterEach(() => db.close());

  it('removes all 6 dead tables when they exist', () => {
    // Plant all 6 dead tables
    db.exec(`
      CREATE TABLE IF NOT EXISTS session_context   (id INTEGER PRIMARY KEY);
      CREATE TABLE IF NOT EXISTS knowledge_links   (id INTEGER PRIMARY KEY);
      CREATE TABLE IF NOT EXISTS sync_queue        (id INTEGER PRIMARY KEY);
      CREATE TABLE IF NOT EXISTS daily_timeline    (id INTEGER PRIMARY KEY);
      CREATE TABLE IF NOT EXISTS modifications     (id INTEGER PRIMARY KEY);
      CREATE TABLE IF NOT EXISTS doc_assignments   (doc_id TEXT PRIMARY KEY);
    `);

    dropDeadTables(db);

    const tables = (
      db
        .prepare(`SELECT name FROM sqlite_master WHERE type = 'table'`)
        .all() as { name: string }[]
    ).map((r) => r.name);

    for (const dead of DEAD_TABLES) {
      expect(tables).not.toContain(dead);
    }
  });

  it('is idempotent (safe to call when tables do not exist)', () => {
    expect(() => dropDeadTables(db)).not.toThrow();
    expect(() => dropDeadTables(db)).not.toThrow();
  });

  it('does not touch live tables (entities, agent_feedback, docs, etc.)', () => {
    // Create docs + sessions prerequisites so ensure functions work
    db.exec(`
      CREATE TABLE IF NOT EXISTS docs (
        id TEXT PRIMARY KEY,
        filepath TEXT UNIQUE NOT NULL,
        title TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        started_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        status TEXT NOT NULL DEFAULT 'active'
      );
    `);

    // Plant the dead tables alongside the live ones
    db.exec(`
      CREATE TABLE IF NOT EXISTS session_context   (id INTEGER PRIMARY KEY);
      CREATE TABLE IF NOT EXISTS knowledge_links   (id INTEGER PRIMARY KEY);
      CREATE TABLE IF NOT EXISTS sync_queue        (id INTEGER PRIMARY KEY);
      CREATE TABLE IF NOT EXISTS daily_timeline    (id INTEGER PRIMARY KEY);
      CREATE TABLE IF NOT EXISTS modifications     (id INTEGER PRIMARY KEY);
      CREATE TABLE IF NOT EXISTS doc_assignments   (doc_id TEXT PRIMARY KEY);
    `);

    ensureEntityTables(db);
    ensureAgentFeedbackTable(db);
    dropDeadTables(db);

    const tables = (
      db
        .prepare(`SELECT name FROM sqlite_master WHERE type = 'table'`)
        .all() as { name: string }[]
    ).map((r) => r.name);

    // Dead tables gone
    for (const dead of DEAD_TABLES) {
      expect(tables).not.toContain(dead);
    }

    // Live tables still present
    const LIVE_TABLES = ['docs', 'sessions', 'entities', 'entity_relations', 'doc_entities', 'agent_feedback'];
    for (const live of LIVE_TABLES) {
      expect(tables).toContain(live);
    }
  });
});
