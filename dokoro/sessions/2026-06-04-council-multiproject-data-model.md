# Council: dokoro multi-project data model

**Date:** 2026-06-04
**Question:** Per-project isolated DB (A) vs shared DB + workspace_id scope (B) vs hybrid (C, global affective + opt-in registry)?

## Verdict: A — keep per-project isolated DB. All 5 layers project-scoped. Confidence: HIGH.

### Why
- Affective tool-trust is **domain-bound, not global** — global aggregation degrades routing (mypy great in Python = noise for Rust). Kimi's insight, upheld by Gemini.
- Shared SQLite + N concurrent project servers = write-lock contention.
- Global store path breaks npx / Docker / CI ("just works" promise).
- Per-project = zero migration + perfect npx ergonomics.

### Future (opt-in only)
- `dokoro_export_semantic` tool → write generalized learnings to a flat file. No default global store.
- Reconsider hybrid (C) only if migrating SQLite → Postgres (client-server removes write-lock issue).

### Models
Research: grok_search + perplexity_ask. Debate: grok_reason (pro-hybrid) vs kimi_thinking (pro-isolated). Resolution: gemini_judge (resolve). openai_reason unavailable (quota).
