import {
  OllamaInferenceService,
  LlmEntityExtractor,
  parseLlmEntities,
  parseLlmRelations,
  mergeEntities,
  mergeRelations,
} from './llm-entity-extractor.js';
import { EntityExtractor } from './entity-extractor.js';
import type { ExtractedEntity, ExtractedRelation } from './entity-extractor.js';

// ═══════════════════════════════════════════════════════════════════════════
// Mock fetch globally
// ═══════════════════════════════════════════════════════════════════════════

const originalFetch = globalThis.fetch;

function mockFetch(responseBody: unknown, ok = true, status = 200): void {
  globalThis.fetch = jest.fn().mockResolvedValue({
    ok,
    status,
    statusText: ok ? 'OK' : 'Internal Server Error',
    json: async () => responseBody,
    text: async () => JSON.stringify(responseBody),
  });
}

afterEach(() => {
  globalThis.fetch = originalFetch;
});

// ═══════════════════════════════════════════════════════════════════════════
// OllamaInferenceService
// ═══════════════════════════════════════════════════════════════════════════

describe('OllamaInferenceService', () => {
  test('chat sends correct request and returns content', async () => {
    mockFetch({
      message: { content: '{"entities": [], "relations": []}' },
    });

    const service = new OllamaInferenceService('http://test:11434', 'test-model');
    const result = await service.chat('test input', 'system prompt');

    expect(result).toBe('{"entities": [], "relations": []}');
    expect(globalThis.fetch).toHaveBeenCalledWith(
      'http://test:11434/api/chat',
      expect.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    const body = JSON.parse(
      (globalThis.fetch as jest.Mock).mock.calls[0][1].body,
    );
    expect(body.model).toBe('test-model');
    expect(body.messages).toHaveLength(2);
    expect(body.format).toBe('json');
    expect(body.stream).toBe(false);
  });

  test('chat throws on non-OK response', async () => {
    mockFetch({ error: 'model not found' }, false, 404);

    const service = new OllamaInferenceService('http://test:11434', 'test-model');
    await expect(service.chat('test', 'prompt')).rejects.toThrow('Ollama inference failed: 404');
  });

  test('healthCheck returns true when model is available', async () => {
    mockFetch({
      models: [{ name: 'llama3.2:latest' }, { name: 'nomic-embed-text:latest' }],
    });

    const service = new OllamaInferenceService('http://test:11434', 'llama3.2');
    expect(await service.healthCheck()).toBe(true);
  });

  test('healthCheck returns false when model is missing', async () => {
    mockFetch({
      models: [{ name: 'nomic-embed-text:latest' }],
    });

    const service = new OllamaInferenceService('http://test:11434', 'llama3.2');
    expect(await service.healthCheck()).toBe(false);
  });

  test('healthCheck returns false on network error', async () => {
    globalThis.fetch = jest.fn().mockRejectedValue(new Error('ECONNREFUSED'));

    const service = new OllamaInferenceService('http://test:11434', 'llama3.2');
    expect(await service.healthCheck()).toBe(false);
  });

  test('getModel returns configured model', () => {
    const service = new OllamaInferenceService('http://test:11434', 'my-model');
    expect(service.getModel()).toBe('my-model');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// parseLlmEntities
// ═══════════════════════════════════════════════════════════════════════════

describe('parseLlmEntities', () => {
  const extractor = new EntityExtractor();

  test('parses valid entities', () => {
    const raw = {
      entities: [
        { name: '@alice', type: 'person', description: 'team lead' },
        { name: 'Redis', type: 'service', description: 'cache layer' },
      ],
    };

    const result = parseLlmEntities(raw, extractor);
    expect(result).toHaveLength(2);
    expect(result[0].name).toBe('@alice');
    expect(result[0].type).toBe('person');
    expect(result[0].canonicalName).toBe('alice');
    expect(result[0].confidence).toBe(0.9);
    expect(result[0].start).toBe(-1);
    expect(result[0].context).toBe('team lead');
    expect(result[1].name).toBe('Redis');
    expect(result[1].canonicalName).toBe('redis');
  });

  test('drops entries with invalid type', () => {
    const raw = {
      entities: [
        { name: 'foo', type: 'unknown_type' },
        { name: 'bar', type: 'person' },
      ],
    };

    const result = parseLlmEntities(raw, extractor);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('bar');
  });

  test('drops entries with missing name', () => {
    const raw = {
      entities: [
        { type: 'person' },
        { name: '', type: 'person' },
        { name: 'valid', type: 'concept' },
      ],
    };

    const result = parseLlmEntities(raw, extractor);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('valid');
  });

  test('handles missing entities array', () => {
    expect(parseLlmEntities({}, extractor)).toEqual([]);
    expect(parseLlmEntities({ entities: 'not-an-array' as unknown as unknown[] }, extractor)).toEqual([]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// parseLlmRelations
// ═══════════════════════════════════════════════════════════════════════════

describe('parseLlmRelations', () => {
  const entities: ExtractedEntity[] = [
    { type: 'component', name: 'AuthService', canonicalName: 'authservice', confidence: 0.9, start: -1, end: -1, context: '' },
    { type: 'service', name: 'Redis', canonicalName: 'redis', confidence: 0.9, start: -1, end: -1, context: '' },
    { type: 'person', name: '@alice', canonicalName: 'alice', confidence: 0.9, start: -1, end: -1, context: '' },
  ];

  test('parses valid relations', () => {
    const raw = {
      relations: [
        { source: 'AuthService', target: 'Redis', type: 'depends_on' },
        { source: 'AuthService', target: '@alice', type: 'authored_by' },
      ],
    };

    const result = parseLlmRelations(raw, entities);
    expect(result).toHaveLength(2);
    expect(result[0].sourceCanonical).toBe('authservice');
    expect(result[0].targetCanonical).toBe('redis');
    expect(result[0].relationType).toBe('depends_on');
    expect(result[0].confidence).toBe(0.9);
    expect(result[1].relationType).toBe('authored_by');
  });

  test('resolves by canonical name too', () => {
    const raw = {
      relations: [
        { source: 'authservice', target: 'redis', type: 'depends_on' },
      ],
    };

    const result = parseLlmRelations(raw, entities);
    expect(result).toHaveLength(1);
  });

  test('drops relations with unknown entities', () => {
    const raw = {
      relations: [
        { source: 'AuthService', target: 'UnknownThing', type: 'depends_on' },
      ],
    };

    const result = parseLlmRelations(raw, entities);
    expect(result).toHaveLength(0);
  });

  test('drops relations with invalid type', () => {
    const raw = {
      relations: [
        { source: 'AuthService', target: 'Redis', type: 'invalid_rel' },
      ],
    };

    const result = parseLlmRelations(raw, entities);
    expect(result).toHaveLength(0);
  });

  test('handles missing relations array', () => {
    expect(parseLlmRelations({}, entities)).toEqual([]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// mergeEntities
// ═══════════════════════════════════════════════════════════════════════════

describe('mergeEntities', () => {
  test('merges without duplicates, LLM wins on conflict', () => {
    const regexEntities: ExtractedEntity[] = [
      { type: 'service', name: 'Redis', canonicalName: 'redis', confidence: 0.85, start: 10, end: 15, context: 'regex' },
      { type: 'component', name: 'AuthService', canonicalName: 'authservice', confidence: 0.85, start: 20, end: 31, context: 'regex' },
    ];

    const llmEntities: ExtractedEntity[] = [
      { type: 'service', name: 'Redis', canonicalName: 'redis', confidence: 0.9, start: -1, end: -1, context: 'cache layer' },
      { type: 'person', name: '@bob', canonicalName: 'bob', confidence: 0.9, start: -1, end: -1, context: 'developer' },
    ];

    const merged = mergeEntities(regexEntities, llmEntities);
    expect(merged).toHaveLength(3);

    const redis = merged.find((e) => e.canonicalName === 'redis')!;
    expect(redis.confidence).toBe(0.9); // LLM wins
    expect(redis.start).toBe(10); // Preserved from regex
    expect(redis.context).toBe('cache layer'); // LLM description

    const auth = merged.find((e) => e.canonicalName === 'authservice')!;
    expect(auth.confidence).toBe(0.7); // Regex confidence

    const bob = merged.find((e) => e.canonicalName === 'bob')!;
    expect(bob.confidence).toBe(0.9); // LLM-only
  });

  test('handles empty LLM results', () => {
    const regexEntities: ExtractedEntity[] = [
      { type: 'service', name: 'Redis', canonicalName: 'redis', confidence: 0.85, start: 0, end: 5, context: '' },
    ];

    const merged = mergeEntities(regexEntities, []);
    expect(merged).toHaveLength(1);
    expect(merged[0].confidence).toBe(0.7);
  });

  test('handles empty regex results', () => {
    const llmEntities: ExtractedEntity[] = [
      { type: 'service', name: 'Redis', canonicalName: 'redis', confidence: 0.9, start: -1, end: -1, context: '' },
    ];

    const merged = mergeEntities([], llmEntities);
    expect(merged).toHaveLength(1);
    expect(merged[0].confidence).toBe(0.9);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// mergeRelations
// ═══════════════════════════════════════════════════════════════════════════

describe('mergeRelations', () => {
  test('merges without duplicates, LLM wins on conflict', () => {
    const regexRelations: ExtractedRelation[] = [
      {
        relationType: 'depends_on',
        sourceCanonical: 'authservice', sourceType: 'component',
        targetCanonical: 'redis', targetType: 'service',
        confidence: 0.7, evidence: 'regex: uses',
      },
    ];

    const llmRelations: ExtractedRelation[] = [
      {
        relationType: 'depends_on',
        sourceCanonical: 'authservice', sourceType: 'component',
        targetCanonical: 'redis', targetType: 'service',
        confidence: 0.9, evidence: 'LLM: AuthService depends_on Redis',
      },
      {
        relationType: 'authored_by',
        sourceCanonical: 'authservice', sourceType: 'component',
        targetCanonical: 'alice', targetType: 'person',
        confidence: 0.9, evidence: 'LLM: AuthService authored_by alice',
      },
    ];

    const merged = mergeRelations(regexRelations, llmRelations);
    expect(merged).toHaveLength(2);

    const dep = merged.find((r) => r.relationType === 'depends_on')!;
    expect(dep.confidence).toBe(0.9); // LLM wins
    expect(dep.evidence).toContain('LLM');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// LlmEntityExtractor (integration)
// ═══════════════════════════════════════════════════════════════════════════

describe('LlmEntityExtractor', () => {
  test('extract merges regex and LLM results on success', async () => {
    const llmResponse = {
      entities: [
        { name: 'Redis', type: 'service', description: 'in-memory cache' },
        { name: '@bob', type: 'person', description: 'maintainer' },
      ],
      relations: [
        { source: 'AuthService', target: 'Redis', type: 'depends_on' },
      ],
    };

    mockFetch({
      message: { content: JSON.stringify(llmResponse) },
    });

    const inferenceService = new OllamaInferenceService('http://test:11434', 'test-model');
    const extractor = new LlmEntityExtractor(inferenceService);

    const result = await extractor.extract('AuthService depends on Redis, maintained by @bob');

    expect(result.source).toBe('hybrid');
    expect(result.llmModel).toBe('test-model');
    expect(result.entities.length).toBeGreaterThanOrEqual(2);

    const redis = result.entities.find((e) => e.canonicalName === 'redis');
    expect(redis).toBeDefined();
    expect(redis!.confidence).toBe(0.9); // LLM confidence
  });

  test('extract falls back to regex-only on LLM failure', async () => {
    mockFetch({ error: 'model not found' }, false, 404);

    const inferenceService = new OllamaInferenceService('http://test:11434', 'test-model');
    const extractor = new LlmEntityExtractor(inferenceService);

    const result = await extractor.extract('AuthService uses Redis for caching');

    expect(result.source).toBe('regex-only');
    expect(result.entities.length).toBeGreaterThan(0);
    expect(result.entities[0].confidence).toBe(0.7); // Regex confidence
    expect(result.llmModel).toBeUndefined();
  });

  test('extract falls back on malformed LLM JSON', async () => {
    mockFetch({
      message: { content: 'not valid json at all' },
    });

    const inferenceService = new OllamaInferenceService('http://test:11434', 'test-model');
    const extractor = new LlmEntityExtractor(inferenceService);

    const result = await extractor.extract('AuthService uses Redis');

    expect(result.source).toBe('regex-only');
    expect(result.entities.length).toBeGreaterThan(0);
  });

  test('healthCheck delegates to inference service', async () => {
    mockFetch({
      models: [{ name: 'llama3.2:latest' }],
    });

    const inferenceService = new OllamaInferenceService('http://test:11434', 'llama3.2');
    const extractor = new LlmEntityExtractor(inferenceService);

    expect(await extractor.healthCheck()).toBe(true);
  });
});
