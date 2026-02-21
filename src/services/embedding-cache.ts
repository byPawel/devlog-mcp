/**
 * LRU Embedding Cache with SQLite Persistence
 *
 * Caches embeddings keyed by content hash to eliminate redundant
 * Ollama API calls. Uses a SQLite-backed LRU eviction strategy
 * with configurable max size.
 */

import Database from 'better-sqlite3';

export interface CachedEmbedding {
  embedding: number[];
  tokenCount: number;
}

export interface CacheStats {
  entries: number;
  hits: number;
  misses: number;
}

const DEFAULT_MAX_SIZE = 10_000;

export class EmbeddingCache {
  private db: Database.Database;
  private maxSize: number;
  private hitCount = 0;
  private missCount = 0;
  private accessCounter = 0;

  constructor(db: Database.Database, maxSize = DEFAULT_MAX_SIZE) {
    this.db = db;
    this.maxSize = maxSize;
    this.initTable();
    this.initAccessCounter();
  }

  private initTable(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS embedding_cache (
        content_hash TEXT PRIMARY KEY,
        embedding BLOB NOT NULL,
        token_count INTEGER NOT NULL,
        last_accessed INTEGER NOT NULL
      )
    `);
  }

  private initAccessCounter(): void {
    const row = this.db.prepare(
      'SELECT MAX(last_accessed) as max_val FROM embedding_cache'
    ).get() as { max_val: number | null };
    this.accessCounter = (row.max_val ?? 0) + 1;
  }

  private nextAccess(): number {
    return this.accessCounter++;
  }

  get(contentHash: string): CachedEmbedding | null {
    const row = this.db.prepare(
      'SELECT embedding, token_count FROM embedding_cache WHERE content_hash = ?'
    ).get(contentHash) as { embedding: Buffer; token_count: number } | undefined;

    if (!row) {
      this.missCount++;
      return null;
    }

    // Update last_accessed counter for LRU tracking
    this.db.prepare(
      'UPDATE embedding_cache SET last_accessed = ? WHERE content_hash = ?'
    ).run(this.nextAccess(), contentHash);

    this.hitCount++;

    // Decode Float64Array from BLOB
    const float64 = new Float64Array(row.embedding.buffer, row.embedding.byteOffset, row.embedding.byteLength / 8);
    return {
      embedding: Array.from(float64),
      tokenCount: row.token_count,
    };
  }

  set(contentHash: string, embedding: number[], tokenCount: number): void {
    // Encode embedding as Float64Array BLOB
    const float64 = new Float64Array(embedding);
    const buffer = Buffer.from(float64.buffer);

    this.db.prepare(`
      INSERT OR REPLACE INTO embedding_cache (content_hash, embedding, token_count, last_accessed)
      VALUES (?, ?, ?, ?)
    `).run(contentHash, buffer, tokenCount, this.nextAccess());

    this.evict();
  }

  stats(): CacheStats {
    const row = this.db.prepare(
      'SELECT COUNT(*) as count FROM embedding_cache'
    ).get() as { count: number };

    return {
      entries: row.count,
      hits: this.hitCount,
      misses: this.missCount,
    };
  }

  private evict(): void {
    const row = this.db.prepare(
      'SELECT COUNT(*) as count FROM embedding_cache'
    ).get() as { count: number };

    if (row.count > this.maxSize) {
      const excess = row.count - this.maxSize;
      this.db.prepare(`
        DELETE FROM embedding_cache
        WHERE content_hash IN (
          SELECT content_hash FROM embedding_cache
          ORDER BY last_accessed ASC
          LIMIT ?
        )
      `).run(excess);
    }
  }
}
