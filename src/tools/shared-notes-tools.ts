/**
 * Shared Working Memory MCP Tools (Working memory layer, multi-agent).
 *
 * Letta-style shared blocks scoped to the CURRENT PROJECT only. Multiple agents
 * working in the same project can append to and read a common, append-only notes
 * stream concurrently. Notes live entirely in the per-project SQLite DB
 * (shared_notes, migration v8) which runs in WAL mode with busy_timeout, so:
 *   - concurrent INSERTs are last-writer-safe (SQLite serialises them under the
 *     write lock; no rows are lost),
 *   - the file-based current.md workspace lock is NOT involved — shared notes are
 *     additive, not exclusive, so agents need not hold the workspace to record one.
 *
 * Per-project isolation is structural: each project has its own
 * .dokoro/db/dokoro.sqlite. There is intentionally NO global / cross-project store.
 *
 * - dokoro_shared_note_append: append an agent-tagged note (append-only).
 * - dokoro_shared_note_read:   read recent shared notes (newest first), filterable
 *                              by agent_id / note_type / since, with a row limit.
 */

import { z } from 'zod';
import type Database from 'better-sqlite3';
import { ToolDefinition } from './registry.js';
import { getSqliteDb } from '../db/index.js';
import { DOKORO_PATH } from '../shared/dokoro-utils.js';
import * as path from 'node:path';

function getSqlite(): Database.Database {
  const projectPath = path.dirname(DOKORO_PATH);
  return getSqliteDb({ projectPath, dokoroFolder: path.basename(DOKORO_PATH) });
}

function db(): Database.Database {
  const existing = (globalThis as Record<string, unknown>).__TEST_DB__ as Database.Database | undefined;
  if (existing) return existing;
  return getSqlite();
}

const NoteType = z.enum(['scratch', 'decision', 'blocker', 'handoff']);

export const sharedNotesTools: ToolDefinition[] = [
  {
    name: 'dokoro_shared_note_append',
    title: 'Append a shared working-memory note',
    description:
      'Append an agent-tagged note to the project shared working memory (append-only). ' +
      'Multiple agents in the SAME project can call this concurrently; writes are ' +
      'last-writer-safe via SQLite WAL. Scoped to the current project only — there is no ' +
      'cross-project or global store. Use note_type to classify (scratch/decision/blocker/handoff).',
    inputSchema: {
      agent_id: z.string(),
      content: z.string(),
      note_type: NoteType.optional().default('scratch'),
      metadata: z.record(z.unknown()).optional(),
    },
    handler: async (args) => {
      try {
        const a = args as {
          agent_id: string;
          content: string;
          note_type?: z.infer<typeof NoteType>;
          metadata?: Record<string, unknown>;
        };
        db().prepare(`
          INSERT INTO shared_notes (agent_id, content, note_type, metadata_json)
          VALUES (?, ?, ?, ?)
        `).run(
          a.agent_id,
          a.content,
          a.note_type ?? 'scratch',
          a.metadata ? JSON.stringify(a.metadata) : null,
        );
        return { content: [{ type: 'text' as const, text: `note appended by ${a.agent_id}` }] };
      } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : String(error);
        return {
          isError: true,
          content: [{ type: 'text' as const, text: `shared_note_append failed: ${msg}` }],
        };
      }
    },
  },
  {
    name: 'dokoro_shared_note_read',
    title: 'Read shared working-memory notes',
    description:
      'Read recent shared working-memory notes for the current project (newest first). ' +
      'Filter by agent_id, note_type, or a since lower bound (YYYY-MM-DD prefix); cap with limit. ' +
      'Scoped to the current project only.',
    inputSchema: {
      agent_id: z.string().optional(),
      note_type: NoteType.optional(),
      since: z.string().regex(/^\d{4}-\d{2}-\d{2}/).optional()
        .describe('ISO date lower bound (YYYY-MM-DD prefix); created_at >= this value'),
      limit: z.number().int().positive().max(200).optional(),
    },
    handler: async (args) => {
      try {
        const a = args as {
          agent_id?: string;
          note_type?: z.infer<typeof NoteType>;
          since?: string;
          limit?: number;
        };
        const where: string[] = [];
        const params: unknown[] = [];
        if (a.agent_id)  { where.push('agent_id = ?');   params.push(a.agent_id); }
        if (a.note_type) { where.push('note_type = ?');  params.push(a.note_type); }
        if (a.since)     { where.push('created_at >= ?'); params.push(a.since); }
        const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

        const rows = db().prepare(`
          SELECT created_at, note_type, agent_id, content
          FROM shared_notes
          ${whereSql}
          ORDER BY created_at DESC, id DESC
          LIMIT ?
        `).all(...params, a.limit ?? 50) as Array<{
          created_at: string;
          note_type: string;
          agent_id: string;
          content: string;
        }>;

        if (rows.length === 0) {
          return { content: [{ type: 'text' as const, text: '(no shared notes)' }] };
        }

        const lines = rows.map((r) =>
          `[${r.created_at}] [${r.note_type}] agent=${r.agent_id}: ${r.content}`
        );
        return { content: [{ type: 'text' as const, text: lines.join('\n') }] };
      } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : String(error);
        return {
          isError: true,
          content: [{ type: 'text' as const, text: `shared_note_read failed: ${msg}` }],
        };
      }
    },
  },
];
