# Auto Entity Extraction for GraphRAG - Design Document

**Date:** 2026-02-21
**Status:** Approved
**Context:** OpenClaw's #1 complaint is "remembers facts but can't reason about connections." Our GraphRAG schema (entities, docEntities, entityRelations) exists but nothing populates it automatically.

---

## Problem

OpenClaw users report that memory systems store facts but fail to understand relationships between them. Example: "Alice manages the auth team" stored Monday, but asking "who handles auth permissions?" on Wednesday fails to connect the dots. This is because OpenClaw uses flat semantic search over text chunks with no structured relationship tracking.

devlog-mcp has the schema for a knowledge graph (18 tables including entities, entityRelations, docEntities) but no automatic extraction pipeline to populate it.

## Architecture

Two-phase extraction pipeline:

**Phase 1: Regex + heuristics** — runs during background indexing, zero API cost
- Extract entities from every indexed document chunk
- Detect relations from contextual patterns
- Wire into existing `entities`, `docEntities`, `entityRelations` tables

**Phase 2 (future): LLM-powered deep analysis** — on-demand via tool call
- Send chunks to Ollama for richer extraction
- Fill gaps the regex missed
- Confidence scoring (regex = 0.7, LLM = 0.9)

## Entity Types (Phase 1)

| Type | Detection Pattern |
|------|------------------|
| `person` | `@username`, capitalized names after "by", "from", "with" |
| `project` | Repo patterns (`org/repo`), package names from imports |
| `file` | File paths (`src/foo/bar.ts`, `*.md`), import statements |
| `service` | URLs, API endpoints, service names (Redis, Postgres, etc.) |
| `component` | PascalCase identifiers, class/function names |
| `concept` | Hashtags `#auth`, terms after "implements", "about", "regarding" |

## Relation Types

| Relation | Detection Pattern |
|----------|------------------|
| `mentions` | Entity appears in document (default) |
| `implements` | "implements X", "built X", "created X" |
| `depends_on` | "depends on X", "requires X", "uses X" |
| `blocks` | "blocks X", "blocked by X" |
| `authored_by` | "by @user", document creator |

## Data Flow

```
Document indexed (background-indexer)
  -> ChunkingService splits into chunks
  -> EntityExtractor.extract(chunk) -> { entities[], relations[] }
  -> Upsert into entities table (dedup by type + canonicalName)
  -> Create docEntities links
  -> Create entityRelations for cross-entity connections
```

## Integration Points

- **Background indexer**: Call extraction after chunking, before/after embedding
- **Search enrichment**: When search returns docs, include related entities
- **New MCP tool**: `devlog_entity_graph` — query the knowledge graph

## Files

- Create: `src/services/entity-extractor.ts` — the regex extraction engine
- Create: `src/services/entity-extractor.test.ts` — tests
- Create: `src/tools/entity-tools.ts` — MCP tool wrapper
- Modify: `src/services/background-indexer.ts` — trigger extraction during indexing
- Modify: `src/servers/unified-server.ts` — register entity tools

## Success Criteria

- Background indexer populates entities table automatically on every index run
- `devlog_entity_graph` tool returns connected entities for any query
- Cross-document relationships discoverable (e.g., "what depends on auth?")
- Zero API cost (regex only), works fully offline
