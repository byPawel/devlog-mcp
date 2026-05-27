import type Database from 'better-sqlite3';

/**
 * Idempotently add a summary_embedding BLOB column to conversation_summaries.
 * Stores the Float64-packed embedding of each summary for semantic recall.
 */
export function ensureEpisodicEmbeddingColumn(sqlite: Database.Database): void {
  const cols = sqlite
    .prepare(`PRAGMA table_info(conversation_summaries)`)
    .all() as Array<{ name: string }>;
  if (!cols.some((c) => c.name === 'summary_embedding')) {
    sqlite.prepare(`ALTER TABLE conversation_summaries ADD COLUMN summary_embedding BLOB`).run();
  }
}
