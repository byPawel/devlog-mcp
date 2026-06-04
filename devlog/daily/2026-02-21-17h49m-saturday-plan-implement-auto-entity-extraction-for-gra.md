---
title: "Plan: Implement auto entity extraction for GraphRAG knowledge graph in dokoro. Phase 1: Regex + heuristics engine that runs during background indexing. Extract entities (person, project, file, service, component, concept) and relations (mentions, implements, depends_on, blocks, authored_by) from document chunks. Wire into existing entities, docEntities, entityRelations SQLite tables. Phase 2 (future): LLM-powered deep analysis via Ollama."
date: "2026-02-21T16:57:32.085Z"
status: "pending"
type: "plan"
docType: "plan"
planStatus: "pending"
planPhases: ["Search","Analysis","Decomposition","Critique","Judgment"]
planToolsUsed: ["grok_search","qwen_coder","kimi_thinking","kimi_decompose","openai_reason","qwen_reason","gemini_analyze_text"]
tags:
  type: plan
  focus: "Implement auto entity extraction for GraphRAG knowledge grap"
---

# Plan: Implement auto entity extraction for GraphRAG knowledge graph in dokoro. Phase 1: Regex + heuristics engine that runs during background indexing. Extract entities (person, project, file, service, component, concept) and relations (mentions, implements, depends_on, blocks, authored_by) from document chunks. Wire into existing entities, docEntities, entityRelations SQLite tables. Phase 2 (future): LLM-powered deep analysis via Ollama.

Synthesis confirmed: hybrid regex approach, inside-out build, Phase 1 mitigations (WAL, parameterized SQL, code fence skip, stoplists, depth caps). 6 tasks with TDD methodology. File targets: create entity-extractor.ts, entity-extractor.test.ts, entity-tools.ts; modify background-indexer.ts, unified-server.ts.

---

# Full Analysis

## Search: Search for relevant information + best practices

Regex-Based NER in TypeScript & Knowledge Graphs: Recent (2025-2026) resources on regex/heuristic NER emphasize hybrid rule-ML approaches for precision in PII, code, docs. TypeScript libs integrate WASM/rust regex with Transformers.js. Knowledge graphs use extracted entities as nodes. Hybrid extraction: Regex for patterns (emails, dates), NER for context. Fuse spans to dedupe/overlap via mergers (e.g., aifw SpanMerger). Use gazetteers + regex for domain entities. Normalize via ChunkConverter for NER pipelines. Local/offline: Pattern-match for KG nodes (KuzuMemory regex classifies SEMANTIC/PREFERENCE). Retention: Episodic (30d), hash dedupe. Markdown preprocessing aids NER (e.g., GraphRAG chunks to entities for graphs). Extract via regex for headers/sections; build KGs from entities/relations. Best: Hybrid (regex precision + ML recall), explainable rules for audit, custom alphabets non-English.
## Analysis: Analyze code feasibility + quality (Qwen)

Schema is well-structured for a knowledge graph, but integration with extraction logic needs refinement. Schema considerations: entities table supports type, canonicalName, metadataJson for dedup. canonicalName index missing (only type+canonicalName composite). docEntities has relationType + confidence, context field underutilized. entityRelations lacks unique constraint on (sourceId, targetId, relationType) - risk of duplicate edges. Indexer issues: No entity extraction logic present. Missing regex patterns, span merging, confidence scoring. SQLite queries use raw strings bypassing Drizzle types. No batching/transaction handling. Extraction feasibility: Regex patterns viable for all entity types. Requires normalization for canonicalName. Relations derivable from context patterns. Span overlap resolution needed (longest-match or priority rules). Confidence: regex=0.7, contextual=0.85, named=0.95. MCP tool readiness: Schema supports graph traversal via indexes. Missing query helpers. Should use Drizzle ORM. Recommendations: Add canonicalName index, add unique constraint on entity_relations, replace raw SQL with Drizzle, implement extraction as separate module, batch inserts with onConflictDoNothing.
## Analysis: Step-by-step reasoning (Kimi)

Build inside-out: 1) Regex engine + span merging (six entity patterns, longest-wins priority, type precedence file > component > concept). 2) Canonical normalization (lowercase, collapse special chars to hyphens, Map keyed by type:canonical for dedup). 3) Relation detector (trigger phrases with lookbehind regex, match following tokens to entity spans, confidence 1.0 for explicit verbs, 0.5 for proximity). 4) SQLite persistence (transaction batch: ON CONFLICT DO UPDATE for entities, bulk insert docEntities and entityRelations). 5) Background indexer hook (after vector embedding, instantiate EntityExtractor, call process(docId, content) in same transaction). 6) MCP tool wrapper (dokoro_entity_graph with type/name/depth params, recursive CTE for graph traversal). Tricky: span collision must be deterministic (file > PascalCase), canonical stability affects graph integrity, relation directionality ambiguous (parse passive voice by flipping source/target), better-sqlite3 transaction management for concurrent access, idempotent re-indexing (delete old docEntities first, keep orphan entities). Test priorities: overlapping spans, canonical normalization, relation extraction accuracy, batch upsert idempotency, integration smoke test.
## Decomposition: Task decomposition with dependencies (Kimi K2.5)

T1: EntityExtractor Core (regex patterns -> span extraction -> span merging -> canonical normalization). T2: RelationDetector (trigger phrases -> voice analysis/directionality -> relation builder). T3: SQLite Persistence (entity upsert -> docEntity links -> relation persistence -> transaction wrapper). T4: Background Indexer Integration (post-embedding hook -> idempotent cleanup -> batch orchestration). T5: MCP Tool Wrapper (schema definition -> recursive CTE query -> server registration). T6: Test Suite (extractor unit tests, relation unit tests, persistence tests, integration smoke). Dependencies: T1+T2+T3.4 -> T4, T3.4 -> T5, T1->T6.1, T2->T6.2, T3->T6.3, T4+T5->T6.4.
## Critique: Find holes and gaps (GPT)

PRE-MORTEM: Heuristics meet messy inputs, canonicalization amplifies mistakes, synchronous SQLite blocks at scale. FAILURE MODES: false positives in code blocks/logs/stack traces, common words as concepts, non-English names, C++/node.js edge cases, canonical collisions (C++/c#/c->c), negation not handled ('does not depend on'), cross-sentence relation mis-pairing. SCALE: sequential indexer bottleneck, SQLite write locks, recursive CTE blow-ups on cyclic graphs, quality decay with volume. SECURITY: SQL injection if string-concatenated, ReDoS from catastrophic backtracking, graph amplification DoS, data poisoning. MISSING: store raw surface form + canonical, section-aware parsing (skip code fences), negation handling, stoplists per type, incremental indexing, WAL mode, query timeouts/depth caps for CTE, parameterized SQL everywhere, regex safety review.
## Judgment: Draft plan synthesis (Qwen)

SYNTHESIZED PLAN: T1 EntityExtractor Core (code fence skipping, span merging longest-wins file>component>concept, confidence tiers, stoplists per type, ReDoS bounded regex). T2 RelationDetector (trigger phrases, same-sentence pairing only, basic negation filtering, passive voice detection). T3 SQLite Persistence (parameterized SQL, WAL mode, batch ON CONFLICT, store raw surface form, add canonicalName index). T4 Background Indexer (incremental processing, batch size 100, post-embedding hook). T5 MCP Tool (recursive CTE with depth cap 5, parameterized queries). T6 Tests (code fences, negation, collisions, batch performance). Phase 1 must-haves: code fence skip, parameterized SQL, WAL, stoplists, depth caps, raw surface form, same-sentence relations. Phase 2 future: cross-sentence coreference, advanced negation, canonical collision mapping, incremental rebuilds. Quality: 9/10.
## Judgment: Final plan in bite-sized TDD steps (Gemini)

Synthesis confirmed: hybrid regex approach, inside-out build, Phase 1 mitigations (WAL, parameterized SQL, code fence skip, stoplists, depth caps). 6 tasks with TDD methodology. File targets: create entity-extractor.ts, entity-extractor.test.ts, entity-tools.ts; modify background-indexer.ts, unified-server.ts.