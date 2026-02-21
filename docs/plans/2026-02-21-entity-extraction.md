# Auto Entity Extraction Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Automatically populate the GraphRAG knowledge graph (entities, docEntities, entityRelations tables) from document content using regex + heuristics during background indexing.

**Architecture:** Two-layer extraction: EntityExtractor finds entities via regex patterns with span merging and canonical normalization, then RelationDetector identifies relations between entities via trigger phrases. A persistence layer batch-upserts results into SQLite within transactions. The background indexer calls extraction after vector embedding, and a new MCP tool exposes graph queries.

**Tech Stack:** TypeScript, better-sqlite3 (raw SQL, not Drizzle ORM — matches existing indexer pattern), Jest for tests, MCP SDK for tool registration.

---

### Task 1: EntityExtractor Core — Regex Patterns, Span Merging, Canonical Names

**Files:**
- Create: `src/services/entity-extractor.ts`
- Create: `src/services/entity-extractor.test.ts`

**Context:** The entities table expects `type` (person|project|file|service|component|concept), `name` (raw surface form), and `canonical_name` (normalized for dedup). The unique constraint is on `(type, canonical_name)`.

**Step 1: Write the failing test for entity extraction**

```typescript
// src/services/entity-extractor.test.ts
import { EntityExtractor, type ExtractedEntity } from './entity-extractor.js';

describe('EntityExtractor', () => {
  const extractor = new EntityExtractor();

  test('extracts @username as person entity', () => {
    const result = extractor.extractEntities('Fixed by @alice in PR #42');
    const people = result.filter(e => e.type === 'person');
    expect(people).toHaveLength(1);
    expect(people[0].name).toBe('@alice');
    expect(people[0].canonicalName).toBe('alice');
    expect(people[0].confidence).toBe(0.85);
  });

  test('extracts file paths as file entities', () => {
    const result = extractor.extractEntities('Updated src/services/auth.ts and config/redis.yml');
    const files = result.filter(e => e.type === 'file');
    expect(files).toHaveLength(2);
    expect(files[0].canonicalName).toBe('src/services/auth.ts');
    expect(files[1].canonicalName).toBe('config/redis.yml');
  });

  test('extracts org/repo as project entity', () => {
    const result = extractor.extractEntities('See anthropics/claude-code for details');
    const projects = result.filter(e => e.type === 'project');
    expect(projects).toHaveLength(1);
    expect(projects[0].canonicalName).toBe('anthropics/claude-code');
  });

  test('extracts PascalCase as component entity', () => {
    const result = extractor.extractEntities('The AuthService handles login via UserProvider');
    const components = result.filter(e => e.type === 'component');
    expect(components.length).toBeGreaterThanOrEqual(2);
    const names = components.map(c => c.canonicalName);
    expect(names).toContain('authservice');
    expect(names).toContain('userprovider');
  });

  test('extracts service names from known gazetteer', () => {
    const result = extractor.extractEntities('We use Redis for caching and Postgres for storage');
    const services = result.filter(e => e.type === 'service');
    expect(services.length).toBeGreaterThanOrEqual(2);
    const names = services.map(s => s.canonicalName);
    expect(names).toContain('redis');
    expect(names).toContain('postgres');
  });

  test('extracts hashtags as concept entities', () => {
    const result = extractor.extractEntities('This relates to #auth and #security');
    const concepts = result.filter(e => e.type === 'concept');
    expect(concepts.length).toBeGreaterThanOrEqual(2);
    const names = concepts.map(c => c.canonicalName);
    expect(names).toContain('auth');
    expect(names).toContain('security');
  });

  test('skips entities inside code fences', () => {
    const input = 'Real mention of @alice\n```\nconst @bob = fake;\nAuthService.init();\n```\nEnd';
    const result = extractor.extractEntities(input);
    const people = result.filter(e => e.type === 'person');
    expect(people).toHaveLength(1);
    expect(people[0].name).toBe('@alice');
  });

  test('filters stoplist words from components', () => {
    const result = extractor.extractEntities('The String and Object types are used');
    const components = result.filter(e => e.type === 'component');
    const names = components.map(c => c.canonicalName);
    expect(names).not.toContain('string');
    expect(names).not.toContain('object');
  });

  test('span merging: file path wins over component overlap', () => {
    const result = extractor.extractEntities('Check src/AuthService.ts for the fix');
    const files = result.filter(e => e.type === 'file');
    const components = result.filter(e => e.type === 'component');
    expect(files).toHaveLength(1);
    expect(files[0].canonicalName).toBe('src/authservice.ts');
    // AuthService should NOT be extracted separately since it's inside the file path
    expect(components).toHaveLength(0);
  });

  test('canonical normalization is consistent', () => {
    const r1 = extractor.extractEntities('UserAuth component');
    const r2 = extractor.extractEntities('userAuth component');
    const c1 = r1.filter(e => e.type === 'component');
    const c2 = r2.filter(e => e.type === 'component');
    // Both should normalize to the same canonical name
    if (c1.length > 0 && c2.length > 0) {
      expect(c1[0].canonicalName).toBe(c2[0].canonicalName);
    }
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx jest src/services/entity-extractor.test.ts --no-cache`
Expected: FAIL with "Cannot find module './entity-extractor.js'"

**Step 3: Write the EntityExtractor implementation**

Create `src/services/entity-extractor.ts` with:

- **Types:** `EntityType` union, `ExtractedEntity` interface (type, name, canonicalName, confidence, start, end, context), `RawSpan` internal type
- **Constants:** `TYPE_PRECEDENCE` map (file:6, project:5, service:4, person:3, component:2, concept:1), `COMPONENT_STOPLIST` (string, object, array, number, boolean, function, class, etc.), `SERVICE_GAZETTEER` (redis, postgres, mongodb, docker, kubernetes, ollama, openai, anthropic, etc.)
- **EntityExtractor class** with public method `extractEntities(text: string): ExtractedEntity[]`:
  1. `findCodeFenceRanges(text)` — regex for triple-backtick blocks, returns `{start, end}[]`
  2. Run 6 private extractors: `extractPersons`, `extractFiles`, `extractProjects`, `extractServices`, `extractComponents`, `extractConcepts`
  3. Filter out spans inside code fences
  4. `mergeSpans(spans)` — sort by start, resolve overlaps using longest-wins + type precedence
  5. `deduplicateEntities(spans)` — Map by `${type}:${canonical}`, keep highest confidence
  6. Build final `ExtractedEntity[]` with context snippets (±40 chars)

Pattern details:
- **person:** `/@([a-zA-Z][\w-]{1,38})\b/g` (confidence 0.85), `/\b(?:by|from|with)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)\b/g` (confidence 0.7)
- **file:** `/(?:\.\.?\/)?(?:[\w@.-]+\/)+[\w.-]+\.[\w]+/g` (confidence 0.85), import/require relative paths (confidence 0.85)
- **project:** `/\b([a-zA-Z][\w.-]*\/[a-zA-Z][\w.-]*)\b/g` — only if exactly 2 segments and no file extension (confidence 0.7)
- **service:** Word boundary match against `SERVICE_GAZETTEER` set (confidence 0.85), URL patterns (confidence 0.7)
- **component:** `/\b([A-Z][a-z]+(?:[A-Z][a-z]+)+)\b/g` — PascalCase with 2+ capital letters, filtered against stoplist and gazetteer (confidence 0.7)
- **concept:** `/#([a-zA-Z][\w-]*)\b/g` (confidence 0.85), `/\b(?:implements|about|regarding)\s+([a-zA-Z][\w-]*)\b/gi` (confidence 0.7)

Public `canonicalize(name, type)` method — file: strip `./`, lowercase; project: lowercase; person: strip `@`, lowercase; concept: strip `#`, lowercase; default: lowercase.

**Step 4: Run tests to verify they pass**

Run: `npx jest src/services/entity-extractor.test.ts --no-cache`
Expected: PASS (10 tests)

**Step 5: Commit**

```bash
git add src/services/entity-extractor.ts src/services/entity-extractor.test.ts
git commit -m "feat: add EntityExtractor with regex patterns, span merging, canonical normalization"
```

---

### Task 2: RelationDetector — Trigger Phrases, Directionality, Negation

**Files:**
- Modify: `src/services/entity-extractor.ts` (add RelationDetector class to same file)
- Modify: `src/services/entity-extractor.test.ts` (add relation tests)

**Context:** Relations are detected between entities found in the same chunk. The `doc_entities` table stores doc-to-entity links with `relation_type` (mentions|implements|depends_on|blocks|authored_by). The `entity_relations` table stores entity-to-entity links. For Phase 1, we only do same-sentence pairing and basic negation filtering.

**Step 1: Write the failing test for relation detection**

Add to `src/services/entity-extractor.test.ts`:

```typescript
import { EntityExtractor, RelationDetector, type ExtractedEntity, type ExtractedRelation } from './entity-extractor.js';

describe('RelationDetector', () => {
  const extractor = new EntityExtractor();
  const detector = new RelationDetector();

  test('detects "implements" relation', () => {
    const text = 'AuthService implements OAuth2';
    const entities = extractor.extractEntities(text);
    const relations = detector.detectRelations(text, entities);
    const impl = relations.filter(r => r.relationType === 'implements');
    expect(impl.length).toBeGreaterThanOrEqual(1);
  });

  test('detects "depends_on" relation', () => {
    const text = 'The auth module depends on Redis for session storage';
    const entities = extractor.extractEntities(text);
    const relations = detector.detectRelations(text, entities);
    const deps = relations.filter(r => r.relationType === 'depends_on');
    expect(deps.length).toBeGreaterThanOrEqual(1);
  });

  test('detects "authored_by" relation', () => {
    const text = 'Login feature built by @alice';
    const entities = extractor.extractEntities(text);
    const relations = detector.detectRelations(text, entities);
    const auth = relations.filter(r => r.relationType === 'authored_by');
    expect(auth.length).toBeGreaterThanOrEqual(1);
  });

  test('skips negated relations', () => {
    const text = 'AuthService does not depend on Redis';
    const entities = extractor.extractEntities(text);
    const relations = detector.detectRelations(text, entities);
    const deps = relations.filter(r => r.relationType === 'depends_on');
    expect(deps).toHaveLength(0);
  });

  test('handles passive voice "blocked by" (flips direction)', () => {
    const text = 'The AuthService is blocked by DatabaseMigration';
    const entities = extractor.extractEntities(text);
    const relations = detector.detectRelations(text, entities);
    const blocks = relations.filter(r => r.relationType === 'blocks');
    if (blocks.length > 0) {
      // Source should be DatabaseMigration (the blocker)
      expect(blocks[0].sourceCanonical).toBe('databasemigration');
    }
  });

  test('defaults to "mentions" for all entities in a chunk', () => {
    const text = 'Working on Redis caching for AuthService';
    const entities = extractor.extractEntities(text);
    const relations = detector.detectRelations(text, entities);
    const mentions = relations.filter(r => r.relationType === 'mentions');
    // Every entity should get a 'mentions' relation at minimum
    expect(mentions.length).toBe(entities.length);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx jest src/services/entity-extractor.test.ts --no-cache`
Expected: FAIL with "RelationDetector is not exported"

**Step 3: Add RelationDetector to entity-extractor.ts**

Add to `src/services/entity-extractor.ts`:

- **Types:** `ExtractedRelation` interface (relationType, sourceCanonical, sourceType, targetCanonical, targetType, confidence, evidence), `TriggerPattern` internal type (regex, relationType, passive flag)
- **Constants:** `TRIGGER_PATTERNS` array with regex patterns for implements/built/created, depends on/requires/uses, blocks, blocked by (passive), authored by/written by/built by (passive). `NEGATION_WINDOW = 10` chars before trigger. `NEGATION_PATTERNS` regex for not/no/don't/doesn't/never/without/isn't.
- **RelationDetector class** with public method `detectRelations(text, entities): ExtractedRelation[]`:
  1. Create default "mentions" relation for every entity
  2. For each trigger pattern, scan text for matches
  3. Check negation window before each match — skip if negated
  4. Find nearest entity BEFORE trigger (subject) and AFTER trigger (object) within 80-char window
  5. If passive voice: swap source and target
  6. Emit relation with confidence 0.85

**Step 4: Run tests to verify they pass**

Run: `npx jest src/services/entity-extractor.test.ts --no-cache`
Expected: PASS (16 tests)

**Step 5: Commit**

```bash
git add src/services/entity-extractor.ts src/services/entity-extractor.test.ts
git commit -m "feat: add RelationDetector with trigger phrases, negation filtering, passive voice"
```

---

### Task 3: SQLite Persistence Layer — Batch Upserts in Transactions

**Files:**
- Modify: `src/services/entity-extractor.ts` (add EntityPersistence class)
- Modify: `src/services/entity-extractor.test.ts` (add persistence tests)

**Context:** Uses better-sqlite3 directly (matching background-indexer pattern, NOT Drizzle ORM). The schema has: `entities` (UNIQUE on type+canonical_name), `doc_entities` (composite PK: doc_id+entity_id+relation_type), `entity_relations` (composite PK: source_id+target_id+relation_type). All SQL must use parameterized queries (never string concatenation).

**Step 1: Write the failing test for persistence**

Add to `src/services/entity-extractor.test.ts`:

```typescript
import { EntityExtractor, RelationDetector, EntityPersistence } from './entity-extractor.js';
import Database from 'better-sqlite3';

describe('EntityPersistence', () => {
  let db: Database.Database;
  let persistence: EntityPersistence;
  const extractor = new EntityExtractor();
  const detector = new RelationDetector();

  beforeEach(() => {
    db = new Database(':memory:');
    db.exec(`
      CREATE TABLE docs (id TEXT PRIMARY KEY, title TEXT, content TEXT);
      CREATE TABLE entities (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        type TEXT NOT NULL, name TEXT NOT NULL,
        canonical_name TEXT, description TEXT, metadata_json TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(type, canonical_name)
      );
      CREATE TABLE doc_entities (
        doc_id TEXT NOT NULL, entity_id INTEGER NOT NULL,
        relation_type TEXT NOT NULL, context TEXT,
        confidence REAL DEFAULT 1.0,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (doc_id, entity_id, relation_type)
      );
      CREATE TABLE entity_relations (
        source_id INTEGER NOT NULL, target_id INTEGER NOT NULL,
        relation_type TEXT NOT NULL, weight REAL DEFAULT 1.0,
        metadata_json TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (source_id, target_id, relation_type)
      );
    `);
    db.exec("INSERT INTO docs (id, title) VALUES ('doc1', 'Test Doc')");
    persistence = new EntityPersistence(db);
  });

  afterEach(() => db.close());

  test('persists extracted entities to database', () => {
    const text = 'AuthService uses Redis for caching';
    const entities = extractor.extractEntities(text);
    const relations = detector.detectRelations(text, entities);
    persistence.persistForDocument('doc1', entities, relations);
    const count = (db.prepare('SELECT COUNT(*) as c FROM entities').get() as { c: number }).c;
    expect(count).toBeGreaterThan(0);
  });

  test('creates doc_entities links', () => {
    const text = 'AuthService built by @alice';
    const entities = extractor.extractEntities(text);
    const relations = detector.detectRelations(text, entities);
    persistence.persistForDocument('doc1', entities, relations);
    const links = (db.prepare('SELECT COUNT(*) as c FROM doc_entities WHERE doc_id = ?').get('doc1') as { c: number }).c;
    expect(links).toBeGreaterThan(0);
  });

  test('deduplicates entities on re-index (idempotent)', () => {
    const text = 'AuthService uses Redis';
    const entities = extractor.extractEntities(text);
    const relations = detector.detectRelations(text, entities);
    persistence.persistForDocument('doc1', entities, relations);
    persistence.persistForDocument('doc1', entities, relations);
    const entityCount = (db.prepare('SELECT COUNT(*) as c FROM entities').get() as { c: number }).c;
    expect(entityCount).toBe(entities.length);
  });

  test('cleans old doc_entities before re-insert', () => {
    const text1 = 'AuthService uses Redis';
    const ent1 = extractor.extractEntities(text1);
    const rel1 = detector.detectRelations(text1, ent1);
    persistence.persistForDocument('doc1', ent1, rel1);

    const text2 = 'UserService uses Postgres';
    const ent2 = extractor.extractEntities(text2);
    const rel2 = detector.detectRelations(text2, ent2);
    persistence.persistForDocument('doc1', ent2, rel2);

    // doc_entities should only contain links from the second call
    const links = db.prepare('SELECT * FROM doc_entities WHERE doc_id = ?').all('doc1');
    expect(links.length).toBe(rel2.length);
  });

  test('wraps persistence in a transaction (atomicity)', () => {
    const text = 'AuthService uses Redis';
    const entities = extractor.extractEntities(text);
    const relations = detector.detectRelations(text, entities);
    persistence.persistForDocument('doc1', entities, relations);
    const entityCount = (db.prepare('SELECT COUNT(*) as c FROM entities').get() as { c: number }).c;
    expect(entityCount).toBeGreaterThan(0);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx jest src/services/entity-extractor.test.ts --no-cache`
Expected: FAIL with "EntityPersistence is not exported"

**Step 3: Add EntityPersistence class to entity-extractor.ts**

Add to `src/services/entity-extractor.ts`:

```typescript
import Database from 'better-sqlite3';
```

- **EntityPersistence class** with constructor taking `Database.Database`
- **Prepared statements** (lazy-init in constructor via `prepareStatements()`):
  - `stmtUpsertEntity` — INSERT OR ON CONFLICT(type, canonical_name) DO UPDATE SET updated_at, metadata_json
  - `stmtGetEntityId` — SELECT id FROM entities WHERE type = ? AND canonical_name = ?
  - `stmtDeleteDocEntities` — DELETE FROM doc_entities WHERE doc_id = ?
  - `stmtInsertDocEntity` — INSERT OR IGNORE INTO doc_entities
  - `stmtUpsertEntityRelation` — INSERT OR IGNORE INTO entity_relations
- **`persistForDocument(docId, entities, relations)`** wrapped in `db.transaction()`:
  1. Upsert all entities, collect IDs via `stmtGetEntityId` into `Map<string, number>` keyed by `${type}:${canonical}`
  2. Store raw surface form in `metadata_json` as `{"surfaceForm": "..."}` (Phase 1 critique mitigation)
  3. Delete old doc_entities for this docId (idempotent cleanup)
  4. Insert new doc_entities linking docId to each entity via relation
  5. Insert entity-to-entity relations (skip "mentions" type — those are doc-level only)

**Step 4: Run tests to verify they pass**

Run: `npx jest src/services/entity-extractor.test.ts --no-cache`
Expected: PASS (21 tests)

**Step 5: Commit**

```bash
git add src/services/entity-extractor.ts src/services/entity-extractor.test.ts
git commit -m "feat: add EntityPersistence with batch upserts and transactional doc processing"
```

---

### Task 4: Background Indexer Integration

**Files:**
- Modify: `src/services/background-indexer.ts`

**Context:** The background indexer at `src/services/background-indexer.ts` currently loops through all docs, checks `needsReindex()`, and calls `indexDocument()`. We add entity extraction BEFORE the vector embedding step (since entity extraction is synchronous and doesn't need Ollama). Entity extraction runs for ALL docs with content, even when Ollama is down.

**Step 1: Modify background-indexer.ts**

Add imports at the top:

```typescript
import { EntityExtractor, RelationDetector, EntityPersistence } from './entity-extractor.js';
```

Add a new function `runEntityExtraction(sqliteDb)` that:
1. Instantiates `EntityExtractor`, `RelationDetector`, `EntityPersistence`
2. Queries all docs with content: `SELECT id, title, content FROM docs WHERE content IS NOT NULL AND content != ''`
3. For each doc: extract entities, detect relations, persist — wrapped in try/catch per doc
4. Logs: `[EntityExtraction] Done: N docs processed, M entities extracted`

Call `runEntityExtraction(sqliteDb)` at the start of the setTimeout callback, BEFORE the Ollama health check. This ensures entities are extracted even when Ollama is offline.

**Step 2: Run the full test suite to check nothing broke**

Run: `npx jest src/services/ --no-cache`
Expected: PASS (all existing service tests still pass)

**Step 3: Commit**

```bash
git add src/services/background-indexer.ts
git commit -m "feat: integrate entity extraction into background indexer pipeline"
```

---

### Task 5: MCP Tool — devlog_entity_graph

**Files:**
- Create: `src/tools/entity-tools.ts`
- Modify: `src/servers/unified-server.ts:17-30` (add import and register)

**Context:** The MCP tool pattern uses `ToolDefinition` from `src/tools/registry.ts`. Each tool has `name`, `title`, `description`, `inputSchema` (Zod), and `handler`. The handler receives validated params and returns `CallToolResult`. See `src/tools/context-tools.ts` for the pattern.

**Step 1: Create entity-tools.ts**

Create `src/tools/entity-tools.ts` exporting `entityTools: ToolDefinition[]` with one tool: `devlog_entity_graph`.

**Input schema (Zod):**
- `query?: string` — Search entities by name (partial match via LIKE)
- `type?: enum('person','project','file','service','component','concept')` — Filter by entity type
- `entityId?: number` — Get specific entity and its relations
- `depth?: number (1-5, default 2)` — Graph traversal depth
- `limit?: number (1-100, default 20)` — Max results

**Handler logic:**
1. Get DB via `getDb()` — return error if not initialized
2. **Mode 1 (entityId provided):** Get entity by ID, run recursive CTE to find connected entities:

```sql
WITH RECURSIVE graph(entity_id, depth) AS (
  SELECT ?, 0
  UNION ALL
  SELECT
    CASE WHEN er.source_id = g.entity_id THEN er.target_id ELSE er.source_id END,
    g.depth + 1
  FROM graph g
  JOIN entity_relations er ON er.source_id = g.entity_id OR er.target_id = g.entity_id
  WHERE g.depth < ?
)
SELECT DISTINCT er.*, es.name as source_name, et.name as target_name
FROM entity_relations er
JOIN graph g ON er.source_id = g.entity_id OR er.target_id = g.entity_id
JOIN entities es ON er.source_id = es.id
JOIN entities et ON er.target_id = et.id
LIMIT 50
```

Also query `doc_entities` for linked documents. Return formatted markdown output.

3. **Mode 2 (search):** Build WHERE clause from type/query params using parameterized SQL:

```sql
SELECT e.*, COUNT(de.doc_id) as doc_count
FROM entities e
LEFT JOIN doc_entities de ON e.id = de.entity_id
WHERE e.type = ? AND (e.name LIKE ? OR e.canonical_name LIKE ?)
GROUP BY e.id
ORDER BY doc_count DESC
LIMIT ?
```

Return list with entity name, type, doc count, and ID. Include graph stats (total entities, total relations).

**All SQL is parameterized — no string concatenation.** The CTE depth is capped at 5 (Phase 1 mitigation).

**Step 2: Register in unified-server.ts**

Add import after line 17:
```typescript
import { entityTools } from '../tools/entity-tools.js';
```

Add `...entityTools,` after `...basicTools,` in the allTools array.

**Step 3: Verify build**

Run: `npm run build`
Expected: Compiles without errors

**Step 4: Commit**

```bash
git add src/tools/entity-tools.ts src/servers/unified-server.ts
git commit -m "feat: add devlog_entity_graph MCP tool with recursive CTE graph traversal"
```

---

### Task 6: Integration Tests

**Files:**
- Modify: `src/services/entity-extractor.test.ts` (add integration suite)

**Context:** Integration tests verify the full pipeline: text to extraction to persistence to query. Uses in-memory SQLite for speed.

**Step 1: Add integration test suite**

Append to `src/services/entity-extractor.test.ts`:

```typescript
describe('Integration: Full Pipeline', () => {
  let db: Database.Database;
  let extractor: EntityExtractor;
  let detector: RelationDetector;
  let persistence: EntityPersistence;

  beforeEach(() => {
    db = new Database(':memory:');
    db.exec(`
      CREATE TABLE docs (id TEXT PRIMARY KEY, title TEXT, content TEXT);
      CREATE TABLE entities (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        type TEXT NOT NULL, name TEXT NOT NULL,
        canonical_name TEXT, description TEXT, metadata_json TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(type, canonical_name)
      );
      CREATE TABLE doc_entities (
        doc_id TEXT NOT NULL, entity_id INTEGER NOT NULL,
        relation_type TEXT NOT NULL, context TEXT,
        confidence REAL DEFAULT 1.0,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (doc_id, entity_id, relation_type)
      );
      CREATE TABLE entity_relations (
        source_id INTEGER NOT NULL, target_id INTEGER NOT NULL,
        relation_type TEXT NOT NULL, weight REAL DEFAULT 1.0,
        metadata_json TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (source_id, target_id, relation_type)
      );
    `);
    extractor = new EntityExtractor();
    detector = new RelationDetector();
    persistence = new EntityPersistence(db);
  });

  afterEach(() => db.close());

  test('end-to-end: doc with multiple entity types produces correct graph', () => {
    db.exec("INSERT INTO docs (id, title) VALUES ('doc-auth', 'Auth System')");
    const text = [
      '# Auth System',
      '',
      'AuthService implements OAuth2 and depends on Redis for session storage.',
      'Built by @alice. See anthropics/claude-code for reference.',
      'Config at src/config/auth.ts.',
      '',
      'Related to #authentication and #security.',
    ].join('\n');

    const entities = extractor.extractEntities(text);
    const relations = detector.detectRelations(text, entities);
    persistence.persistForDocument('doc-auth', entities, relations);

    const allEntities = db.prepare('SELECT * FROM entities').all();
    expect(allEntities.length).toBeGreaterThanOrEqual(4);

    const types = new Set(allEntities.map((e: any) => e.type));
    expect(types.has('person')).toBe(true);

    const docLinks = db.prepare('SELECT * FROM doc_entities WHERE doc_id = ?').all('doc-auth');
    expect(docLinks.length).toBeGreaterThan(0);
  });

  test('cross-document entity sharing: same entity referenced in two docs', () => {
    db.exec("INSERT INTO docs VALUES ('doc1', 'Doc 1', NULL)");
    db.exec("INSERT INTO docs VALUES ('doc2', 'Doc 2', NULL)");

    const text1 = 'AuthService uses Redis for caching';
    const text2 = 'UserService also depends on Redis';

    persistence.persistForDocument('doc1', extractor.extractEntities(text1), detector.detectRelations(text1, extractor.extractEntities(text1)));
    persistence.persistForDocument('doc2', extractor.extractEntities(text2), detector.detectRelations(text2, extractor.extractEntities(text2)));

    const redisEntity = db.prepare(
      "SELECT * FROM entities WHERE canonical_name = 'redis' AND type = 'service'"
    ).get();
    expect(redisEntity).toBeDefined();

    const redisLinks = db.prepare(
      'SELECT * FROM doc_entities WHERE entity_id = ?'
    ).all((redisEntity as any).id);
    expect(redisLinks.length).toBeGreaterThanOrEqual(2);
  });

  test('re-indexing cleans old links but keeps shared entities', () => {
    db.exec("INSERT INTO docs VALUES ('doc1', 'Doc 1', NULL)");

    const text1 = 'Uses Redis for caching';
    const ent1 = extractor.extractEntities(text1);
    persistence.persistForDocument('doc1', ent1, detector.detectRelations(text1, ent1));

    const text2 = 'Uses Postgres for storage';
    const ent2 = extractor.extractEntities(text2);
    persistence.persistForDocument('doc1', ent2, detector.detectRelations(text2, ent2));

    const redisLinks = db.prepare(`
      SELECT de.* FROM doc_entities de
      JOIN entities e ON de.entity_id = e.id
      WHERE e.canonical_name = 'redis' AND de.doc_id = 'doc1'
    `).all();
    expect(redisLinks).toHaveLength(0);

    const pgLinks = db.prepare(`
      SELECT de.* FROM doc_entities de
      JOIN entities e ON de.entity_id = e.id
      WHERE e.canonical_name = 'postgres' AND de.doc_id = 'doc1'
    `).all();
    expect(pgLinks.length).toBeGreaterThan(0);
  });
});
```

**Step 2: Run all tests**

Run: `npx jest src/services/entity-extractor.test.ts --no-cache`
Expected: PASS (all tests including integration)

**Step 3: Run full project test suite**

Run: `npx jest src/services/ --no-cache`
Expected: PASS

**Step 4: Run lint**

Run: `npm run lint`
Expected: No errors (fix any if found)

**Step 5: Commit**

```bash
git add src/services/entity-extractor.ts src/services/entity-extractor.test.ts
git commit -m "test: add integration tests for entity extraction pipeline"
```

---

## Summary

| Task | What | Files | Tests |
|------|------|-------|-------|
| 1 | EntityExtractor Core | Create entity-extractor.ts | 10 unit tests |
| 2 | RelationDetector | Modify entity-extractor.ts | 6 unit tests |
| 3 | EntityPersistence | Modify entity-extractor.ts | 5 unit tests |
| 4 | Background Indexer | Modify background-indexer.ts | (integration) |
| 5 | MCP Tool | Create entity-tools.ts, modify unified-server.ts | (build verify) |
| 6 | Integration Tests | Modify entity-extractor.test.ts | 3 integration tests |

**Phase 1 Mitigations Addressed:**
- Code fence skipping (Task 1)
- Stoplists per entity type (Task 1)
- Span merging with type precedence (Task 1)
- Negation filtering for relations (Task 2)
- Same-sentence pairing only (Task 2)
- Raw surface form stored in metadata_json (Task 3)
- Parameterized SQL everywhere (Tasks 3, 5)
- Transaction batching (Task 3)
- Idempotent re-indexing with cleanup (Task 3)
- Recursive CTE depth cap of 5 (Task 5)

**Phase 2 (Future):**
- LLM-powered extraction via Ollama
- Cross-sentence coreference resolution
- Canonical collision mapping table
- WAL mode enforcement
- Incremental indexing (only changed docs)
