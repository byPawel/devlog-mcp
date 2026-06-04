/**
 * Multi-agent PRESENCE via heartbeat (Working memory layer), daemonless.
 *
 * Agents are ephemeral MCP processes — there is no background sweeper. Liveness is
 * computed at READ time: an agent is live if now - last_heartbeat <= TTL. Heartbeats
 * are opportunistic (an explicit dokoro_presence_ping; agents call it at session start
 * and during work — no timers). last_heartbeat is server-assigned (SQLite unixepoch,
 * one clock domain); heartbeat_seq rejects out-of-order retries. Per-project only.
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

// Default presence TTL: 15 min. Generous, because agents only beat on tool calls.
const DEFAULT_TTL_SECONDS = 900;

export const presenceTools: ToolDefinition[] = [
  {
    name: 'dokoro_presence_ping',
    title: 'Heartbeat: announce this agent is active',
    description:
      'Record/refresh this agent\'s presence heartbeat for the current project (upsert; one row per agent_id). ' +
      'Call at session start and during work — no background timer exists. Optionally set status and current_focus ' +
      'so other agents can see what you are doing. Scoped to the current project only.',
    inputSchema: {
      agent_id: z.string(),
      session_id: z.string().optional(),
      status: z.enum(['active', 'idle', 'away']).optional().default('active'),
      current_focus: z.string().optional(),
    },
    handler: async (args) => {
      try {
        const a = args as { agent_id: string; session_id?: string; status?: string; current_focus?: string };
        // Server-assigned timestamp (unixepoch) — one clock domain. Atomic upsert; seq increments.
        db().prepare(`
          INSERT INTO agent_presence (agent_id, session_id, status, current_focus, last_heartbeat, heartbeat_seq)
          VALUES (?, ?, ?, ?, strftime('%s','now'), 1)
          ON CONFLICT(agent_id) DO UPDATE SET
            session_id = excluded.session_id,
            status = excluded.status,
            current_focus = excluded.current_focus,
            last_heartbeat = strftime('%s','now'),
            heartbeat_seq = agent_presence.heartbeat_seq + 1
        `).run(a.agent_id, a.session_id ?? null, a.status ?? 'active', a.current_focus ?? null);
        return { content: [{ type: 'text' as const, text: `presence updated for ${a.agent_id}` }] };
      } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : String(error);
        return { isError: true, content: [{ type: 'text' as const, text: `presence_ping failed: ${msg}` }] };
      }
    },
  },
  {
    name: 'dokoro_presence_list',
    title: 'List agents currently active in this project',
    description:
      'List agents whose heartbeat is within the TTL (default 900s) for the current project — i.e. who is working here right now. ' +
      'Liveness is computed at read time; stale agents simply drop off. Shows status, focus, and seconds since last heartbeat.',
    inputSchema: {
      ttl_seconds: z.number().int().positive().max(86400).optional()
        .describe('Liveness window; agents quieter than this are treated as gone (default 900).'),
    },
    handler: async (args) => {
      try {
        const a = args as { ttl_seconds?: number };
        const ttl = a.ttl_seconds ?? DEFAULT_TTL_SECONDS;
        const rows = db().prepare(`
          SELECT agent_id, status, current_focus, session_id,
                 (strftime('%s','now') - last_heartbeat) AS age_seconds
          FROM agent_presence
          WHERE (strftime('%s','now') - last_heartbeat) <= ?
          ORDER BY last_heartbeat DESC
        `).all(ttl) as Array<{ agent_id: string; status: string; current_focus: string | null; session_id: string | null; age_seconds: number }>;
        if (rows.length === 0) return { content: [{ type: 'text' as const, text: '(no agents active)' }] };
        const lines = rows.map((r) =>
          `${r.agent_id} [${r.status}] — ${r.current_focus ?? 'no focus set'} (last seen ${r.age_seconds}s ago)`
        );
        return { content: [{ type: 'text' as const, text: lines.join('\n') }] };
      } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : String(error);
        return { isError: true, content: [{ type: 'text' as const, text: `presence_list failed: ${msg}` }] };
      }
    },
  },
];
