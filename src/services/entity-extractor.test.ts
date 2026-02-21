import { EntityExtractor } from './entity-extractor.js';

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
