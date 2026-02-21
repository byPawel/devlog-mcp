import { EmbeddingCache } from './embedding-cache.js';
import Database from 'better-sqlite3';

describe('EmbeddingCache', () => {
  let db: Database.Database;
  let cache: EmbeddingCache;

  beforeEach(() => {
    db = new Database(':memory:');
    cache = new EmbeddingCache(db);
  });

  afterEach(() => db.close());

  test('returns null for cache miss', () => {
    expect(cache.get('nonexistent-hash')).toBeNull();
  });

  test('stores and retrieves embedding by content hash', () => {
    const hash = 'abc123';
    const embedding = [0.1, 0.2, 0.3];
    cache.set(hash, embedding, 42);

    const result = cache.get(hash);
    expect(result).not.toBeNull();
    expect(result!.embedding).toEqual(embedding);
    expect(result!.tokenCount).toBe(42);
  });

  test('evicts oldest entries when exceeding maxSize', () => {
    const smallCache = new EmbeddingCache(db, 2);
    smallCache.set('hash1', [0.1], 10);
    smallCache.set('hash2', [0.2], 20);
    smallCache.set('hash3', [0.3], 30);

    expect(smallCache.get('hash1')).toBeNull();
    expect(smallCache.get('hash2')).not.toBeNull();
    expect(smallCache.get('hash3')).not.toBeNull();
  });

  test('updates access time on get (LRU behavior)', () => {
    const smallCache = new EmbeddingCache(db, 2);
    smallCache.set('hash1', [0.1], 10);
    smallCache.set('hash2', [0.2], 20);

    smallCache.get('hash1');

    smallCache.set('hash3', [0.3], 30);

    expect(smallCache.get('hash1')).not.toBeNull();
    expect(smallCache.get('hash2')).toBeNull();
  });

  test('reports stats correctly', () => {
    cache.set('h1', [0.1], 10);
    cache.set('h2', [0.2], 20);
    const stats = cache.stats();
    expect(stats.entries).toBe(2);
    expect(stats.hits).toBeGreaterThanOrEqual(0);
  });
});
