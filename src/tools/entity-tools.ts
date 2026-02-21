/**
 * Entity Graph MCP Tool
 *
 * Provides graph traversal and search over the entity knowledge graph.
 * Supports recursive CTE-based graph exploration and filtered entity search.
 */

import { z } from 'zod';
import { ToolDefinition } from './registry.js';
import { CallToolResult } from '../types.js';
import { getSqliteDb } from '../db/index.js';
import { DEVLOG_PATH } from '../shared/devlog-utils.js';
import * as path from 'node:path';

function getSqlite() {
  const projectPath = path.dirname(DEVLOG_PATH);
  return getSqliteDb({ projectPath, devlogFolder: path.basename(DEVLOG_PATH) });
}

interface EntityRow {
  id: number;
  type: string;
  name: string;
  canonical_name: string | null;
  description: string | null;
  metadata_json: string | null;
  created_at: string | null;
  updated_at: string | null;
}

interface RelationRow {
  source_id: number;
  target_id: number;
  relation_type: string;
  weight: number | null;
  metadata_json: string | null;
  created_at: string | null;
  source_name: string;
  target_name: string;
}

interface DocEntityRow {
  doc_id: string;
  entity_id: number;
  relation_type: string;
  context: string | null;
  confidence: number | null;
}

interface EntityWithDocCount {
  id: number;
  type: string;
  name: string;
  canonical_name: string | null;
  description: string | null;
  doc_count: number;
}

interface CountRow {
  count: number;
}

export const entityTools: ToolDefinition[] = [
  {
    name: 'devlog_entity_graph',
    title: 'Entity Graph',
    description:
      'Query the entity knowledge graph. Search entities by name/type, or explore the graph from a specific entity using recursive traversal. Returns entities, their relations, and linked documents.',
    inputSchema: {
      query: z.string().optional().describe('Search entities by name (partial match)'),
      type: z
        .enum(['person', 'project', 'file', 'service', 'component', 'concept'])
        .optional()
        .describe('Filter by entity type'),
      entityId: z.number().optional().describe('Get a specific entity and its relations by ID'),
      depth: z
        .number()
        .min(1)
        .max(5)
        .default(2)
        .optional()
        .describe('Graph traversal depth (1-5, default 2)'),
      limit: z
        .number()
        .min(1)
        .max(100)
        .default(20)
        .optional()
        .describe('Max results (1-100, default 20)'),
    },
    handler: async (args: {
      query?: string;
      type?: string;
      entityId?: number;
      depth?: number;
      limit?: number;
    }): Promise<CallToolResult> => {
      const { query, type, entityId, depth = 2, limit = 20 } = args;

      let db;
      try {
        db = getSqlite();
      } catch {
        return {
          content: [
            {
              type: 'text',
              text: '**Error:** Database not initialized. Run `devlog_init` first.',
            },
          ],
          isError: true,
        };
      }

      try {
        // Cap depth at 5
        const safeDepth = Math.min(Math.max(depth, 1), 5);

        // Mode 1: Get entity by ID and traverse graph
        if (entityId !== undefined) {
          return handleEntityGraph(db, entityId, safeDepth);
        }

        // Mode 2: Search entities
        return handleEntitySearch(db, query, type, limit);
      } catch (error: unknown) {
        return {
          content: [
            {
              type: 'text',
              text: `**Error:** ${(error as Error).message}`,
            },
          ],
          isError: true,
        };
      }
    },
  },
];

function handleEntityGraph(
  db: ReturnType<typeof getSqlite>,
  entityId: number,
  depth: number
): CallToolResult {
  // Get the root entity
  const entity = db
    .prepare('SELECT * FROM entities WHERE id = ?')
    .get(entityId) as EntityRow | undefined;

  if (!entity) {
    return {
      content: [
        {
          type: 'text',
          text: `**Error:** Entity with ID ${entityId} not found.`,
        },
      ],
      isError: true,
    };
  }

  // Recursive CTE to find connected entities
  const relations = db
    .prepare(
      `WITH RECURSIVE graph(entity_id, depth) AS (
        SELECT ?, 0
        UNION
        SELECT
          CASE WHEN er.source_id = g.entity_id THEN er.target_id ELSE er.source_id END,
          g.depth + 1
        FROM graph g
        JOIN entity_relations er ON er.source_id = g.entity_id OR er.target_id = g.entity_id
        WHERE g.depth < ?
      )
      SELECT DISTINCT er.*, es.name as source_name, et.name as target_name
      FROM entity_relations er
      JOIN graph g ON er.source_id = g.entity_id OR er.target_id = g.entity_id
      JOIN entities es ON er.source_id = es.id
      JOIN entities et ON er.target_id = et.id
      LIMIT 50`
    )
    .all(entityId, depth) as RelationRow[];

  // Get linked documents
  const docLinks = db
    .prepare(
      `SELECT de.doc_id, de.entity_id, de.relation_type, de.context, de.confidence
       FROM doc_entities de
       WHERE de.entity_id = ?`
    )
    .all(entityId) as DocEntityRow[];

  // Format output
  const lines: string[] = [
    `## Entity: ${entity.name}`,
    `- **Type:** ${entity.type}`,
    `- **ID:** ${entity.id}`,
  ];

  if (entity.canonical_name) {
    lines.push(`- **Canonical:** ${entity.canonical_name}`);
  }
  if (entity.description) {
    lines.push(`- **Description:** ${entity.description}`);
  }

  // Relations section
  if (relations.length > 0) {
    lines.push('', `### Relations (depth ${depth}, ${relations.length} found)`);
    for (const rel of relations) {
      lines.push(
        `- ${rel.source_name} --[${rel.relation_type}]--> ${rel.target_name}${rel.weight !== null && rel.weight !== 1.0 ? ` (weight: ${rel.weight})` : ''}`
      );
    }
  } else {
    lines.push('', '### Relations', 'No relations found.');
  }

  // Linked documents section
  if (docLinks.length > 0) {
    lines.push('', `### Linked Documents (${docLinks.length})`);
    for (const link of docLinks) {
      lines.push(
        `- **${link.doc_id}** (${link.relation_type}${link.confidence !== null && link.confidence < 1.0 ? `, confidence: ${link.confidence.toFixed(2)}` : ''})`
      );
    }
  } else {
    lines.push('', '### Linked Documents', 'No linked documents found.');
  }

  return {
    content: [{ type: 'text', text: lines.join('\n') }],
  };
}

function handleEntitySearch(
  db: ReturnType<typeof getSqlite>,
  query: string | undefined,
  type: string | undefined,
  limit: number
): CallToolResult {
  // Build WHERE clause dynamically with parameterized SQL
  const conditions: string[] = [];
  const params: (string | number)[] = [];

  if (type) {
    conditions.push('e.type = ?');
    params.push(type);
  }

  if (query) {
    conditions.push('(e.name LIKE ? OR e.canonical_name LIKE ?)');
    const pattern = `%${query}%`;
    params.push(pattern, pattern);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  const safeLimit = Math.min(Math.max(limit, 1), 100);
  params.push(safeLimit);

  const entities = db
    .prepare(
      `SELECT e.id, e.type, e.name, e.canonical_name, e.description, COUNT(de.doc_id) as doc_count
       FROM entities e
       LEFT JOIN doc_entities de ON e.id = de.entity_id
       ${whereClause}
       GROUP BY e.id
       ORDER BY doc_count DESC
       LIMIT ?`
    )
    .all(...params) as EntityWithDocCount[];

  // Get graph stats
  const totalEntities = (
    db.prepare('SELECT COUNT(*) as count FROM entities').get() as CountRow
  ).count;
  const totalRelations = (
    db.prepare('SELECT COUNT(*) as count FROM entity_relations').get() as CountRow
  ).count;

  // Format output
  const lines: string[] = [
    `## Entity Search Results`,
    `Graph stats: ${totalEntities} entities, ${totalRelations} relations`,
    '',
  ];

  if (query) {
    lines.push(`Query: "${query}"`);
  }
  if (type) {
    lines.push(`Type filter: ${type}`);
  }
  lines.push(`Results: ${entities.length} found`, '');

  if (entities.length > 0) {
    for (const e of entities) {
      const desc = e.description ? ` - ${e.description}` : '';
      lines.push(
        `- **${e.name}** [${e.type}] (ID: ${e.id}, docs: ${e.doc_count})${desc}`
      );
    }
  } else {
    lines.push('No entities found matching your criteria.');
  }

  return {
    content: [{ type: 'text', text: lines.join('\n') }],
  };
}
