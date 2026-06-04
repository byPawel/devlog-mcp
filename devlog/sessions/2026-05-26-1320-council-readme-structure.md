# Council: Optimal README structure for dokoro

**Date:** 2026-05-26
**Query:** How should the dokoro README be structured to convert agent developers — examples-first vs moat-first — and which examples prove memory value?

## Pipeline
Research (Phase 1, reused) → Debate (grok FOR / kimi AGAINST; openai dropped on quota) → Reasoning chain (grok→kimi→gemini) → Gemini final judge.

## Options scored (criteria: proof-of-moat .30, time-to-get-it .25, scannability .20, copy-paste .15, demoware-avoidance .10)
- A (shipped PR#3): 2.85
- B (moat-first): 3.80
- C (hybrid): **4.35 — WINNER**

## Decision (High confidence)
Section order: Hook transcript → Moat-proof JSON → 5-layer taxonomy → Tools → Compatibility → Install.
- CUT the Mermaid weekly pie chart (decorative; signals bloat).
- ADD two moat-proof examples right after the transcript:
  - `dokoro_feedback_query` → per-tool success_rate driving routing (Affective layer).
  - `dokoro_entity_graph` with `as_of` → bi-temporal fact (valid_from/valid_to, superseded_by).
- Keep Claude Code hero in the ONE transcript; neutralize framing; keep compatibility table.
- Wrap example JSON in real MCP JSON-RPC envelope for copy-paste.
- Tagline candidate: "Agent memory with affective routing and bi-temporal facts."

## Note / tension
User EXPLICITLY asked earlier to bring the pie chart back; council recommends cutting it. Needs user decision.
