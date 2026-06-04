# YC-Ready Competitive Improvements Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Close the 6 critical gaps identified by multi-model judge council (Grok, Kimi, Qwen, GPT-5.2) comparing devlog-mcp against OpenClaw's memory system, making devlog-mcp YC-defensible.

**Architecture:** Add an LRU embedding cache layer, replace fixed chunking with line-aware sliding windows, add auto-compaction triggers with pre-flush durability, collapse 5 MCP servers into a single-binary starter mode, build a Markdown/OpenClaw importer, and add ambient git-aware context surfacing.

**Tech Stack:** TypeScript, better-sqlite3, Drizzle ORM, LanceDB, Ollama, Node.js crypto

**Security Note:** All shell commands use `execFileSync`/`execFileNoThrow` (not `exec`/`execSync`) to prevent command injection. See `src/utils/execFileNoThrow.ts`.

---

## Task 1: LRU Embedding Cache

Eliminate redundant Ollama calls across restarts. OpenClaw caches embeddings persistently with delta-sync; we currently recompute on every restart if the vector store is missing.

**Files:**
- Create: `src/services/embedding-cache.ts`
- Modify: `src/services/vector-service.ts:89-154` (EmbeddingService class)
- Test: `src/services/embedding-cache.test.ts`

**Step 1: Write the failing test**

```typescript
// src/services/embedding-cache.test.ts
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
    smallCache.set('hash3', [0.3], 30); // should evict hash1

    expect(smallCache.get('hash1')).toBeNull();
    expect(smallCache.get('hash2')).not.toBeNull();
    expect(smallCache.get('hash3')).not.toBeNull();
  });

  test('updates access time on get (LRU behavior)', () => {
    const smallCache = new EmbeddingCache(db, 2);
    smallCache.set('hash1', [0.1], 10);
    smallCache.set('hash2', [0.2], 20);

    // Access hash1 to make it recently used
    smallCache.get('hash1');

    // Insert hash3 - should evict hash2 (least recently used), not hash1
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
```

**Step 2: Run test to verify it fails**

Run: `npx jest src/services/embedding-cache.test.ts -v`
Expected: FAIL with "Cannot find module './embedding-cache.js'"

**Step 3: Write minimal implementation**

```typescript
// src/services/embedding-cache.ts
/**
 * LRU Embedding Cache backed by SQLite
 *
 * Persists embeddings across restarts to avoid redundant Ollama calls.
 * Uses SHA-256 content hash as key, LRU eviction when maxSize exceeded.
 */
import Database from 'better-sqlite3';

interface CacheEntry {
  embedding: number[];
  tokenCount: number;
}

export class EmbeddingCache {
  private db: Database.Database;
  private maxSize: number;
  private hitCount = 0;
  private missCount = 0;

  constructor(db: Database.Database, maxSize = 10000) {
    this.db = db;
    this.maxSize = maxSize;
    this.init();
  }

  private init(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS embedding_cache (
        content_hash TEXT PRIMARY KEY,
        embedding BLOB NOT NULL,
        token_count INTEGER NOT NULL,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        last_accessed TEXT DEFAULT CURRENT_TIMESTAMP
      )
    `);
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_cache_lru ON embedding_cache(last_accessed)
    `);
  }

  get(contentHash: string): CacheEntry | null {
    const row = this.db.prepare(
      'SELECT embedding, token_count FROM embedding_cache WHERE content_hash = ?'
    ).get(contentHash) as { embedding: Buffer; token_count: number } | undefined;

    if (!row) {
      this.missCount++;
      return null;
    }

    // Update last_accessed for LRU
    this.db.prepare(
      'UPDATE embedding_cache SET last_accessed = CURRENT_TIMESTAMP WHERE content_hash = ?'
    ).run(contentHash);

    this.hitCount++;
    return {
      embedding: Array.from(new Float64Array(row.embedding.buffer, row.embedding.byteOffset, row.embedding.byteLength / 8)),
      tokenCount: row.token_count,
    };
  }

  set(contentHash: string, embedding: number[], tokenCount: number): void {
    const blob = Buffer.from(new Float64Array(embedding).buffer);

    this.db.prepare(`
      INSERT OR REPLACE INTO embedding_cache (content_hash, embedding, token_count, last_accessed)
      VALUES (?, ?, ?, CURRENT_TIMESTAMP)
    `).run(contentHash, blob, tokenCount);

    this.evictIfNeeded();
  }

  private evictIfNeeded(): void {
    const count = (this.db.prepare('SELECT COUNT(*) as cnt FROM embedding_cache').get() as { cnt: number }).cnt;
    if (count > this.maxSize) {
      const excess = count - this.maxSize;
      this.db.prepare(`
        DELETE FROM embedding_cache WHERE content_hash IN (
          SELECT content_hash FROM embedding_cache ORDER BY last_accessed ASC LIMIT ?
        )
      `).run(excess);
    }
  }

  stats(): { entries: number; hits: number; misses: number; hitRate: number } {
    const { cnt } = this.db.prepare('SELECT COUNT(*) as cnt FROM embedding_cache').get() as { cnt: number };
    const total = this.hitCount + this.missCount;
    return {
      entries: cnt,
      hits: this.hitCount,
      misses: this.missCount,
      hitRate: total > 0 ? this.hitCount / total : 0,
    };
  }

  clear(): void {
    this.db.prepare('DELETE FROM embedding_cache').run();
    this.hitCount = 0;
    this.missCount = 0;
  }
}
```

**Step 4: Run test to verify it passes**

Run: `npx jest src/services/embedding-cache.test.ts -v`
Expected: PASS (all 5 tests)

**Step 5: Integrate cache into EmbeddingService**

Modify `src/services/vector-service.ts` EmbeddingService class:
- Add `cache?: EmbeddingCache` constructor param
- In `embed()`: compute SHA-256 of text, check cache first, store on miss
- In `embedBatch()`: use cache for each item

**Step 6: Commit**

```bash
git add src/services/embedding-cache.ts src/services/embedding-cache.test.ts src/services/vector-service.ts
git commit -m "feat: add LRU embedding cache with SQLite persistence"
```

---

## Task 2: Line-Aware Sliding Window Chunking

Replace fixed 4k character chunks with semantic-boundary-aware sliding windows. OpenClaw uses ~400 tokens with 80-token overlap and line-aware splitting. We'll use 512-token windows with 128-token overlap and markdown header awareness.

**Files:**
- Modify: `src/services/vector-service.ts:160-246` (ChunkingService class)
- Test: `src/services/chunking.test.ts`

**Step 1: Write the failing test**

```typescript
// src/services/chunking.test.ts
import { ChunkingService } from './vector-service.js';

describe('ChunkingService - Line-Aware Sliding Windows', () => {
  let chunker: ChunkingService;

  beforeEach(() => {
    chunker = new ChunkingService();
  });

  test('small doc returns single chunk', () => {
    const content = '# Title\n\nShort content here.';
    const chunks = chunker.chunk(content, 'doc1');
    expect(chunks).toHaveLength(1);
    expect(chunks[0].text).toBe(content);
  });

  test('chunks split at line boundaries, not mid-line', () => {
    // Create content that forces multiple chunks (~3000 chars = ~750 tokens)
    const lines = Array.from({ length: 80 }, (_, i) => `Line ${i}: ${'x'.repeat(35)}`);
    const content = lines.join('\n');
    const chunks = chunker.chunk(content, 'doc2');

    expect(chunks.length).toBeGreaterThan(1);

    // Every chunk should end at a line boundary (ends with \n or is last chunk)
    for (const chunk of chunks.slice(0, -1)) {
      expect(chunk.text.endsWith('\n')).toBe(true);
    }
  });

  test('chunks have overlap', () => {
    const lines = Array.from({ length: 80 }, (_, i) => `Line ${i}: ${'x'.repeat(35)}`);
    const content = lines.join('\n');
    const chunks = chunker.chunk(content, 'doc3');

    if (chunks.length >= 2) {
      // Last lines of chunk N should appear in first lines of chunk N+1
      const chunk0Lines = chunks[0].text.split('\n');
      const chunk1Lines = chunks[1].text.split('\n');
      const overlap = chunk0Lines.filter(l => chunk1Lines.includes(l));
      expect(overlap.length).toBeGreaterThan(0);
    }
  });

  test('preserves markdown header context per chunk', () => {
    const content = [
      '# Main Title',
      '',
      'Intro text.',
      '',
      '## Section A',
      '',
      ...Array.from({ length: 60 }, (_, i) => `A content ${i}: ${'y'.repeat(30)}`),
      '',
      '## Section B',
      '',
      ...Array.from({ length: 60 }, (_, i) => `B content ${i}: ${'z'.repeat(30)}`),
    ].join('\n');

    const chunks = chunker.chunk(content, 'doc4');
    expect(chunks.length).toBeGreaterThan(1);

    // Later chunks should have header context
    const lastChunk = chunks[chunks.length - 1];
    expect(lastChunk.headerContext).toBeTruthy();
  });

  test('chunk token counts are within expected range', () => {
    const lines = Array.from({ length: 200 }, (_, i) => `Line ${i}: ${'x'.repeat(35)}`);
    const content = lines.join('\n');
    const chunks = chunker.chunk(content, 'doc5');

    // Non-final chunks should be roughly 512 tokens (2048 chars) +/- line boundary adjustment
    for (const chunk of chunks.slice(0, -1)) {
      expect(chunk.tokenCount).toBeLessThanOrEqual(700); // Allow line boundary overshoot
      expect(chunk.tokenCount).toBeGreaterThan(200);
    }
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx jest src/services/chunking.test.ts -v`
Expected: FAIL (chunks too large, no line-boundary splitting)

**Step 3: Rewrite ChunkingService**

Replace the ChunkingService class in `src/services/vector-service.ts`:

Update constants at top of file:
```typescript
const MAX_TOKENS_WHOLE_FILE = 2000;   // was 8000 - smaller threshold for better retrieval
const CHUNK_SIZE_TOKENS = 512;         // was 4000 - matches OpenClaw's precision
const CHUNK_OVERLAP_TOKENS = 128;      // was 500 - ~25% overlap
const APPROX_CHARS_PER_TOKEN = 4;
```

Replace `chunk()` method with line-aware implementation:
- Accumulate lines until token budget reached
- Split at line boundaries (never mid-line)
- Rewind by overlap amount for sliding window
- Track nearest markdown header for each chunk

**Step 4: Run test to verify it passes**

Run: `npx jest src/services/chunking.test.ts -v`
Expected: PASS (all 5 tests)

**Step 5: Commit**

```bash
git add src/services/vector-service.ts src/services/chunking.test.ts
git commit -m "feat: replace fixed chunking with line-aware sliding windows"
```

---

## Task 3: Auto-Compaction with Pre-Flush Durability

Add automatic session summarization when token threshold is reached, with crash-safe pre-flush writes. This is OpenClaw's strongest feature and our biggest gap.

**Files:**
- Create: `src/services/compaction-service.ts`
- Test: `src/services/compaction-service.test.ts`
- Modify: `src/services/background-indexer.ts` (trigger compaction after indexing)

**Step 1: Write the failing test**

```typescript
// src/services/compaction-service.test.ts
import { CompactionService } from './compaction-service.js';
import Database from 'better-sqlite3';

describe('CompactionService', () => {
  let db: Database.Database;
  let service: CompactionService;

  beforeEach(() => {
    db = new Database(':memory:');
    db.exec(`
      CREATE TABLE sessions (
        id TEXT PRIMARY KEY,
        status TEXT DEFAULT 'active',
        started_at TEXT DEFAULT CURRENT_TIMESTAMP,
        ended_at TEXT,
        summary TEXT,
        metadata_json TEXT
      );
      CREATE TABLE conversation_summaries (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT,
        ai_model TEXT NOT NULL,
        summary TEXT NOT NULL,
        token_count INTEGER,
        started_at TEXT NOT NULL,
        ended_at TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      );
    `);
    service = new CompactionService(db);
  });

  afterEach(() => db.close());

  test('needsCompaction returns false when under threshold', () => {
    expect(service.needsCompaction('session1')).toBe(false);
  });

  test('needsCompaction returns true when over threshold', () => {
    db.prepare('INSERT INTO sessions (id, status) VALUES (?, ?)').run('s1', 'active');
    db.prepare(`
      INSERT INTO conversation_summaries (session_id, ai_model, summary, token_count, started_at)
      VALUES (?, ?, ?, ?, ?)
    `).run('s1', 'claude', 'test', 50000, new Date().toISOString());

    expect(service.needsCompaction('s1')).toBe(true);
  });

  test('preFlush writes pending state before compaction', () => {
    db.prepare('INSERT INTO sessions (id, status) VALUES (?, ?)').run('s1', 'active');
    service.preFlush('s1');

    const session = db.prepare('SELECT metadata_json FROM sessions WHERE id = ?').get('s1') as { metadata_json: string };
    const meta = JSON.parse(session.metadata_json);
    expect(meta.preFlushAt).toBeTruthy();
    expect(meta.compactionPending).toBe(true);
  });

  test('compact creates summary and clears pending state', async () => {
    db.prepare('INSERT INTO sessions (id, status) VALUES (?, ?)').run('s1', 'active');
    db.prepare(`
      INSERT INTO conversation_summaries (session_id, ai_model, summary, token_count, started_at)
      VALUES (?, ?, ?, ?, ?)
    `).run('s1', 'claude', 'Discussed auth system design', 30000, new Date().toISOString());
    db.prepare(`
      INSERT INTO conversation_summaries (session_id, ai_model, summary, token_count, started_at)
      VALUES (?, ?, ?, ?, ?)
    `).run('s1', 'claude', 'Reviewed database schema', 25000, new Date().toISOString());

    const result = await service.compact('s1');
    expect(result.compactedSummaries).toBe(2);
    expect(result.compactedTokens).toBe(55000);

    const session = db.prepare('SELECT summary, metadata_json FROM sessions WHERE id = ?').get('s1') as { summary: string; metadata_json: string };
    expect(session.summary).toBeTruthy();
    const meta = JSON.parse(session.metadata_json);
    expect(meta.compactionPending).toBeFalsy();
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx jest src/services/compaction-service.test.ts -v`
Expected: FAIL with "Cannot find module './compaction-service.js'"

**Step 3: Write minimal implementation**

```typescript
// src/services/compaction-service.ts
/**
 * Session Compaction Service
 *
 * Auto-summarizes conversation history when token thresholds are reached.
 * Uses pre-flush durability writes to prevent data loss on crash.
 *
 * Flow:
 * 1. Check if session token count exceeds threshold
 * 2. Pre-flush: mark session as compaction-pending (crash-safe)
 * 3. Compact: merge conversation summaries into distilled summary
 * 4. Clear pending state
 */
import Database from 'better-sqlite3';

const DEFAULT_TOKEN_THRESHOLD = 40000;

interface CompactionResult {
  compactedSummaries: number;
  compactedTokens: number;
  newSummary: string;
}

export class CompactionService {
  private db: Database.Database;
  private tokenThreshold: number;

  constructor(db: Database.Database, tokenThreshold = DEFAULT_TOKEN_THRESHOLD) {
    this.db = db;
    this.tokenThreshold = tokenThreshold;
  }

  needsCompaction(sessionId: string): boolean {
    const row = this.db.prepare(`
      SELECT COALESCE(SUM(token_count), 0) as total_tokens
      FROM conversation_summaries WHERE session_id = ?
    `).get(sessionId) as { total_tokens: number };
    return row.total_tokens > this.tokenThreshold;
  }

  preFlush(sessionId: string): void {
    const existing = this.db.prepare(
      'SELECT metadata_json FROM sessions WHERE id = ?'
    ).get(sessionId) as { metadata_json: string | null } | undefined;

    const meta = existing?.metadata_json ? JSON.parse(existing.metadata_json) : {};
    meta.preFlushAt = new Date().toISOString();
    meta.compactionPending = true;

    this.db.prepare(
      'UPDATE sessions SET metadata_json = ? WHERE id = ?'
    ).run(JSON.stringify(meta), sessionId);
  }

  async compact(sessionId: string): Promise<CompactionResult> {
    this.preFlush(sessionId);

    const summaries = this.db.prepare(`
      SELECT id, summary, token_count, ai_model, started_at
      FROM conversation_summaries WHERE session_id = ?
      ORDER BY started_at ASC
    `).all(sessionId) as { id: number; summary: string; token_count: number; ai_model: string; started_at: string }[];

    const totalTokens = summaries.reduce((sum, s) => sum + (s.token_count || 0), 0);

    const compacted = summaries.map((s, i) =>
      `[${i + 1}/${summaries.length}] (${s.ai_model}, ~${s.token_count} tokens): ${s.summary}`
    ).join('\n\n');

    const txn = this.db.transaction(() => {
      this.db.prepare('UPDATE sessions SET summary = ? WHERE id = ?').run(compacted, sessionId);

      const existing = this.db.prepare(
        'SELECT metadata_json FROM sessions WHERE id = ?'
      ).get(sessionId) as { metadata_json: string | null } | undefined;

      const meta = existing?.metadata_json ? JSON.parse(existing.metadata_json) : {};
      delete meta.compactionPending;
      meta.lastCompactedAt = new Date().toISOString();
      meta.compactedTokens = totalTokens;
      meta.compactedCount = summaries.length;

      this.db.prepare('UPDATE sessions SET metadata_json = ? WHERE id = ?')
        .run(JSON.stringify(meta), sessionId);
    });

    txn();

    return { compactedSummaries: summaries.length, compactedTokens: totalTokens, newSummary: compacted };
  }

  recoverPending(): string[] {
    const pending = this.db.prepare(`
      SELECT id FROM sessions
      WHERE json_extract(metadata_json, '$.compactionPending') = 1
    `).all() as { id: string }[];
    return pending.map(p => p.id);
  }
}
```

**Step 4: Run test to verify it passes**

Run: `npx jest src/services/compaction-service.test.ts -v`
Expected: PASS (all 4 tests)

**Step 5: Add compaction check to background indexer**

Modify `src/services/background-indexer.ts` to call `CompactionService.recoverPending()` on startup and check `needsCompaction()` after indexing.

**Step 6: Commit**

```bash
git add src/services/compaction-service.ts src/services/compaction-service.test.ts src/services/background-indexer.ts
git commit -m "feat: add auto-compaction with pre-flush durability"
```

---

## Task 4: Single-Binary Starter Mode

Collapse 5 MCP servers into a single `devlog-unified` server for zero-friction onboarding. Keep modular servers for power users.

**Files:**
- Create: `src/servers/unified-server.ts`
- Modify: `package.json` (add `server:unified` script)
- Test: Manual (start server, verify all tools registered)

**Step 1: Write unified server**

```typescript
// src/servers/unified-server.ts
#!/usr/bin/env node
/**
 * Unified DevLog Server - All tools in one process
 *
 * Zero-config starter mode: devlog init && devlog serve
 * Registers core + search + planning + tracking tools.
 */

import { createDevlogServer, startServer } from './base-server.js';
import { workspaceTools } from '../tools/workspace-tools.js';
import { currentWorkspaceTools } from '../tools/current-workspace-tools.js';
import { devlogInitTool } from '../tools/devlog-init-tool.js';
import { questionTools } from '../tools/question-tools.js';
import { assetTools } from '../tools/asset-tools.js';
import { planTools } from '../tools/plan-tools.js';
import { basicTools } from '../tools/basic-tools.js';
import type { ToolDefinition } from '../tools/registry.js';

async function main() {
  const allTools: ToolDefinition[] = [
    ...workspaceTools,
    ...currentWorkspaceTools,
    ...questionTools,
    ...assetTools,
    ...planTools,
    devlogInitTool,
    ...basicTools,
  ];

  // Optional: LanceDB tools (requires Ollama)
  try {
    const { lancedbTools } = await import('../tools/lancedb-tools.js');
    allTools.push(...lancedbTools);
    console.error('[Unified] LanceDB tools loaded');
  } catch {
    console.error('[Unified] LanceDB tools unavailable (Ollama not running?)');
  }

  // Optional: Bridge tools
  if (process.env.DEVLOG_ENABLE_TACHIBOT_BRIDGE === 'true') {
    const { bridgeTools } = await import('../tools/bridge-tools.js');
    allTools.push(...bridgeTools);
  }

  const config = {
    name: 'devlog-unified',
    version: '2.0.0',
    description: 'Unified DevLog MCP Server - all tools in one process',
  };

  const server = createDevlogServer(config);
  await startServer(server, allTools, config);
}

main().catch(console.error);
```

**Step 2: Add to package.json**

Add script: `"server:unified": "node dist/esm/servers/unified-server.js"`
Add script: `"serve": "tsx src/servers/unified-server.ts"` (dev mode)

**Step 3: Build and test**

Run: `npm run build && node dist/esm/servers/unified-server.js`
Expected: Server starts, lists all registered tools

**Step 4: Commit**

```bash
git add src/servers/unified-server.ts package.json
git commit -m "feat: add unified single-binary server mode"
```

---

## Task 5: Markdown/OpenClaw Importer

One-click import from OpenClaw's `MEMORY.md`, daily logs, and plain Markdown devlogs into the structured database.

**Files:**
- Create: `src/services/markdown-importer.ts`
- Test: `src/services/markdown-importer.test.ts`
- Modify: `src/devlog-cli.ts` (add `devlog import` command)

**Step 1: Write the failing test**

```typescript
// src/services/markdown-importer.test.ts
import { MarkdownImporter, parseMarkdownFrontmatter } from './markdown-importer.js';

describe('parseMarkdownFrontmatter', () => {
  test('extracts YAML frontmatter', () => {
    const md = `---
title: My Document
status: active
tags: [auth, backend]
---

# Content here`;

    const result = parseMarkdownFrontmatter(md);
    expect(result.frontmatter.title).toBe('My Document');
    expect(result.frontmatter.status).toBe('active');
    expect(result.frontmatter.tags).toEqual(['auth', 'backend']);
    expect(result.content).toContain('# Content here');
  });

  test('handles no frontmatter', () => {
    const md = '# Just a title\n\nSome content.';
    const result = parseMarkdownFrontmatter(md);
    expect(result.frontmatter).toEqual({});
    expect(result.content).toBe(md);
  });
});

describe('MarkdownImporter', () => {
  test('detects OpenClaw memory format', () => {
    const content = `# MEMORY\n\n## User Preferences\n- Likes TypeScript`;
    const detected = MarkdownImporter.detectFormat(content, 'MEMORY.md');
    expect(detected).toBe('openclaw-memory');
  });

  test('detects OpenClaw daily log format', () => {
    const detected = MarkdownImporter.detectFormat('# Daily Log', '2026-02-21.md');
    expect(detected).toBe('openclaw-daily');
  });

  test('detects generic markdown', () => {
    const detected = MarkdownImporter.detectFormat('# Random doc', 'notes.md');
    expect(detected).toBe('markdown');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx jest src/services/markdown-importer.test.ts -v`
Expected: FAIL with "Cannot find module"

**Step 3: Write implementation**

```typescript
// src/services/markdown-importer.ts
import * as path from 'node:path';

type DocFormat = 'openclaw-memory' | 'openclaw-daily' | 'markdown';

interface Frontmatter {
  title?: string;
  status?: string;
  tags?: string[];
  docType?: string;
  priority?: string;
  [key: string]: unknown;
}

interface ParseResult {
  frontmatter: Frontmatter;
  content: string;
}

export function parseMarkdownFrontmatter(raw: string): ParseResult {
  const fmRegex = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/;
  const match = raw.match(fmRegex);
  if (!match) return { frontmatter: {}, content: raw };

  const yamlBlock = match[1];
  const content = match[2];
  const frontmatter: Frontmatter = {};

  for (const line of yamlBlock.split('\n')) {
    const kvMatch = line.match(/^(\w+):\s*(.+)$/);
    if (kvMatch) {
      const key = kvMatch[1];
      let value: unknown = kvMatch[2].trim();
      if (typeof value === 'string' && value.startsWith('[') && value.endsWith(']')) {
        value = value.slice(1, -1).split(',').map(s => s.trim());
      }
      frontmatter[key] = value;
    }
  }

  return { frontmatter, content };
}

export class MarkdownImporter {
  static detectFormat(content: string, filename: string): DocFormat {
    const basename = path.basename(filename, path.extname(filename));
    if (['MEMORY', 'SOUL', 'USER', 'IDENTITY'].includes(basename.toUpperCase())) {
      return 'openclaw-memory';
    }
    if (/^\d{4}-\d{2}-\d{2}$/.test(basename)) {
      return 'openclaw-daily';
    }
    return 'markdown';
  }

  static docTypeFromFormat(format: DocFormat): string {
    switch (format) {
      case 'openclaw-memory': return 'research';
      case 'openclaw-daily': return 'session';
      case 'markdown': return 'note';
    }
  }

  static titleFromFilename(filename: string, content: string): string {
    const headerMatch = content.match(/^#\s+(.+)$/m);
    if (headerMatch) return headerMatch[1].trim();
    return path.basename(filename, path.extname(filename));
  }
}
```

**Step 4: Run test to verify it passes**

Run: `npx jest src/services/markdown-importer.test.ts -v`
Expected: PASS (all 5 tests)

**Step 5: Add `devlog import` CLI command**

Add to `src/devlog-cli.ts`: a new `import` subcommand that scans a directory for `.md` files, detects format, parses frontmatter, and inserts into the database.

**Step 6: Commit**

```bash
git add src/services/markdown-importer.ts src/services/markdown-importer.test.ts src/devlog-cli.ts
git commit -m "feat: add Markdown/OpenClaw importer for one-click migration"
```

---

## Task 6: Ambient Git-Aware Context Surfacing

Auto-detect project context from git state (branch, recent commits, changed files) and surface relevant devlog entries without explicit queries. This is the "10x moment" no competitor does well.

**Security:** Uses `execFileSync('git', [...args])` not `execSync()` to prevent command injection. See `src/utils/execFileNoThrow.ts` for the project pattern.

**Files:**
- Create: `src/services/ambient-context.ts`
- Test: `src/services/ambient-context.test.ts`
- Create: `src/tools/context-tools.ts` (MCP tool wrapping the service)
- Modify: `src/servers/unified-server.ts` (register context tools)

**Step 1: Write the failing test**

```typescript
// src/services/ambient-context.test.ts
import { AmbientContextService } from './ambient-context.js';

describe('AmbientContextService', () => {
  test('extracts keywords from branch name', () => {
    const keywords = AmbientContextService.branchToKeywords('feat/add-auth-system');
    expect(keywords).toContain('auth');
    expect(keywords).toContain('system');
    expect(keywords).not.toContain('feat');
    expect(keywords).not.toContain('add');
  });

  test('extracts keywords from commit messages', () => {
    const commits = ['fix: resolve login timeout issue', 'feat: add session management'];
    const keywords = AmbientContextService.commitsToKeywords(commits);
    expect(keywords).toContain('login');
    expect(keywords).toContain('timeout');
    expect(keywords).toContain('session');
  });

  test('extracts keywords from changed file paths', () => {
    const files = ['src/auth/login.ts', 'src/auth/session.ts'];
    const keywords = AmbientContextService.filesToKeywords(files);
    expect(keywords).toContain('auth');
    expect(keywords).toContain('login');
    expect(keywords).toContain('session');
  });

  test('builds search query from git context', () => {
    const ctx = {
      branch: 'feat/user-auth',
      recentCommits: ['add login page', 'fix session timeout'],
      changedFiles: ['src/auth/login.ts'],
    };
    const query = AmbientContextService.buildSearchQuery(ctx);
    expect(query.length).toBeGreaterThan(5);
    expect(query).toContain('auth');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx jest src/services/ambient-context.test.ts -v`
Expected: FAIL with "Cannot find module"

**Step 3: Write implementation**

```typescript
// src/services/ambient-context.ts
/**
 * Ambient Context Service
 *
 * Auto-detects project context from git state and surfaces relevant
 * devlog entries. Uses execFileSync (not execSync) for shell safety.
 */
import { execFileSync } from 'node:child_process';
import * as path from 'node:path';

const STOP_WORDS = new Set([
  'feat', 'fix', 'chore', 'docs', 'refactor', 'test', 'style', 'perf',
  'ci', 'build', 'revert', 'merge', 'add', 'update', 'remove', 'delete',
  'the', 'and', 'for', 'with', 'from', 'into', 'this', 'that', 'src',
  'index', 'main', 'master', 'dev', 'develop', 'tests', 'spec',
]);

export interface GitContext {
  branch: string;
  recentCommits: string[];
  changedFiles: string[];
}

export class AmbientContextService {
  static getGitContext(cwd: string): GitContext | null {
    try {
      const branch = execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd, encoding: 'utf-8' }).trim();
      const commits = execFileSync('git', ['log', '--oneline', '-5', '--format=%s'], { cwd, encoding: 'utf-8' })
        .trim().split('\n').filter(Boolean);
      let changedFiles: string[] = [];
      try {
        changedFiles = execFileSync('git', ['diff', '--name-only', 'HEAD~5..HEAD'], { cwd, encoding: 'utf-8' })
          .trim().split('\n').filter(Boolean);
      } catch {
        changedFiles = execFileSync('git', ['diff', '--name-only'], { cwd, encoding: 'utf-8' })
          .trim().split('\n').filter(Boolean);
      }
      return { branch, recentCommits: commits, changedFiles };
    } catch {
      return null;
    }
  }

  static branchToKeywords(branch: string): string[] {
    return branch.replace(/[/_-]/g, ' ').split(/\s+/)
      .map(w => w.toLowerCase())
      .filter(w => w.length > 2 && !STOP_WORDS.has(w));
  }

  static commitsToKeywords(commits: string[]): string[] {
    const words = commits.join(' ').replace(/[^a-zA-Z\s]/g, ' ').split(/\s+/)
      .map(w => w.toLowerCase())
      .filter(w => w.length > 2 && !STOP_WORDS.has(w));
    const freq = new Map<string, number>();
    for (const w of words) freq.set(w, (freq.get(w) || 0) + 1);
    return Array.from(freq.entries()).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([w]) => w);
  }

  static filesToKeywords(files: string[]): string[] {
    const segments = files.flatMap(f =>
      path.basename(f, path.extname(f)).replace(/[._-]/g, ' ').split(/\s+/)
        .concat(path.dirname(f).split('/'))
    ).map(w => w.toLowerCase()).filter(w => w.length > 2 && !STOP_WORDS.has(w));
    return [...new Set(segments)].slice(0, 15);
  }

  static buildSearchQuery(ctx: GitContext): string {
    const all = [
      ...this.branchToKeywords(ctx.branch),
      ...this.branchToKeywords(ctx.branch), // double weight
      ...this.commitsToKeywords(ctx.recentCommits),
      ...this.filesToKeywords(ctx.changedFiles),
    ];
    return [...new Set(all)].slice(0, 12).join(' ');
  }
}
```

**Step 4: Run test to verify it passes**

Run: `npx jest src/services/ambient-context.test.ts -v`
Expected: PASS (all 4 tests)

**Step 5: Create MCP tool + register in unified server**

Create `src/tools/context-tools.ts` with `devlog_ambient_context` tool. Register in unified server.

**Step 6: Commit**

```bash
git add src/services/ambient-context.ts src/services/ambient-context.test.ts src/tools/context-tools.ts src/servers/unified-server.ts
git commit -m "feat: add ambient git-aware context surfacing"
```

---

## Summary: What This Plan Delivers

| Gap (Judge Council) | Task | OpenClaw Parity? |
|---------------------|------|-----------------|
| No embedding cache | Task 1: LRU Cache | Exceeds (persistent LRU vs in-memory) |
| Fixed 4k chunking | Task 2: Sliding Windows | Matches (512 tokens, line-aware) |
| No auto-compaction | Task 3: Compaction + Pre-flush | Matches (token threshold + crash safety) |
| 5-server friction | Task 4: Unified Server | Exceeds (one process, optional modular) |
| No migration path | Task 5: MD/OpenClaw Importer | New capability (absorb competitor users) |
| No predictive surfacing | Task 6: Ambient Context | New category (10x differentiator) |

**Estimated total: ~20 new/modified files, ~2000 lines of code, 6 commits**

**YC Pitch After Implementation:**
> "OpenClaw is a personal AI diary. We're the team-scale developer knowledge graph — structured memory with ambient context surfacing, one-click migration from any Markdown system, and hybrid search that actually understands your codebase."
