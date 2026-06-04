# Council: devlog-mcp licensing decision

**Date:** 2026-05-31
**Query:** "review the new license, check dual-license branch?, readme change — does it make sense?" (models: grok, gemini, kimi, qwen, opus)

## Premise correction (verified from repo)
- NO new license committed, NO dual-license branch exists. LICENSE = plain MIT, "Copyright (c) 2024 Anthropic, PBC". README still says MIT.
- devlog-mcp is a FORK of Anthropic's MCP TypeScript SDK ("based on MCP SDK v1.17.1"). SDK source is VENDORED into src/ (server/mcp.ts, client/*, streamableHttp.ts, inMemory.ts, examples/*).
- Maintainer is sole author, NO contributors → owns 100% of his own code (no CLA problem). The blocker is the vendored Anthropic MIT code, not contributors.

## Research (Phase 1)
- Dual-licensing needs near-total copyright ownership; can't relicense third-party (Anthropic) code, whose MIT notice must be preserved.
- Solo dual-licensing rarely worth enforcement/adoption cost; open-core is lighter; AGPL+commercial fits a real SaaS-competitor threat with a sales path.

## Debate (Phase 2)
- Grok (FOR): MIT lets competitors fork into closed SaaS; AGPL closes loophole + funds maintenance; act while solo.
- Kimi (AGAINST): copyright title defect (Anthropic named); MIT SDK baseline makes commercial tier toothless; solo enforcement impractical; no license instrument exists.
- Qwen (MIDDLE): can't touch Anthropic code; license your additions; open-core now; defer AGPL/BSL.

## Resolution (Gemini judge + Opus synthesis)
**Recommendation: De-vendor the SDK (consume @modelcontextprotocol/sdk via npm), stay MIT for core, go open-core if/when demand appears. Do NOT adopt AGPL+commercial.**

Why: the only blocker to free licensing is the vendored Anthropic code. De-vendoring makes src/ 100% Pawel's → full future optionality without AGPL enforcement burden.

Steps:
1. Diff src/server, src/client, src/shared vs upstream SDK v1.17.1 to assess divergence (gating step).
2. npm i @modelcontextprotocol/sdk@1.17.1, delete vendored files, repoint imports.
3. Rewrite LICENSE to Copyright (c) 2026 Pawel Pawlowski; keep README SDK acknowledgment.

What would change it: heavy SDK modification (can't de-vendor) → stay forked, keep Anthropic notice, license only own files. Concrete SaaS competitor + paying customer → revisit AGPL+commercial AFTER de-vendoring.

Confidence: High on diagnosis + "de-vendor & stay MIT". Medium on open-core as eventual model. Unverified: divergence from SDK v1.17.1.

---

## Follow-up council: "Can we de-vendor?" (qwen, kimi, gemini) — VERDICT: GO

### Verified on-disk facts
- 64 vendored SDK files; ~59 byte-identical to upstream 1.17.1.
- Only ONE behavioral patch: CancelledNotification.requestId made optional (types.ts:193, protocol.ts:233 guard). Memory layers never SEND a cancellation (0 grep) — receive-side tolerance only.
- max-listeners lives in Pawel's own src/shared/eventTargetConfig.ts (not an SDK patch).
- 3 own helpers in src/shared to relocate; examples/integration-tests/__mocks__/test-max-listeners.ts deletable (0 importers among memory layers).
- SDK imported via relative paths (../server/mcp.js) → rewire to @modelcontextprotocol/sdk/server/mcp.js.
- Latest SDK = 1.29.0 (pinned at 1.17.1). Canonical spec 2025-06-18 keeps requestId REQUIRED → version bump will NOT make it optional → must use patch-package to preserve the patch.

### Unanimous verdict: GO (clean swap, not a project). High confidence.
Decision point resolved: preserve requestId-optional via patch-package (NOT version bump — spec keeps it required). Optional: verify a real client sends requestId-less cancellations; if none do, drop the patch and run pure-stock.

### Migration plan
1. Relocate 3 own helpers out of src/shared.
2. Delete vendored SDK surface (server, client, shared/* SDK files, examples, integration-tests, __mocks__, inMemory.ts, server.ts, spec.types.ts, test-max-listeners.ts).
3. npm i @modelcontextprotocol/sdk@1.17.1 first (prove byte-clean), + patch-package; bump to 1.29.0 as a SEPARATE commit.
4. patch-package the requestId optionality if step-0 check shows it's needed; postinstall: patch-package.
5. Rewire relative SDK imports to package paths.
6. Build + test green before pruning.

Larger sequence confirmed: de-vendor → prune orphans → README (Gemini independently agreed on order).
