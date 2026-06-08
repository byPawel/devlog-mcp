/**
 * Context Inspector MCP Tools
 *
 * File-based (JSONL) tools for storing and reading context-inspector events
 * emitted by a producer (e.g. tachi-agent's context-inspect layer). Events are
 * appended to one JSONL file per UTC day under the dokoro workspace:
 *
 *   <DOKORO_PATH>/context-inspect/<YYYY-MM-DD>.jsonl
 *
 * Tools:
 * - dokoro_context_log:    append a single context_inspect event
 * - dokoro_context_last:   read the N most recent events (newest first)
 * - dokoro_context_search: case-insensitive substring search over stored events
 *
 * No database — these are plain append-only JSONL files. Malformed lines are
 * tolerated (skipped) on read so a single bad write never breaks reads.
 */

import { z } from 'zod';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { ToolDefinition } from './registry.js';
import { DOKORO_PATH } from '../shared/dokoro-utils.js';

/** Directory holding the per-day JSONL files. */
const STORE_DIR = path.join(DOKORO_PATH, 'context-inspect');

/** Max length for any stored layer contentSnippet (defensive truncation). */
const SNIPPET_MAX = 500;

/** Hard caps on read-side limits, mirroring feedback-tools' bounded limits. */
const LAST_LIMIT_MAX = 500;
const SEARCH_LIMIT_MAX = 500;

interface ContextInspectLayer {
  name: string;
  reason: string;
  score?: number;
  tokenEstimate: number;
  source?: string;
  contentSnippet: string;
}

interface ContextInspectEvent {
  event: string;
  sessionId?: string;
  turn?: number;
  timestamp: string;
  budgetTokens?: number;
  totalEstimate: number;
  layers: ContextInspectLayer[];
  dropped?: Array<{ source?: string; reason: string; score?: number; tokenEstimate?: number }>;
}

/** Zod shape for a layer — liberal in what we accept from a producer. */
const layerShape = z.object({
  name: z.string(),
  reason: z.string(),
  score: z.number().optional(),
  tokenEstimate: z.number(),
  source: z.string().optional(),
  contentSnippet: z.string(),
});

/**
 * Zod shape for the event. The discriminator is z.string() (NOT a literal) so
 * the handler can validate it explicitly and return a friendly dokoro-style
 * isError rather than a raw MCP -32602.
 */
const eventShape = z.object({
  event: z.string(),
  sessionId: z.string().optional(),
  turn: z.number().optional(),
  timestamp: z.string(),
  budgetTokens: z.number().optional(),
  totalEstimate: z.number(),
  layers: z.array(layerShape),
  dropped: z
    .array(
      z.object({
        source: z.string().optional(),
        reason: z.string(),
        score: z.number().optional(),
        tokenEstimate: z.number().optional(),
      }),
    )
    .optional(),
});

/**
 * Derive the YYYY-MM-DD partition for an event from its own ISO timestamp.
 * Falls back to the current UTC date when the timestamp is missing/unparseable.
 */
function partitionDate(timestamp: string | undefined): string {
  if (typeof timestamp === 'string' && /^\d{4}-\d{2}-\d{2}/.test(timestamp)) {
    return timestamp.slice(0, 10);
  }
  return new Date().toISOString().slice(0, 10);
}

/**
 * Build a stored copy of the event with every layer contentSnippet truncated to
 * SNIPPET_MAX. Does not mutate the caller's object.
 */
function sanitizeForStorage(event: ContextInspectEvent): ContextInspectEvent {
  const layers = (event.layers ?? []).map((layer) => {
    if (typeof layer.contentSnippet === 'string' && layer.contentSnippet.length > SNIPPET_MAX) {
      return { ...layer, contentSnippet: layer.contentSnippet.slice(0, SNIPPET_MAX) };
    }
    return layer;
  });
  return { ...event, layers };
}

/** List stored JSONL filenames (YYYY-MM-DD.jsonl), sorted newest date first. */
async function listFilesNewestFirst(): Promise<string[]> {
  let entries: string[];
  try {
    entries = await fs.readdir(STORE_DIR);
  } catch {
    return [];
  }
  return entries
    .filter((f) => /^\d{4}-\d{2}-\d{2}\.jsonl$/.test(f))
    .sort()
    .reverse();
}

/**
 * Read every stored event in newest-first order. Within a single day file,
 * lines are appended chronologically, so we reverse each file's lines too.
 * Malformed/blank lines are skipped. Stops early once `cap` events are
 * collected (cap = Infinity reads everything).
 */
async function readEventsNewestFirst(cap: number): Promise<ContextInspectEvent[]> {
  const out: ContextInspectEvent[] = [];
  const files = await listFilesNewestFirst();
  for (const file of files) {
    let raw: string;
    try {
      raw = await fs.readFile(path.join(STORE_DIR, file), 'utf-8');
    } catch {
      continue;
    }
    const lines = raw.split('\n');
    for (let i = lines.length - 1; i >= 0; i--) {
      const line = lines[i].trim();
      if (!line) continue;
      try {
        out.push(JSON.parse(line) as ContextInspectEvent);
      } catch {
        // Skip malformed line.
        continue;
      }
      if (out.length >= cap) return out;
    }
  }
  return out;
}

export const contextInspectTools: ToolDefinition[] = [
  {
    name: 'dokoro_context_log',
    title: 'Log a context-inspect event',
    description:
      'Append a single context_inspect event (the context-inspector snapshot of which memory ' +
      'layers were assembled for a turn) to the per-day JSONL store under the dokoro workspace.',
    inputSchema: {
      event: eventShape,
    },
    handler: async (args) => {
      try {
        const a = args as { event?: ContextInspectEvent };
        if (a.event?.event !== 'context_inspect') {
          return {
            isError: true,
            content: [{ type: 'text' as const, text: 'context_log failed: not a context_inspect event' }],
          };
        }

        const stored = sanitizeForStorage(a.event);
        const date = partitionDate(stored.timestamp);
        const file = path.join(STORE_DIR, `${date}.jsonl`);

        await fs.mkdir(STORE_DIR, { recursive: true });
        await fs.appendFile(file, JSON.stringify(stored) + '\n', 'utf-8');

        const rel = path.join('context-inspect', `${date}.jsonl`);
        const turn = stored.turn ?? '?';
        return {
          content: [
            {
              type: 'text' as const,
              text: `logged context_inspect (turn=${turn}, layers=${stored.layers.length}) -> ${rel}`,
            },
          ],
        };
      } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : String(error);
        return {
          isError: true,
          content: [{ type: 'text' as const, text: `context_log failed: ${msg}` }],
        };
      }
    },
  },
  {
    name: 'dokoro_context_last',
    title: 'Read recent context-inspect events',
    description:
      'Return the most recent context_inspect events (newest first) as a JSON array string. ' +
      'Defaults to the last 5 events.',
    inputSchema: {
      limit: z.number().int().positive().max(LAST_LIMIT_MAX).optional(),
    },
    handler: async (args) => {
      try {
        const a = args as { limit?: number };
        const limit = a.limit ?? 5;
        const events = await readEventsNewestFirst(limit);
        if (events.length === 0) {
          return { content: [{ type: 'text' as const, text: '(no context events)' }] };
        }
        return { content: [{ type: 'text' as const, text: JSON.stringify(events) }] };
      } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : String(error);
        return {
          isError: true,
          content: [{ type: 'text' as const, text: `context_last failed: ${msg}` }],
        };
      }
    },
  },
  {
    name: 'dokoro_context_search',
    title: 'Search context-inspect events',
    description:
      'Case-insensitive substring search across stored context_inspect events (layer reason, ' +
      'contentSnippet, source, and sessionId). Returns up to `limit` most-recent matches as a ' +
      'JSON array string. Defaults to 10 matches.',
    inputSchema: {
      query: z.string(),
      limit: z.number().int().positive().max(SEARCH_LIMIT_MAX).optional(),
    },
    handler: async (args) => {
      try {
        const a = args as { query: string; limit?: number };
        const limit = a.limit ?? 10;
        const needle = a.query.toLowerCase();

        // Read all events newest-first, then filter; cap output at `limit`.
        const all = await readEventsNewestFirst(Infinity);
        const matches: ContextInspectEvent[] = [];
        for (const ev of all) {
          if (eventMatches(ev, needle)) {
            matches.push(ev);
            if (matches.length >= limit) break;
          }
        }

        if (matches.length === 0) {
          return { content: [{ type: 'text' as const, text: '(no matching context events)' }] };
        }
        return { content: [{ type: 'text' as const, text: JSON.stringify(matches) }] };
      } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : String(error);
        return {
          isError: true,
          content: [{ type: 'text' as const, text: `context_search failed: ${msg}` }],
        };
      }
    },
  },
];

/**
 * True when the (already lowercased) needle appears in any searchable field:
 * sessionId, or any layer's reason/contentSnippet/source.
 */
function eventMatches(ev: ContextInspectEvent, needle: string): boolean {
  if (typeof ev.sessionId === 'string' && ev.sessionId.toLowerCase().includes(needle)) {
    return true;
  }
  for (const layer of ev.layers ?? []) {
    if (
      (typeof layer.reason === 'string' && layer.reason.toLowerCase().includes(needle)) ||
      (typeof layer.contentSnippet === 'string' && layer.contentSnippet.toLowerCase().includes(needle)) ||
      (typeof layer.source === 'string' && layer.source.toLowerCase().includes(needle))
    ) {
      return true;
    }
  }
  return false;
}
