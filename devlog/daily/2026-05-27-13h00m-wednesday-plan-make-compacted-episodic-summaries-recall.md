---
title: "Plan: Make compacted episodic summaries recallable so the agentic loop's recall leg stays complete: compact() re-inserts the merged summary as one conversation_summaries row (flagged compacted) instead of summarize-and-drop."
date: "2026-05-27T11:03:16.876Z"
status: "in-progress"
type: "plan"
docType: "plan"
planStatus: "in-progress"
planGoal: "After compaction, devlog_session_recall still surfaces compacted content; no regression to token-reduction, recall behavior, or 824 tests; no infinite re-compaction loop. TDD, lint+build green."
planPhases: ["Search","Analysis","Decomposition","Debate","Critique","Judgment"]
planToolsUsed: ["grok_search","qwen_coder","kimi_thinking"]
tags:
  type: plan
  focus: "Make compacted episodic summaries recallable so the agentic "
---

# Plan: Make compacted episodic summaries recallable so the agentic loop's recall leg stays complete: compact() re-inserts the merged summary as one conversation_summaries row (flagged compacted) instead of summarize-and-drop.

Status: IN PROGRESS - 3/9 steps (33%)

## Search: Search for relevant information + best practices

SOTA agent-memory consolidation (Letta/MemGPT, Zep/Graphiti, 2025-2026): AVOID pure 'summarize-and-drop' (lossy eviction, as older LangChain did). Best practice = keep hierarchical layers so retrieval surfaces BOTH consolidated summaries AND detail: Letta keeps recall+archival tiers retrievable via search after recursive summarization; Zep soft-deletes with valid_at/expired_at timestamps so pre-consolidation states stay queryable via temporal filters; never hard-delete except for compliance. Four levers: importance, merge, decay, eviction. Implication for devlog: compaction currently does summarize-AND-DELETE from conversation_summaries (the recall corpus) = the anti-pattern. The merged summary should remain in the recall corpus. Approach A (re-insert ONE merged conversation_summaries row in place of the N deleted, re-embedded) matches the 'keep consolidated layer retrievable' best practice and still reduces row/token count; preferable to summarize-and-drop. Approach B (recall also reads sessions.summary) is a read-side patch but leaves the blob un-embedded and shaped differently.
## Analysis: Analyze code feasibility + quality (Qwen)

Approach A feasible, low blast radius. (1) In compact()'s transaction, after UPDATE sessions.summary + DELETE source rows, INSERT one merged row into conversation_summaries (session_id, ai_model, summary=mergedText, token_count, started_at=earliest). (2) CRITICAL infinite-loop risk: needsCompaction fires when SUM(token_count)>40k; a merged row whose token_count>=40k re-triggers immediately. Fix options: cap merged token_count<40k (lossy on accounting), OR mark the merged row and exclude already-compacted content from the trigger SUM. (3) Existing compaction-service.test.ts asserts 0 rows remain -> must become 1 (assert merged row present, token_count<40k). (4) Embedding: CompactionService has no EmbeddingService dep; leaving summary_embedding NULL is acceptable (recall falls back to substring/recency for that row) or compute at the workspace-tools layer after compact(). Recommend NULL for now / defer. (5) FK safe (session_id REFERENCES sessions, session exists).
## Analysis: Step-by-step reasoning (Kimi)

Chose Option (b) over capping token_count (which is lossy and can freeze re-compaction). Plan: (1) ALTER conversation_summaries ADD COLUMN compacted INTEGER DEFAULT 0 (boolean; idempotent migration mirroring ensureEpisodicEmbeddingColumn / migrations.ts). (2) needsCompaction(): SUM(token_count) WHERE session_id=? AND COALESCE(compacted,0)=0 > threshold — only NOT-yet-compacted rows count, so a merged row never self-triggers. (3) compact(): keep selecting ALL rows (compacted + new) ORDER BY started_at ASC so re-compaction folds the prior merged row in; in the txn after DELETE, INSERT one merged row with compacted=1, token_count=totalTokens, ai_model='compaction', started_at=latest source started_at (so it sorts after originals). (4) Traced fresh + second compaction: after each compact() there are zero uncompacted rows -> needsCompaction false -> NO loop; recursive re-compaction still works when new summaries pile up. Edge: single >40k summary -> compacts once, folds into merged row, no loop. (5) Embedding: keep out of CompactionService (pure sqlite, no Ollama dep); merged row summary_embedding stays NULL, recall falls back to substring/recency for it — acceptable; optional follow-up to embed. (6) Tests: update compaction-service.test.ts (expect 1 compacted row, content preserved, token_count) + add recall-after-compaction test (compacted row is returned by session_recall) + needsCompaction-ignores-compacted test. Also update README line 56 (recall is now semantic-rerank, not substring-only) and document compaction keeps history recallable.

---

## Remaining Steps

- [ ] Decomposition: Task decomposition with dependencies (Kimi K2.5)
- [ ] Debate: Argue FOR the approach (Grok)
- [ ] Debate: Argue AGAINST + synthesize tensions (Gemini)
- [ ] Critique: Find holes and gaps (GPT)
- [ ] Judgment: Draft plan synthesis (Qwen)
- [ ] Judgment: Final plan in bite-sized TDD steps (Gemini)