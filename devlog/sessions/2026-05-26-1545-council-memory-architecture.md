# Council: Does the 5-layer memory split + code make sense?

**Date:** 2026-05-26
**Query:** Evaluate devlog-mcp's 5-layer memory split (Working/Episodic/Semantic/Procedural/Affective) and the actual code vs other agent-memory tools.

## Pipeline
Research (perplexity_reason + grok_search) → grok_reason code review (schema + tools) → Claude code verification → gemini_judge resolution.

## Verdict: PARTIAL — strong architecture + novel moat, but P0 data-integrity bug.

### Design (theory)
- 4 base layers (Working/Episodic/Semantic/Procedural) map cleanly to CoALA — mainstream, well-grounded (Mem0, Letta, Zep/Graphiti, Cognee, LangMem).
- Semantic + bi-temporal = Zep/Graphiti-tier.
- Affective layer (per-tool success/latency → routing) is GENUINELY NOVEL — no mainstream lib does it. The moat. But "Affective" is a misnomer; technically policy/valuation/meta-memory.

### Code reality (verified)
- agent_feedback HAS 5 single-col indexes (grok wrongly said none); missing composite (agent_id, tool_name, recorded_at).
- agent_feedback is a passive LOG: devlog_feedback_query returns aggregates, no recency/decay, no ranked route-score → affective layer can't yet DRIVE routing.
- BI-TEMPORAL WRITE GAP (P0): entity-extractor.ts uses `INSERT OR IGNORE INTO entity_relations` with no valid_to handling → never closes windows on contradiction. as_of READ works; WRITE doesn't. README overclaims "contradictions close a window."

## Punch-list
- P0: Fix bi-temporal write — close valid_to on contradiction, set valid_from on insert (entity-extractor.ts). Or soften README claim.
- P1: Affective routing — add decay/recency + ranked route-score query/tool; composite index.
- P2: Rename Affective → Valuation/Policy; cross-layer dedup; forgetting/decay; unified retrieval.

## Moat
Per-tool affective/valuation memory + bi-temporal semantic — once the write gap is fixed.
