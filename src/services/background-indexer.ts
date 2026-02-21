/**
 * Background Indexer
 *
 * Runs after server start, health-checks Ollama, and indexes
 * unindexed or changed documents sequentially.
 */

import Database from 'better-sqlite3';
import { createVectorServices } from './vector-service.js';

const STARTUP_DELAY_MS = 5000;

interface DocRow {
  id: string;
  title: string;
  content: string | null;
}

export function startBackgroundIndexer(sqliteDb: Database.Database, projectPath: string): void {
  setTimeout(async () => {
    try {
      const { indexingService, embeddingService } = createVectorServices(sqliteDb, projectPath);

      // Health check Ollama
      const healthy = await embeddingService.healthCheck();
      if (!healthy) {
        console.error('[BackgroundIndexer] Ollama not available, skipping indexing');
        return;
      }

      console.error('[BackgroundIndexer] Ollama available, starting indexing...');

      // Find all docs with content
      const docs = sqliteDb.prepare(
        'SELECT id, title, content FROM docs WHERE content IS NOT NULL AND content != \'\''
      ).all() as DocRow[];

      let indexed = 0;
      let skipped = 0;

      for (const doc of docs) {
        if (!doc.content) continue;

        if (indexingService.needsReindex(doc.id, doc.content)) {
          try {
            await indexingService.indexDocument(doc.id, doc.content, doc.title);
            indexed++;
          } catch (err) {
            console.error(`[BackgroundIndexer] Failed to index ${doc.id}:`, err);
          }
        } else {
          skipped++;
        }
      }

      const stats = indexingService.getStats();
      console.error(
        `[BackgroundIndexer] Done: ${indexed} indexed, ${skipped} skipped. ` +
        `Total: ${stats.indexed} docs, ${stats.totalChunks} chunks, ${stats.totalTokens} tokens`
      );
    } catch (err) {
      console.error('[BackgroundIndexer] Error:', err);
    }
  }, STARTUP_DELAY_MS);
}
