/**
 * Affective Memory MCP Tools
 *
 * Provides two tools for recording and querying agent feedback (affective memory layer):
 * - devlog_feedback_record: Persist the outcome of a tool call
 * - devlog_feedback_query: Summarise success rates and per-tool stats
 */

import { z } from 'zod';
import type Database from 'better-sqlite3';
import { ToolDefinition } from './registry.js';
import { getSqliteDb } from '../db/index.js';
import { DEVLOG_PATH } from '../shared/devlog-utils.js';
import * as path from 'node:path';

function getSqlite(): Database.Database {
  const projectPath = path.dirname(DEVLOG_PATH);
  return getSqliteDb({ projectPath, devlogFolder: path.basename(DEVLOG_PATH) });
}

function db(): Database.Database {
  const existing = (globalThis as Record<string, unknown>).__TEST_DB__ as Database.Database | undefined;
  if (existing) return existing;
  return getSqlite();
}

const Outcome = z.enum(['success', 'failure', 'partial', 'rejected', 'timeout']);

export const feedbackTools: ToolDefinition[] = [
  {
    name: 'devlog_feedback_record',
    title: 'Record agent feedback',
    description: 'Record the outcome of a tool call into the affective memory layer.',
    inputSchema: {
      agent_id: z.string(),
      tool_name: z.string(),
      outcome: Outcome,
      confidence: z.number().min(0).max(1).optional(),
      latency_ms: z.number().int().nonnegative().optional(),
      error_message: z.string().optional(),
      doc_id: z.string().optional(),
      session_id: z.string().optional(),
      metadata: z.record(z.unknown()).optional(),
    },
    handler: async (args) => {
      try {
        const a = args as {
          agent_id: string;
          tool_name: string;
          outcome: z.infer<typeof Outcome>;
          confidence?: number;
          latency_ms?: number;
          error_message?: string;
          doc_id?: string;
          session_id?: string;
          metadata?: Record<string, unknown>;
        };
        db().prepare(`
          INSERT INTO agent_feedback
            (agent_id, tool_name, outcome, confidence, latency_ms, error_message, doc_id, session_id, metadata_json, recorded_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
        `).run(
          a.agent_id,
          a.tool_name,
          a.outcome,
          a.confidence ?? null,
          a.latency_ms ?? null,
          a.error_message ?? null,
          a.doc_id ?? null,
          a.session_id ?? null,
          a.metadata ? JSON.stringify(a.metadata) : null,
        );
        return { content: [{ type: 'text' as const, text: `recorded ${a.outcome} for ${a.tool_name}` }] };
      } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : String(error);
        return {
          isError: true,
          content: [{ type: 'text' as const, text: `feedback_record failed: ${msg}` }],
        };
      }
    },
  },
  {
    name: 'devlog_feedback_query',
    title: 'Query agent feedback',
    description: 'Summarise affective memory: success rate, recent failures, per-tool stats.',
    inputSchema: {
      tool_name: z.string().optional(),
      agent_id: z.string().optional(),
      since: z.string().optional(),
      limit: z.number().int().positive().max(500).optional(),
    },
    handler: async (args) => {
      try {
        const a = args as {
          tool_name?: string;
          agent_id?: string;
          since?: string;
          limit?: number;
        };
        const where: string[] = [];
        const params: unknown[] = [];
        if (a.tool_name) { where.push('tool_name = ?'); params.push(a.tool_name); }
        if (a.agent_id)  { where.push('agent_id = ?');  params.push(a.agent_id); }
        if (a.since)     { where.push('recorded_at >= ?'); params.push(a.since); }
        const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

        const summary = db().prepare(`
          SELECT tool_name,
                 COUNT(*)                                                              AS total,
                 SUM(CASE WHEN outcome = 'success' THEN 1 ELSE 0 END)                  AS success,
                 SUM(CASE WHEN outcome = 'failure' THEN 1 ELSE 0 END)                  AS failure,
                 ROUND(AVG(CASE WHEN outcome = 'success' THEN 1.0 ELSE 0.0 END), 3)    AS success_rate,
                 ROUND(AVG(confidence), 3)                                             AS avg_confidence
          FROM agent_feedback ${whereSql}
          GROUP BY tool_name
          ORDER BY total DESC
          LIMIT ?
        `).all(...params, a.limit ?? 50) as Array<Record<string, unknown>>;

        const lines = summary.map((r) =>
          `${r['tool_name']}: total=${r['total']} success=${r['success']} failure=${r['failure']} success_rate=${r['success_rate']} avg_confidence=${r['avg_confidence']}`
        );
        return { content: [{ type: 'text' as const, text: lines.join('\n') || '(no feedback recorded)' }] };
      } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : String(error);
        return {
          isError: true,
          content: [{ type: 'text' as const, text: `feedback_query failed: ${msg}` }],
        };
      }
    },
  },
];
