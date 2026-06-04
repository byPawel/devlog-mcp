/**
 * Shared EDITABLE working-memory blocks (Working memory layer, multi-agent).
 *
 * Upgrade from append-only shared_notes: named blocks (one row per block_key)
 * that multiple agents in the SAME project edit live. Concurrent edits are made
 * safe with OPTIMISTIC CONCURRENCY — a writer may pass the `version` it last read;
 * the write is an atomic compare-and-set, so a racing edit gets a clean conflict
 * instead of silently clobbering. Per-project only (one .dokoro/db per project);
 * there is intentionally NO global / cross-project store.
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

const NOW = `strftime('%Y-%m-%dT%H:%M:%SZ','now')`;

export const sharedBlocksTools: ToolDefinition[] = [
  {
    name: 'dokoro_block_write',
    title: 'Write a shared editable memory block',
    description:
      'Create or update a named shared working-memory block for the current project. ' +
      'Multiple agents can edit blocks concurrently. Pass expected_version (the version you last read) ' +
      'for a safe compare-and-set: if another agent changed the block since, the write is REJECTED as a ' +
      'conflict instead of overwriting. Omit expected_version for last-writer-wins. Scoped to the current project only.',
    inputSchema: {
      block_key: z.string().min(1),
      content: z.string(),
      agent_id: z.string(),
      expected_version: z.number().int().nonnegative().optional()
        .describe('Version you last read; write only applies if it still matches (optimistic lock).'),
    },
    handler: async (args) => {
      try {
        const a = args as { block_key: string; content: string; agent_id: string; expected_version?: number };
        const existing = db().prepare('SELECT version FROM shared_blocks WHERE block_key = ?').get(a.block_key) as
          { version: number } | undefined;

        if (!existing) {
          // New block. If a non-zero expected_version was supplied, that's a conflict (caller thinks it exists).
          if (a.expected_version !== undefined && a.expected_version !== 0) {
            return { isError: true, content: [{ type: 'text' as const, text: `conflict: block '${a.block_key}' does not exist (expected_version=${a.expected_version})` }] };
          }
          db().prepare(`INSERT INTO shared_blocks (block_key, content, version, updated_by, created_at, updated_at) VALUES (?, ?, 1, ?, ${NOW}, ${NOW})`)
            .run(a.block_key, a.content, a.agent_id);
          return { content: [{ type: 'text' as const, text: `block '${a.block_key}' created at version 1 by ${a.agent_id}` }] };
        }

        if (a.expected_version !== undefined && a.expected_version !== existing.version) {
          return { isError: true, content: [{ type: 'text' as const, text: `conflict: block '${a.block_key}' is at version ${existing.version}, not ${a.expected_version} — re-read and retry` }] };
        }

        // Atomic compare-and-set on the current version (safe under WAL concurrency).
        const info = db().prepare(`UPDATE shared_blocks SET content=?, version=version+1, updated_by=?, updated_at=${NOW} WHERE block_key=? AND version=?`)
          .run(a.content, a.agent_id, a.block_key, existing.version);
        if (info.changes !== 1) {
          return { isError: true, content: [{ type: 'text' as const, text: `conflict: block '${a.block_key}' changed concurrently — re-read and retry` }] };
        }
        return { content: [{ type: 'text' as const, text: `block '${a.block_key}' updated to version ${existing.version + 1} by ${a.agent_id}` }] };
      } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : String(error);
        return { isError: true, content: [{ type: 'text' as const, text: `block_write failed: ${msg}` }] };
      }
    },
  },
  {
    name: 'dokoro_block_read',
    title: 'Read a shared editable memory block',
    description: 'Read one shared working-memory block by block_key for the current project, returning its content, current version (pass this as expected_version to write safely), and last updater.',
    inputSchema: { block_key: z.string().min(1) },
    handler: async (args) => {
      try {
        const a = args as { block_key: string };
        const row = db().prepare('SELECT content, version, updated_by, updated_at FROM shared_blocks WHERE block_key = ?').get(a.block_key) as
          { content: string; version: number; updated_by: string; updated_at: string } | undefined;
        if (!row) return { content: [{ type: 'text' as const, text: `(no block '${a.block_key}')` }] };
        return { content: [{ type: 'text' as const, text:
          `block '${a.block_key}' — version ${row.version} (by ${row.updated_by} @ ${row.updated_at})\n\n${row.content}` }] };
      } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : String(error);
        return { isError: true, content: [{ type: 'text' as const, text: `block_read failed: ${msg}` }] };
      }
    },
  },
  {
    name: 'dokoro_block_list',
    title: 'List shared editable memory blocks',
    description: 'List all shared working-memory blocks for the current project (block_key, version, last updater), most-recently-updated first.',
    inputSchema: {},
    handler: async () => {
      try {
        const rows = db().prepare('SELECT block_key, version, updated_by, updated_at FROM shared_blocks ORDER BY updated_at DESC').all() as
          Array<{ block_key: string; version: number; updated_by: string; updated_at: string }>;
        if (rows.length === 0) return { content: [{ type: 'text' as const, text: '(no shared blocks)' }] };
        const lines = rows.map((r) => `${r.block_key}  v${r.version}  by ${r.updated_by}  @ ${r.updated_at}`);
        return { content: [{ type: 'text' as const, text: lines.join('\n') }] };
      } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : String(error);
        return { isError: true, content: [{ type: 'text' as const, text: `block_list failed: ${msg}` }] };
      }
    },
  },
];
