/**
 * LLM-Powered Entity Extractor (Phase 3)
 *
 * Uses Ollama inference to extract richer entities than regex alone.
 * On-demand via tool call. Merges with regex results.
 * Confidence scoring: regex = 0.7, LLM = 0.9.
 */

import {
  EntityExtractor,
  RelationDetector,
  type ExtractedEntity,
  type ExtractedRelation,
  type EntityType,
  type RelationType,
} from './entity-extractor.js';

// ═══════════════════════════════════════════════════════════════════════════
// Constants
// ═══════════════════════════════════════════════════════════════════════════

const OLLAMA_URL = process.env.OLLAMA_URL || 'http://localhost:11434';
const INFERENCE_MODEL = process.env.OLLAMA_INFERENCE_MODEL || 'llama3.2';

const REGEX_CONFIDENCE = 0.7;
const LLM_CONFIDENCE = 0.9;

const VALID_ENTITY_TYPES = new Set<EntityType>([
  'person', 'project', 'file', 'service', 'component', 'concept',
]);

const VALID_RELATION_TYPES = new Set<RelationType>([
  'mentions', 'implements', 'depends_on', 'blocks', 'authored_by',
]);

const EXTRACTION_SYSTEM_PROMPT = `You are an entity extraction system for a developer knowledge graph.
Extract structured entities and relations from the given text.

Output ONLY valid JSON with this schema:
{
  "entities": [
    {
      "name": "exact text as it appears",
      "type": "person|project|file|service|component|concept",
      "description": "brief description"
    }
  ],
  "relations": [
    {
      "source": "entity name",
      "target": "entity name",
      "type": "mentions|implements|depends_on|blocks|authored_by"
    }
  ]
}

Entity types:
- person: People, usernames (@alice), team members
- project: Repositories (org/repo), packages
- file: File paths (src/foo.ts), imports
- service: External services (Redis, Postgres, Docker, AWS, etc.)
- component: Code components, classes, modules (PascalCase)
- concept: Abstract concepts, topics, features (#auth, authentication)

Relation types:
- mentions: Entity appears in context (default)
- implements: Subject implements/builds target
- depends_on: Subject depends on/requires/uses target
- blocks: Subject blocks target
- authored_by: Subject was authored/created by target

Be thorough but precise. Only include entities clearly mentioned in the text.`;

// ═══════════════════════════════════════════════════════════════════════════
// OllamaInferenceService
// ═══════════════════════════════════════════════════════════════════════════

export class OllamaInferenceService {
  private ollamaUrl: string;
  private model: string;

  constructor(ollamaUrl = OLLAMA_URL, model = INFERENCE_MODEL) {
    this.ollamaUrl = ollamaUrl;
    this.model = model;
  }

  async chat(userMessage: string, systemPrompt: string): Promise<string> {
    const response = await fetch(`${this.ollamaUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: this.model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userMessage },
        ],
        format: 'json',
        stream: false,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Ollama inference failed: ${response.status} - ${errorText.slice(0, 200)}`);
    }

    const data = (await response.json()) as { message: { content: string } };
    return data.message.content;
  }

  async healthCheck(): Promise<boolean> {
    try {
      const response = await fetch(`${this.ollamaUrl}/api/tags`);
      if (!response.ok) return false;
      const data = (await response.json()) as { models: { name: string }[] };
      return data.models.some((m) => m.name.includes(this.model));
    } catch {
      return false;
    }
  }

  getModel(): string {
    return this.model;
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// LLM Response Parsing
// ═══════════════════════════════════════════════════════════════════════════

interface LlmEntityRaw {
  name?: unknown;
  type?: unknown;
  description?: unknown;
}

interface LlmRelationRaw {
  source?: unknown;
  target?: unknown;
  type?: unknown;
}

interface LlmResponseRaw {
  entities?: unknown[];
  relations?: unknown[];
}

/**
 * Parse and validate LLM JSON response into ExtractedEntity[].
 * Silently drops malformed entries.
 */
export function parseLlmEntities(
  raw: LlmResponseRaw,
  regexExtractor: EntityExtractor,
): ExtractedEntity[] {
  if (!Array.isArray(raw.entities)) return [];

  const results: ExtractedEntity[] = [];
  for (const item of raw.entities as LlmEntityRaw[]) {
    const name = typeof item.name === 'string' ? item.name.trim() : '';
    const type = typeof item.type === 'string' ? item.type.trim().toLowerCase() : '';

    if (!name || !VALID_ENTITY_TYPES.has(type as EntityType)) continue;

    const canonicalName = regexExtractor.canonicalize(name, type as EntityType);

    results.push({
      type: type as EntityType,
      name,
      canonicalName,
      confidence: LLM_CONFIDENCE,
      start: -1, // LLM doesn't provide span positions
      end: -1,
      context: typeof item.description === 'string' ? item.description : '',
    });
  }

  return results;
}

/**
 * Parse and validate LLM JSON response into ExtractedRelation[].
 * Resolves entity names to canonical names using the entity list.
 */
export function parseLlmRelations(
  raw: LlmResponseRaw,
  entities: ExtractedEntity[],
): ExtractedRelation[] {
  if (!Array.isArray(raw.relations)) return [];

  // Build a lookup: name -> entity (case-insensitive)
  const nameToEntity = new Map<string, ExtractedEntity>();
  for (const e of entities) {
    nameToEntity.set(e.name.toLowerCase(), e);
    nameToEntity.set(e.canonicalName.toLowerCase(), e);
  }

  const results: ExtractedRelation[] = [];
  for (const item of raw.relations as LlmRelationRaw[]) {
    const sourceName = typeof item.source === 'string' ? item.source.trim() : '';
    const targetName = typeof item.target === 'string' ? item.target.trim() : '';
    const relType = typeof item.type === 'string' ? item.type.trim().toLowerCase() : '';

    if (!sourceName || !targetName || !VALID_RELATION_TYPES.has(relType as RelationType)) continue;

    const sourceEntity = nameToEntity.get(sourceName.toLowerCase());
    const targetEntity = nameToEntity.get(targetName.toLowerCase());

    if (!sourceEntity || !targetEntity) continue;

    results.push({
      relationType: relType as RelationType,
      sourceCanonical: sourceEntity.canonicalName,
      sourceType: sourceEntity.type,
      targetCanonical: targetEntity.canonicalName,
      targetType: targetEntity.type,
      confidence: LLM_CONFIDENCE,
      evidence: `LLM: ${sourceName} ${relType} ${targetName}`,
    });
  }

  return results;
}

// ═══════════════════════════════════════════════════════════════════════════
// Merge Logic
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Merge regex-extracted and LLM-extracted entities.
 * LLM wins on conflict (higher confidence). Deduplicates by type+canonical.
 */
export function mergeEntities(
  regexEntities: ExtractedEntity[],
  llmEntities: ExtractedEntity[],
): ExtractedEntity[] {
  const map = new Map<string, ExtractedEntity>();

  // Add regex entities first (lower confidence)
  for (const e of regexEntities) {
    const key = `${e.type}:${e.canonicalName}`;
    map.set(key, { ...e, confidence: REGEX_CONFIDENCE });
  }

  // LLM entities overwrite on conflict (higher confidence)
  for (const e of llmEntities) {
    const key = `${e.type}:${e.canonicalName}`;
    const existing = map.get(key);
    if (!existing || existing.confidence < e.confidence) {
      // Preserve span positions from regex if LLM doesn't have them
      if (e.start === -1 && existing) {
        map.set(key, { ...e, start: existing.start, end: existing.end });
      } else {
        map.set(key, e);
      }
    }
  }

  return Array.from(map.values());
}

/**
 * Merge regex-detected and LLM-detected relations.
 * Deduplicates by source+target+type, keeping highest confidence.
 */
export function mergeRelations(
  regexRelations: ExtractedRelation[],
  llmRelations: ExtractedRelation[],
): ExtractedRelation[] {
  const map = new Map<string, ExtractedRelation>();

  for (const r of regexRelations) {
    const key = `${r.sourceCanonical}:${r.targetCanonical}:${r.relationType}`;
    map.set(key, { ...r, confidence: REGEX_CONFIDENCE });
  }

  for (const r of llmRelations) {
    const key = `${r.sourceCanonical}:${r.targetCanonical}:${r.relationType}`;
    const existing = map.get(key);
    if (!existing || existing.confidence < r.confidence) {
      map.set(key, r);
    }
  }

  return Array.from(map.values());
}

// ═══════════════════════════════════════════════════════════════════════════
// LlmEntityExtractor (main class)
// ═══════════════════════════════════════════════════════════════════════════

export interface DeepExtractionResult {
  entities: ExtractedEntity[];
  relations: ExtractedRelation[];
  source: 'hybrid' | 'regex-only';
  llmModel?: string;
}

export class LlmEntityExtractor {
  private inferenceService: OllamaInferenceService;
  private regexExtractor: EntityExtractor;
  private relationDetector: RelationDetector;

  constructor(inferenceService?: OllamaInferenceService) {
    this.inferenceService = inferenceService || new OllamaInferenceService();
    this.regexExtractor = new EntityExtractor();
    this.relationDetector = new RelationDetector();
  }

  /**
   * Extract entities using both regex and LLM, then merge.
   * Falls back to regex-only if LLM is unavailable or fails.
   */
  async extract(text: string): Promise<DeepExtractionResult> {
    // Always run regex extraction first
    const regexEntities = this.regexExtractor.extractEntities(text);
    const regexRelations = this.relationDetector.detectRelations(text, regexEntities);

    // Attempt LLM extraction
    try {
      const rawJson = await this.inferenceService.chat(
        `Extract entities and relations from this text:\n\n${text}`,
        EXTRACTION_SYSTEM_PROMPT,
      );

      const parsed = JSON.parse(rawJson) as LlmResponseRaw;
      const llmEntities = parseLlmEntities(parsed, this.regexExtractor);
      const llmRelations = parseLlmRelations(parsed, llmEntities);

      const mergedEntities = mergeEntities(regexEntities, llmEntities);
      const mergedRelations = mergeRelations(regexRelations, llmRelations);

      return {
        entities: mergedEntities,
        relations: mergedRelations,
        source: 'hybrid',
        llmModel: this.inferenceService.getModel(),
      };
    } catch (err) {
      console.error('[LlmEntityExtractor] LLM extraction failed, using regex only:', err);
      return {
        entities: regexEntities.map((e) => ({ ...e, confidence: REGEX_CONFIDENCE })),
        relations: regexRelations.map((r) => ({ ...r, confidence: REGEX_CONFIDENCE })),
        source: 'regex-only',
      };
    }
  }

  async healthCheck(): Promise<boolean> {
    return this.inferenceService.healthCheck();
  }
}
