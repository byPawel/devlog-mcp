# Multi-Agent Swarm Memory — Research & Dokoro Fit

**Date:** 2026-06-07
**Context:** Compiled while designing the "L3 Swarm" for `tachi-agent` (parallel
role-specialized agents → synthesizer). Cross-referenced against **dokoro v0.1.0**
source.
**Sources:** Grok (web), Perplexity, Gemini (Google-Search grounding), Kimi K2.6,
plus two Gemini-judge synthesis passes. Inline source URLs preserved in the
tachi-agent session transcript.

---

## TL;DR

- Dokoro's **API surface is already sufficient** for 2026-SOTA multi-agent swarms.
  Its primitives map ~1:1 onto every recommended pattern.
- The integration gaps are **consumer-side** (in tachi-agent), not dokoro-side.
- Dokoro's **runtime needs minor operational hardening** to survive high-frequency
  swarm use (presence TTL, compaction lock, optional strict session scoping,
  rate-limiting).

Gemini-judge one-liner: *"API is sufficient, but runtime needs operational
hardening; the true gap is consumer-side wiring."*

---

## 1. 2026 SOTA swarm memory & behavior (research consensus)

**Orchestration lifecycle:** decompose → route → execute (parallel) →
aggregate/resolve → **validate at a barrier** → terminate on **deterministic
gates** (tests pass / quality metric / consensus), not agent self-assessment.

**Memory rule (unanimous):** *"reason privately, publish selectively, commit
explicitly."* Isolated per-agent scratchpads during fan-out prevent
contamination / confirmation bias; shared memory holds only committed, validated
artifacts.

**Recommended shape:** **append-only event log underneath + version-locked
current-state on top.**

**Cross-contamination controls:** namespace isolation (project / role / agent),
scoped reads (read smallest scope first), versioning + visibility rules,
provenance (source / timestamp / owner), write policies (validate before
promotion to shared state).

**Coordination primitives:** handoff queues with **atomic exactly-once claim**;
**presence / heartbeat** liveness; **optimistic concurrency (CAS)** over
pessimistic locks.

**Termination / quorum:** max-turns + committed-output rules; quorum or human
gate for high-stakes commits.

**Emerging (not yet universal):** feedback / reputation-based tool routing.

**Documented pitfalls:** aggregator hallucination, judge drift, context
blow-up, false consensus (same model family / prompt), coordination overhead
("17× error trap"), token bloat (~10×), infinite correction loops, race
conditions on shared state.

---

## 2. Dokoro capability map (verified against source, v0.1.0)

| 2026 SOTA pattern | Dokoro primitive | Notes |
|---|---|---|
| isolated per-agent scratchpad | `session_recall(session_id)` / `session_summary_add` | recall supports `session_id` + `since` + semantic rerank |
| shared blackboard (append-only) | `shared_note_append` / `shared_note_read` | `agent_id`-tagged; filter by agent / type / since |
| version-locked current-state (CAS) | `block_write` / `block_read` / `block_list` | optimistic `version` compare-and-set; conflict on stale write |
| handoff queue (atomic claim) | `handoff_write` / `handoff_inbox` / `handoff_claim` | `UPDATE … WHERE status='open'` → exactly-once |
| presence / liveness | `presence_ping` / `presence_list` | TTL default 900s |
| feedback / reputation routing | `feedback_record` / `feedback_query` / `feedback_route` | Wilson-bounded ranking, recency decay |
| namespace isolation + concurrency | per-project SQLite **WAL**, `agent_id` tagging, server timestamps | `foreign_keys=ON`, `busy_timeout=5000ms` |

**Storage:** per-project SQLite (WAL). `conversation_summaries` is append-only
INSERT with auto-compaction over a token threshold. Embeddings via Ollama
`nomic-embed-text` with offline-safe fallback to substring `LIKE`.

**Key source refs:** `src/tools/workspace-tools.ts:584-741` (recall / summary_add),
`src/db/schema.ts:298-319` (`conversation_summaries`), `src/db/index.ts`
(WAL/pragmas), plus `shared-notes-tools.ts`, `shared-blocks-tools.ts`,
`handoff-tools.ts`, `presence-tools.ts`, `feedback-tools.ts`.

---

## 3. Recommended improvements

### Dokoro-side (operational hardening — optional / minor)

- **Presence TTL:** reduce default from 900s toward ~30–60s for accurate swarm
  routing (dead agents currently linger up to 15 min).
- **Compaction off the write path:** `CompactionService` holds an implicit lock
  during episodic merge → can cause `busy_timeout` stalls for concurrent writers.
  Move to a background thread / yield locks.
- **Strict session scoping (optional):** consider a mode where `session_recall`
  requires `session_id` instead of silently reading globally when omitted.
- **Rate-limiting / backpressure:** prevent WAL writer starvation under many
  concurrent agents (today only `busy_timeout` guards this).
- **(Future) episodic auto-archival** to bound unbounded DB growth.

### Consumer-side (tachi-agent wiring — the real gaps)

- **Bug:** `src/memory/dokoro.ts` `recall()` sends only `{query, limit}` — never
  `session_id` — so it reads **globally across all sessions**. Dokoro's
  `session_recall` *does* support `session_id`. Fix = pass it (and give each agent
  its own `sessionId` for isolation). Affects single-agent mode too.
- **Allowlist:** `DEFAULT_ALLOW` exposes only `session_recall`,
  `session_summary_add`, `workspace_status` — the multi-agent tools
  (note / block / handoff / presence / feedback) are hidden. Widen it for swarms.
- **Coordination swarm (future):** use `handoff_write/claim` + `shared_block`
  (with optimistic-retry on CAS conflict) for task-decomposition swarms.

---

## 4. Application to tachi-agent's "L3 Swarm v1"

- **v1 = perspective swarm:** parallel role agents (implementer / critic /
  researcher) → synthesizer. Members are **memory-less across runs**: a unique
  `traceId` per run scopes each member's session
  (`swarm:<traceId>:<role>`) so it cannot recall peers **or** prior swarm runs.
  Rationale (Gemini-judge, high confidence): cross-invocation continuity is an
  anti-pattern for single-shot perspective swarms — it causes state drift and
  breaks deterministic testing.
- **Final log:** only the orchestrator writes the synthesized result once under
  `swarm:<traceId>` → race-free audit trace.
- **recall `session_id` fix** lands in v1 (also fixes single-agent recall).
- **Blackboard / handoff coordination** is the **coordination-swarm** follow-up;
  dokoro is already ready for it.
- **Deferred to v2:** declarative role manifest (Terraform-like; JSON dep-free or
  YAML w/ one dep), structured member outputs, semantic dedup, dokoro operational
  hardening above.
