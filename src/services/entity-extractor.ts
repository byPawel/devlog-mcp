/**
 * EntityExtractor — regex-based entity extraction with span merging
 *
 * Extracts 6 entity types from text: person, project, file, service,
 * component, concept. Handles code fence skipping, overlapping span
 * resolution via type precedence, and canonical name normalization
 * for deduplication against the entities table.
 */

// ═══════════════════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════════════════

export type EntityType = 'person' | 'project' | 'file' | 'service' | 'component' | 'concept';

export interface ExtractedEntity {
  type: EntityType;
  name: string;
  canonicalName: string;
  confidence: number;
  start: number;
  end: number;
  context: string;
}

interface RawSpan {
  type: EntityType;
  name: string;
  start: number;
  end: number;
  confidence: number;
}

interface CodeFenceRange {
  start: number;
  end: number;
}

// ═══════════════════════════════════════════════════════════════════════════
// Constants
// ═══════════════════════════════════════════════════════════════════════════

/** Higher number = higher priority when spans overlap */
const TYPE_PRECEDENCE: Record<EntityType, number> = {
  file: 6,
  project: 5,
  service: 4,
  person: 3,
  component: 2,
  concept: 1,
};

const COMPONENT_STOPLIST = new Set([
  'string', 'object', 'array', 'number', 'boolean', 'null', 'undefined',
  'function', 'class', 'interface', 'type', 'enum', 'const', 'let', 'var',
  'import', 'export', 'default', 'return', 'async', 'await', 'promise',
  'error', 'date', 'map', 'set', 'json', 'buffer', 'event', 'node',
  'true', 'false', 'this', 'super', 'new', 'delete', 'typeof', 'void',
  'try', 'catch', 'finally', 'throw', 'if', 'else', 'switch', 'case',
  'for', 'while', 'do', 'break', 'continue', 'with', 'yield',
]);

const SERVICE_GAZETTEER = new Set([
  'redis', 'postgres', 'postgresql', 'mysql', 'mongodb', 'mongo',
  'elasticsearch', 'kafka', 'rabbitmq', 'nginx', 'docker', 'kubernetes', 'k8s',
  'aws', 'gcp', 'azure', 'cloudflare', 's3', 'dynamodb', 'sqlite',
  'lancedb', 'chromadb', 'pinecone', 'weaviate', 'qdrant',
  'ollama', 'openai', 'anthropic',
  'github', 'gitlab', 'vercel', 'supabase', 'firebase',
  'stripe', 'twilio', 'sendgrid',
  'datadog', 'grafana', 'prometheus', 'sentry',
  'terraform', 'pulumi',
]);

// ═══════════════════════════════════════════════════════════════════════════
// EntityExtractor
// ═══════════════════════════════════════════════════════════════════════════

export class EntityExtractor {
  /**
   * Extract all entities from the given text.
   *
   * Pipeline: run 6 extractors -> filter code fences -> merge overlapping
   * spans -> deduplicate by canonical name -> attach context snippets.
   */
  extractEntities(text: string): ExtractedEntity[] {
    const codeFences = this.findCodeFenceRanges(text);

    // Run all 6 extractors
    const rawSpans: RawSpan[] = [
      ...this.extractPersons(text),
      ...this.extractFiles(text),
      ...this.extractProjects(text),
      ...this.extractServices(text),
      ...this.extractComponents(text),
      ...this.extractConcepts(text),
    ];

    // Filter spans inside code fences
    const filtered = rawSpans.filter(span => !this.isInsideCodeFence(span, codeFences));

    // Merge overlapping spans (higher precedence wins)
    const merged = this.mergeSpans(filtered);

    // Deduplicate by (type, canonicalName)
    const deduped = this.deduplicateEntities(merged);

    // Attach context snippets and return
    return deduped.map(span => ({
      type: span.type,
      name: span.name,
      canonicalName: this.canonicalize(span.name, span.type),
      confidence: span.confidence,
      start: span.start,
      end: span.end,
      context: text.slice(Math.max(0, span.start - 40), span.end + 40),
    }));
  }

  /**
   * Normalize a raw entity name to its canonical form for dedup.
   *
   * - file: strip leading './', lowercase
   * - project: lowercase
   * - person: strip '@', lowercase
   * - concept: strip '#', lowercase
   * - default (component, service): lowercase
   */
  canonicalize(name: string, type: EntityType): string {
    switch (type) {
      case 'file':
        return name.replace(/^\.\//, '').toLowerCase();
      case 'project':
        return name.toLowerCase();
      case 'person':
        return name.replace(/^@/, '').toLowerCase();
      case 'concept':
        return name.replace(/^#/, '').toLowerCase();
      default:
        return name.toLowerCase();
    }
  }

  // ═════════════════════════════════════════════════════════════════════════
  // Code fence detection
  // ═════════════════════════════════════════════════════════════════════════

  private findCodeFenceRanges(text: string): CodeFenceRange[] {
    const ranges: CodeFenceRange[] = [];
    const re = /```[\s\S]*?```/g;
    let match: RegExpExecArray | null;
    while ((match = re.exec(text)) !== null) {
      ranges.push({ start: match.index, end: match.index + match[0].length });
    }
    return ranges;
  }

  private isInsideCodeFence(span: RawSpan, fences: CodeFenceRange[]): boolean {
    return fences.some(f => span.start >= f.start && span.end <= f.end);
  }

  // ═════════════════════════════════════════════════════════════════════════
  // Individual extractors
  // ═════════════════════════════════════════════════════════════════════════

  private extractPersons(text: string): RawSpan[] {
    const spans: RawSpan[] = [];

    // @username mentions
    const atRe = /@([a-zA-Z][\w-]{1,38})\b/g;
    let match: RegExpExecArray | null;
    while ((match = atRe.exec(text)) !== null) {
      spans.push({
        type: 'person',
        name: match[0],
        start: match.index,
        end: match.index + match[0].length,
        confidence: 0.85,
      });
    }

    // "by/from/with Name Name" pattern
    const namedRe = /\b(?:by|from|with)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)\b/g;
    while ((match = namedRe.exec(text)) !== null) {
      const nameStart = match.index + match[0].indexOf(match[1]);
      spans.push({
        type: 'person',
        name: match[1],
        start: nameStart,
        end: nameStart + match[1].length,
        confidence: 0.7,
      });
    }

    return spans;
  }

  private extractFiles(text: string): RawSpan[] {
    const spans: RawSpan[] = [];

    // File paths: optional ./ or ../ prefix, at least one dir segment, file extension
    const fileRe = /(?:\.\.?\/)?(?:[\w@.-]+\/)+[\w.-]+\.[\w]+/g;
    let match: RegExpExecArray | null;
    while ((match = fileRe.exec(text)) !== null) {
      spans.push({
        type: 'file',
        name: match[0],
        start: match.index,
        end: match.index + match[0].length,
        confidence: 0.85,
      });
    }

    // import/require relative paths
    const importRe = /(?:from|require\()\s*['"](\.[^'"]+)['"]/g;
    while ((match = importRe.exec(text)) !== null) {
      const pathStart = match.index + match[0].indexOf(match[1]);
      spans.push({
        type: 'file',
        name: match[1],
        start: pathStart,
        end: pathStart + match[1].length,
        confidence: 0.85,
      });
    }

    return spans;
  }

  private extractProjects(text: string): RawSpan[] {
    const spans: RawSpan[] = [];
    const re = /\b([a-zA-Z][\w.-]*\/[a-zA-Z][\w.-]*)\b/g;
    let match: RegExpExecArray | null;
    while ((match = re.exec(text)) !== null) {
      const value = match[1];
      // Only if exactly 2 segments (one slash), and no file extension
      const segments = value.split('/');
      if (segments.length !== 2) continue;
      if (/\.\w+$/.test(segments[1])) continue;
      spans.push({
        type: 'project',
        name: value,
        start: match.index,
        end: match.index + value.length,
        confidence: 0.7,
      });
    }
    return spans;
  }

  private extractServices(text: string): RawSpan[] {
    const spans: RawSpan[] = [];

    // Word boundary match against gazetteer (case-insensitive)
    const re = /\b(\w+)\b/g;
    let match: RegExpExecArray | null;
    while ((match = re.exec(text)) !== null) {
      if (SERVICE_GAZETTEER.has(match[1].toLowerCase())) {
        spans.push({
          type: 'service',
          name: match[1],
          start: match.index,
          end: match.index + match[1].length,
          confidence: 0.85,
        });
      }
    }

    // URL patterns (extract hostname as service hint)
    const urlRe = /https?:\/\/([\w.-]+)/g;
    while ((match = urlRe.exec(text)) !== null) {
      const hostStart = match.index + match[0].indexOf(match[1]);
      spans.push({
        type: 'service',
        name: match[1],
        start: hostStart,
        end: hostStart + match[1].length,
        confidence: 0.7,
      });
    }

    return spans;
  }

  private extractComponents(text: string): RawSpan[] {
    const spans: RawSpan[] = [];
    // PascalCase with at least 2 words (e.g., AuthService, UserProvider)
    const re = /\b([A-Z][a-z]+(?:[A-Z][a-z]+)+)\b/g;
    let match: RegExpExecArray | null;
    while ((match = re.exec(text)) !== null) {
      const lower = match[1].toLowerCase();
      // Filter stoplist words and service gazetteer entries
      if (COMPONENT_STOPLIST.has(lower)) continue;
      if (SERVICE_GAZETTEER.has(lower)) continue;
      spans.push({
        type: 'component',
        name: match[1],
        start: match.index,
        end: match.index + match[1].length,
        confidence: 0.7,
      });
    }
    return spans;
  }

  private extractConcepts(text: string): RawSpan[] {
    const spans: RawSpan[] = [];

    // Hashtag mentions
    const hashRe = /#([a-zA-Z][\w-]*)\b/g;
    let match: RegExpExecArray | null;
    while ((match = hashRe.exec(text)) !== null) {
      spans.push({
        type: 'concept',
        name: match[0],
        start: match.index,
        end: match.index + match[0].length,
        confidence: 0.85,
      });
    }

    // "implements/about/regarding <word>" pattern
    const keywordRe = /\b(?:implements|about|regarding)\s+([a-zA-Z][\w-]*)\b/gi;
    while ((match = keywordRe.exec(text)) !== null) {
      const wordStart = match.index + match[0].indexOf(match[1]);
      spans.push({
        type: 'concept',
        name: match[1],
        start: wordStart,
        end: wordStart + match[1].length,
        confidence: 0.7,
      });
    }

    return spans;
  }

  // ═════════════════════════════════════════════════════════════════════════
  // Span merging and deduplication
  // ═════════════════════════════════════════════════════════════════════════

  /**
   * Resolve overlapping spans. When two spans overlap, keep the one with
   * higher type precedence; if tied, keep the longer span.
   */
  private mergeSpans(spans: RawSpan[]): RawSpan[] {
    if (spans.length === 0) return [];

    // Sort by start position, then by precedence descending
    const sorted = [...spans].sort((a, b) => {
      if (a.start !== b.start) return a.start - b.start;
      return TYPE_PRECEDENCE[b.type] - TYPE_PRECEDENCE[a.type];
    });

    const result: RawSpan[] = [sorted[0]];

    for (let i = 1; i < sorted.length; i++) {
      const current = sorted[i];
      const last = result[result.length - 1];

      // No overlap: current starts at or after last ends
      if (current.start >= last.end) {
        result.push(current);
        continue;
      }

      // Overlap: keep the one with higher precedence, or longer span if tied
      const lastPrec = TYPE_PRECEDENCE[last.type];
      const currPrec = TYPE_PRECEDENCE[current.type];

      if (currPrec > lastPrec) {
        // Current wins — replace last
        result[result.length - 1] = current;
      } else if (currPrec === lastPrec) {
        // Same precedence — keep longer span
        const lastLen = last.end - last.start;
        const currLen = current.end - current.start;
        if (currLen > lastLen) {
          result[result.length - 1] = current;
        }
        // Otherwise keep last (already in result)
      }
      // else: last has higher precedence, keep it (do nothing)
    }

    return result;
  }

  /**
   * Deduplicate entities by (type, canonicalName), keeping the one with
   * the highest confidence score.
   */
  private deduplicateEntities(spans: RawSpan[]): RawSpan[] {
    const seen = new Map<string, RawSpan>();
    for (const span of spans) {
      const canonical = this.canonicalize(span.name, span.type);
      const key = `${span.type}:${canonical}`;
      const existing = seen.get(key);
      if (!existing || span.confidence > existing.confidence) {
        seen.set(key, span);
      }
    }
    return [...seen.values()];
  }
}
