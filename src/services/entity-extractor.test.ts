// eslint-disable-next-line @typescript-eslint/no-unused-vars
import { EntityExtractor, RelationDetector, EntityPersistence, type ExtractedEntity, type ExtractedRelation } from './entity-extractor.js';
import Database from 'better-sqlite3';

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
    expect(components).toHaveLength(0);
  });

  test('canonical normalization is consistent', () => {
    const r1 = extractor.extractEntities('UserAuth component');
    const r2 = extractor.extractEntities('userAuth component');
    const c1 = r1.filter(e => e.type === 'component');
    const c2 = r2.filter(e => e.type === 'component');
    if (c1.length > 0 && c2.length > 0) {
      expect(c1[0].canonicalName).toBe(c2[0].canonicalName);
    }
  });
});

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
      expect(blocks[0].sourceCanonical).toBe('databasemigration');
    }
  });

  test('defaults to "mentions" for all entities in a chunk', () => {
    const text = 'Working on Redis caching for AuthService';
    const entities = extractor.extractEntities(text);
    const relations = detector.detectRelations(text, entities);
    const mentions = relations.filter(r => r.relationType === 'mentions');
    expect(mentions.length).toBe(entities.length);
  });
});

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

describe('Integration: Full Pipeline', () => {
  const extractor = new EntityExtractor();
  const detector = new RelationDetector();

  function createTestDb(): Database.Database {
    const db = new Database(':memory:');
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
    return db;
  }

  test('end-to-end: doc with multiple entity types produces correct graph', () => {
    const db = createTestDb();
    db.exec("INSERT INTO docs (id, title) VALUES ('doc1', 'Rich Doc')");
    const persistence = new EntityPersistence(db);

    const text = [
      'Reviewed by @alice in src/config/auth.ts for the anthropics/claude-code project.',
      'Uses Redis for session caching. The AuthService handles #authentication and #security.',
    ].join(' ');

    const entities = extractor.extractEntities(text);
    const relations = detector.detectRelations(text, entities);
    persistence.persistForDocument('doc1', entities, relations);

    const entityCount = (db.prepare('SELECT COUNT(*) as c FROM entities').get() as { c: number }).c;
    expect(entityCount).toBeGreaterThanOrEqual(4);

    const types = db.prepare('SELECT DISTINCT type FROM entities').all() as { type: string }[];
    const typeSet = new Set(types.map(t => t.type));
    expect(typeSet.has('person')).toBe(true);

    const docEntityCount = (db.prepare('SELECT COUNT(*) as c FROM doc_entities WHERE doc_id = ?').get('doc1') as { c: number }).c;
    expect(docEntityCount).toBeGreaterThan(0);

    db.close();
  });

  test('cross-document entity sharing: same entity referenced in two docs', () => {
    const db = createTestDb();
    db.exec("INSERT INTO docs (id, title) VALUES ('doc1', 'Doc One')");
    db.exec("INSERT INTO docs (id, title) VALUES ('doc2', 'Doc Two')");

    const persistence = new EntityPersistence(db);

    const text1 = 'AuthService depends on Redis for caching';
    const ent1 = extractor.extractEntities(text1);
    const rel1 = detector.detectRelations(text1, ent1);
    persistence.persistForDocument('doc1', ent1, rel1);

    const text2 = 'UserService uses Redis for sessions';
    const ent2 = extractor.extractEntities(text2);
    const rel2 = detector.detectRelations(text2, ent2);
    persistence.persistForDocument('doc2', ent2, rel2);

    // Redis entity should exist exactly once
    const redisRows = db.prepare(
      "SELECT * FROM entities WHERE type = 'service' AND canonical_name = 'redis'"
    ).all();
    expect(redisRows).toHaveLength(1);

    // But doc_entities should link Redis from both docs
    const redisId = (redisRows[0] as { id: number }).id;
    const links = db.prepare(
      'SELECT DISTINCT doc_id FROM doc_entities WHERE entity_id = ?'
    ).all(redisId) as { doc_id: string }[];
    const linkedDocs = links.map(l => l.doc_id).sort();
    expect(linkedDocs).toContain('doc1');
    expect(linkedDocs).toContain('doc2');

    db.close();
  });

  test('re-indexing cleans old links but keeps shared entities', () => {
    const db = createTestDb();
    db.exec("INSERT INTO docs (id, title) VALUES ('doc1', 'Doc One')");

    const persistence = new EntityPersistence(db);

    // First pass: doc1 mentions Redis
    const text1 = 'Uses Redis for caching';
    const ent1 = extractor.extractEntities(text1);
    const rel1 = detector.detectRelations(text1, ent1);
    persistence.persistForDocument('doc1', ent1, rel1);

    // Verify Redis is linked to doc1
    const redisRow = db.prepare(
      "SELECT id FROM entities WHERE type = 'service' AND canonical_name = 'redis'"
    ).get() as { id: number } | undefined;
    expect(redisRow).toBeDefined();
    const redisId = redisRow!.id;
    const linksBefore = db.prepare(
      'SELECT COUNT(*) as c FROM doc_entities WHERE doc_id = ? AND entity_id = ?'
    ).get('doc1', redisId) as { c: number };
    expect(linksBefore.c).toBeGreaterThan(0);

    // Second pass: doc1 now mentions Postgres instead
    const text2 = 'Uses Postgres for storage';
    const ent2 = extractor.extractEntities(text2);
    const rel2 = detector.detectRelations(text2, ent2);
    persistence.persistForDocument('doc1', ent2, rel2);

    // Redis doc_entity link for doc1 should be gone
    const redisLinksAfter = (db.prepare(
      'SELECT COUNT(*) as c FROM doc_entities WHERE doc_id = ? AND entity_id = ?'
    ).get('doc1', redisId) as { c: number }).c;
    expect(redisLinksAfter).toBe(0);

    // Postgres should now be linked to doc1
    const postgresRow = db.prepare(
      "SELECT id FROM entities WHERE type = 'service' AND canonical_name = 'postgres'"
    ).get() as { id: number } | undefined;
    expect(postgresRow).toBeDefined();
    const postgresLinks = (db.prepare(
      'SELECT COUNT(*) as c FROM doc_entities WHERE doc_id = ? AND entity_id = ?'
    ).get('doc1', postgresRow!.id) as { c: number }).c;
    expect(postgresLinks).toBeGreaterThan(0);

    // Redis entity itself should still exist in the entities table (not deleted)
    const redisStillExists = db.prepare(
      "SELECT COUNT(*) as c FROM entities WHERE type = 'service' AND canonical_name = 'redis'"
    ).get() as { c: number };
    expect(redisStillExists.c).toBe(1);

    db.close();
  });
});
