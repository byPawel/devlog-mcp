# Council: dokoro vs the 2026 agent-memory field

Date: 2026-05-27
Pipeline: Research → Debate → Reasoning chain → Resolution (+ file validation)
Models: perplexity_reason (research), grok + kimi + openai (reasoning), gemini_judge (resolution, with actual source files)
Confidence: Medium-High

## Query
Compare dokoro (Working/Episodic/Semantic-bitemporal/Procedural/Affective memory;
SQLite+Drizzle, LanceDB, file workspace, MCP TS SDK) against Mem0, Letta/MemGPT,
Zep/Graphiti, Cognee, LangMem, OpenAI file_search, Anthropic Dreaming. Where do we
win, where is positioning hollow, top improvements?

## Code-verified facts (Sonnet explore agent)
- Affective layer (feedback-tools.ts): recency-decayed success rate + Wilson lower-bound
  CI (z=1.96), grouped per (agent_id, tool_name), auto-recorded via withToolTracking.
- Bi-temporal entity graph (entity-tables.ts partial unique index on valid_to IS NULL);
  BUT FUNCTIONAL_RELATION_TYPES empty (entity-extractor.ts:635) => contradiction-closing
  disabled. All relations many-valued.
- Regex-first extraction + optional Ollama LLM overlay (llama3.2).
- CompactionService fully implemented + tested but NEVER wired into any server (dead code).
- session_recall = SQL `summary LIKE '%q%'` substring, despite a full LanceDB hybrid
  (FTS5 BM25 + vector, RRF k=60) stack existing for docs.
- O_EXCL file lock + heartbeat for multi-agent workspace.
- nomic-embed-text via Ollama; embedding cache (LRU 10k, SHA-256 keyed).

## Research findings
- Auto-consolidation is table stakes: Mem0, Letta (subconscious agents), Zep, Anthropic
  Dreaming (May 2026) all automatic. LangMem + OpenAI file_search manual.
- Zep/Graphiti = ONLY competitor with true bi-temporal contradiction-closing.
- NO competitor ships an affective/reward memory layer. App-level everywhere else.
- SOTA recall = hybrid vector+recency+metadata or graph traversal.

## Debate / scorecard (as-shipped-today, skeptic)
| Criterion | /5 | Note |
|---|---|---|
| Auto consolidation | 1 | CompactionService dead code |
| Temporal reasoning | 2 | schema present, closing disabled |
| Recall quality | 2 | substring, not the owned vector stack |
| Affective learning | 3 | Wilson+decay works, "copyable in a sprint" |
| Multi-agent safety | 3 | file locks work but primitive |
| Self-hostability | 5 | fully offline |
| MCP-native | 5 | true protocol integration |

## Resolution (gemini, validated against source files)
One-line positioning: the only fully offline, MCP-native memory server with
statistically sound affective tool-routing + multi-agent concurrency, today.
Hollow: "bi-temporal KG" + "auto-consolidation" are paper claims — code exists but is
disconnected from the live loop.

Top 3 leverage moves (exploit existing assets):
1. Wire CompactionService to a trigger (token-count check on workspace_claim or bg loop).
   High impact / low effort.
2. Route session_recall through the existing LanceDB RRF hybrid search.
   High impact / medium effort.
3. Populate FUNCTIONAL_RELATION_TYPES (e.g. ['depends_on','uses','owns','assigned_to'])
   to switch on contradiction-closing. High impact / low effort.
Bonus: deepen affective layer with an exploration/bandit term (Thompson/UCB) to make it
a true learning loop, not just descriptive stats — turns the copyable feature into a moat.

Biggest risk if nothing changes: dokoro stays a fragmented set of neat SQLite tricks
rather than a cohesive cognitive architecture, and loses to Mem0/Letta once they adopt MCP.

Verdict: PARTIAL — core infra is SOTA, but the differentiating cognition is dead code.
