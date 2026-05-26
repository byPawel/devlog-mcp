/**
 * Dead-schema cleanup migration.
 *
 * These six tables were defined in the original schema.sql but never
 * referenced by any live production code. They are dropped on startup
 * (idempotent: DROP TABLE IF EXISTS) so that existing databases do not
 * carry the unused tables.
 */

import Database from 'better-sqlite3';

const DEAD_TABLES = [
  'session_context',
  'knowledge_links',
  'sync_queue',
  'daily_timeline',
  'modifications',
  'doc_assignments',
] as const;

/**
 * Drop the 6 schema tables that were never used in production code.
 * Safe to call multiple times — uses IF EXISTS.
 */
export function dropDeadTables(sqlite: Database.Database): void {
  for (const t of DEAD_TABLES) {
    sqlite.prepare(`DROP TABLE IF EXISTS ${t}`).run();
  }
}

export { DEAD_TABLES };
