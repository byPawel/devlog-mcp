# De-vendor the MCP TypeScript SDK — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop vendoring Anthropic's MCP TypeScript SDK inside `src/` and consume `@modelcontextprotocol/sdk` from npm instead, so `src/` contains only Pawel's own code — with byte-clean runtime equivalence proven before any version bump.

**Architecture:** devlog-mcp is currently a *fork* of the MCP TS SDK ("based on MCP SDK v1.17.1") with ~59 SDK files vendored under `src/`. The migration rewires every relative SDK import (`../server/mcp.js`, `../types.js`, …) to package subpaths (`@modelcontextprotocol/sdk/...`) **while the vendored files still exist**, runs the full jest suite against the npm package to prove equivalence, **then** deletes the now-unreferenced vendored files. De-vendor (pinned `@1.17.1`) and the later `@1.29.0` bump are kept as **separate commits** so any behavior change is isolated.

**Tech Stack:** TypeScript (`module`/`moduleResolution: Node16`, ESM, `.js` import extensions), jest, `@modelcontextprotocol/sdk`.

---

## File Structure

**Keep in place (Pawel's code — do NOT move):**
- `src/db/`, `src/services/`, `src/tools/`, `src/servers/`, `src/config/`, `src/utils/`, `src/types/` (note: the *directory* `src/types/` is Pawel's; the *file* `src/types.ts` is the SDK's).
- `src/shared/constants.ts`, `src/shared/devlog-utils.ts`, `src/shared/eventTargetConfig.ts` — Pawel's helpers. They live alongside SDK files today; after the SDK files are deleted they are the only residents of `src/shared/`. **No relocation, no import changes** for these (10+ importers of `devlog-utils` are untouched because the path `shared/devlog-utils.js` is unchanged).

**Delete (vendored SDK):**
- Dirs: `src/server/`, `src/client/`, `src/examples/`, `src/integration-tests/`, `src/__mocks__/`
- Root files: `src/types.ts` (52 KB SDK Zod schemas), `src/inMemory.ts`, `src/inMemory.test.ts`, `src/server.ts`, `src/spec.types.test.ts`, `src/test-max-listeners.ts`, `src/cli.ts`, and the repo-root **generated** `spec.types.ts` (gitignored — `rm -f`, handled in Task 5) (the SDK's "mcp-typescript test client" example — imports vendored `./client/*`,`./server/*`; **not** Pawel's CLI, which is `src/devlog-cli.ts`)
- SDK files inside `src/shared/`: `protocol.ts`, `protocol.test.ts`, `protocol-transport-handling.test.ts`, `transport.ts`, `stdio.ts`, `stdio.test.ts`, `uriTemplate.ts`, `uriTemplate.test.ts`, `auth.ts`, `auth-utils.ts`, `auth-utils.test.ts`, `metadataUtils.ts`

**Modify:**
- 30 files: rewire SDK-type imports → `@modelcontextprotocol/sdk/types.js` (Task 3).
- 4 files (`src/devlog-server.ts`, `src/devlog-http-server.ts`, `src/servers/base-server.ts`, `src/tools/registry.ts`): rewire `server/`·`client/` imports → package subpaths (Task 4).
- `package.json`: add SDK dependency (Task 2), drop `fetch:spec-types` from the `test` script (Task 5), bump version (Task 8).

---

## The one behavioral decision: `CancelledNotification.requestId`

The only non-identical SDK file is the `requestId`-optional patch (`src/types.ts` + `src/shared/protocol.ts`). **Recommendation: DROP it.** Rationale:
- devlog-mcp **never sends** a `CancelledNotification` (0 usages in `db`/`services`/`tools`/`servers`).
- The canonical MCP spec keeps `requestId` **required**, so no SDK version restores the optional behavior.
- `patch-package` would only patch the maintainer's local `node_modules`, **not** consumers of the published `@devlog-mcp/core` — so the patch can't survive distribution anyway.
- Failure mode of dropping: if a *misbehaving* client sent `notifications/cancelled` without `requestId`, the stock SDK drops it (a Zod parse failure during dispatch) and the request continues — a benign edge case for a memory server, not a crash.

Task 1 documents this decision; if a real client is later found to depend on it, handle it in Pawel's *own* transport/handler code, never via re-vendoring.

---

### Task 1: Pre-flight verification + record the requestId decision

**Files:**
- Create: `docs/superpowers/plans/devendor-preflight.md` (decision record)

- [ ] **Step 1: Snapshot the current green suite**

Run: `npm test 2>&1 | tail -20`
Expected: full jest suite PASSES (baseline). If anything fails now, stop and fix before migrating.

- [ ] **Step 2: Confirm the SDK is not already a dependency**

Run: `grep -c "@modelcontextprotocol/sdk" package.json`
Expected: `0` (currently vendored, not a dependency).

- [ ] **Step 3: Re-confirm the exact rewire surface hasn't drifted**

Run:
```bash
grep -rln "from '\(\.\./\|\./\)types\.js'" src --include=*.ts \
  | grep -vE "^src/(server|client|examples|integration-tests|__mocks__)/" \
  | grep -vE "^src/(types|inMemory|server|spec\.types)\.ts$" \
  | grep -vE "^src/shared/(protocol|transport|stdio|uriTemplate|auth|auth-utils|metadataUtils)" \
  | grep -v "src/utils/themes/" | sort | tee /tmp/sdk-type-importers.txt | wc -l
```
Expected: `31` paths (30 live + `src/test-max-listeners.ts` which will be deleted).

- [ ] **Step 4: Write the decision record**

Create `docs/superpowers/plans/devendor-preflight.md`:
```markdown
# De-vendor pre-flight decision

- requestId patch: DROP. devlog-mcp never sends CancelledNotification;
  spec keeps requestId required; patch-package can't reach published
  consumers. Stock @modelcontextprotocol/sdk behavior accepted.
- Baseline suite: green (see Step 1 output).
- Rewire surface: 31 type-importers, 4 server/client importers (verified).
```

- [ ] **Step 5: Commit**

```bash
git checkout -b chore/devendor-sdk
git add docs/superpowers/plans/devendor-preflight.md
git commit -m "docs: record de-vendor pre-flight decision (drop requestId patch)"
```

---

### Task 2: Add `@modelcontextprotocol/sdk@1.17.1` as an exact dependency + write the guard test

**Files:**
- Modify: `package.json` (dependencies)
- Create: `src/devendor-guard.test.ts`

- [ ] **Step 1: Install the SDK pinned to the forked baseline version**

Run: `npm install --save-exact @modelcontextprotocol/sdk@1.17.1`
Expected: `package.json` dependencies now contain `"@modelcontextprotocol/sdk": "1.17.1"`; lockfile updated.

- [ ] **Step 2: Write the failing guard test (red)**

Create `src/devendor-guard.test.ts`:
```typescript
import { existsSync } from 'node:fs';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

const VENDORED_PATHS = [
  'src/server',
  'src/client',
  'src/types.ts',
  'src/inMemory.ts',
  'src/spec.types.ts',
  'src/shared/protocol.ts',
  'src/shared/transport.ts',
];

describe('SDK is de-vendored', () => {
  it.each(VENDORED_PATHS)('no vendored SDK path present: %s', (p) => {
    expect(existsSync(p)).toBe(false);
  });

  it('McpServer resolves from the npm package', () => {
    expect(typeof McpServer).toBe('function');
  });

  it('CallToolResult type is importable from the package', () => {
    const r: CallToolResult = { content: [] };
    expect(r.content).toEqual([]);
  });
});
```

- [ ] **Step 3: Run the guard test to verify it fails**

Run: `npx jest src/devendor-guard.test.ts`
Expected: FAIL — the `it.each` cases fail because vendored paths still exist (the package import lines compile because the SDK is now installed).

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json src/devendor-guard.test.ts
git commit -m "chore: add @modelcontextprotocol/sdk@1.17.1 + de-vendor guard test (red)"
```

---

### Task 3: Rewire the 30 live SDK-type imports → package

**Files:**
- Modify (30): `src/devlog-server.ts`, `src/devlog-http-server.ts`, and all 28 files under `src/tools/` listed in `/tmp/sdk-type-importers.txt` (excluding `src/test-max-listeners.ts`, which is deleted in Task 6).

- [ ] **Step 1: Rewire only the SDK `types.js` imports (never `../types/…` or themes)**

Run (operates on the verified list, dropping the to-be-deleted file):
```bash
cd /Users/gravity/Documents/WORK/TACHIBOT_ALL/devlog-mcp
grep -v 'src/test-max-listeners.ts' /tmp/sdk-type-importers.txt | while read -r f; do
  # Only the exact SDK root types import — leaves '../types/ai-types.js' etc. untouched
  perl -0pi -e "s{from '(\.\./|\./)types\.js'}{from '\@modelcontextprotocol/sdk/types.js'}g" "$f"
done
```

- [ ] **Step 2: Verify no stray relative SDK-types import remains, and subdir imports survived**

Run:
```bash
echo "--- should be 0 (no relative SDK types left in rewired files) ---"
grep -rn "from '\(\.\./\|\./\)types\.js'" $(grep -v 'src/test-max-listeners.ts' /tmp/sdk-type-importers.txt) | wc -l
echo "--- your own types/ subdir imports must be intact ---"
grep -rn "from '\.\./types/" src/tools | head
```
Expected: first count `0`; second still shows `../types/ai-types.js` etc.

- [ ] **Step 3: Type-check (vendored SDK still present — both should resolve identically)**

Run: `npx tsc --noEmit`
Expected: no new errors. (`@modelcontextprotocol/sdk@1.17.1` re-exports `CallToolResult`, `isInitializeRequest`, `GetPromptResult`, `ReadResourceResult` — the symbols these files import.)

- [ ] **Step 4: Run the suite — green against the package**

Run: `npx jest`
Expected: PASS (guard test still red on the file-existence cases; everything else green).

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "refactor: import MCP types from @modelcontextprotocol/sdk (30 files)"
```

---

### Task 4: Rewire the 4 server/client SDK imports → package

**Files:**
- Modify: `src/devlog-server.ts:6-7`, `src/devlog-http-server.ts:9-10`, `src/servers/base-server.ts:6-7`, `src/tools/registry.ts:1`

- [ ] **Step 1: Rewire each server/client specifier**

Apply these exact replacements:
```text
src/devlog-server.ts
  from './server/mcp.js'             -> from '@modelcontextprotocol/sdk/server/mcp.js'
  from './server/stdio.js'           -> from '@modelcontextprotocol/sdk/server/stdio.js'

src/devlog-http-server.ts
  from './server/mcp.js'             -> from '@modelcontextprotocol/sdk/server/mcp.js'
  from './server/streamableHttp.js'  -> from '@modelcontextprotocol/sdk/server/streamableHttp.js'

src/servers/base-server.ts
  from '../server/mcp.js'            -> from '@modelcontextprotocol/sdk/server/mcp.js'
  from '../server/stdio.js'          -> from '@modelcontextprotocol/sdk/server/stdio.js'

src/tools/registry.ts
  from '../server/mcp.js'            -> from '@modelcontextprotocol/sdk/server/mcp.js'
```

- [ ] **Step 2: Confirm no Pawel file still reaches into vendored `server/`·`client/`**

Run:
```bash
grep -rn "from '[^']*\(\.\./\|\./\)\(server\|client\)/" src --include=*.ts \
  | grep -vE "^src/(server|client|examples|integration-tests|__mocks__)/" \
  | grep -v 'src/test-max-listeners.ts'
```
Expected: no output.

- [ ] **Step 3: Type-check + full suite**

Run: `npx tsc --noEmit && npx jest`
Expected: PASS (only the guard file-existence cases remain red).

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "refactor: import MCP server/client transports from @modelcontextprotocol/sdk"
```

---

### Task 5: Drop the SDK spec-conformance harness

**Files:**
- Delete: `src/spec.types.test.ts` (tracked) and `spec.types.ts` (repo-root, **gitignored/generated** by `fetch:spec-types` — not a `src/` file)
- Modify: `package.json` (`test` script + remove `fetch:spec-types`)

`src/spec.types.test.ts` is the SDK's own internal test (asserts `./types.js` ⇄ `../spec.types.js` mutual assignability, where `../spec.types.js` resolves to the repo-root `spec.types.ts`); `fetch:spec-types` curls the spec schema into root `spec.types.ts` for it. Both are meaningless once the SDK is a dependency.

- [ ] **Step 1: Remove the spec test (tracked) and the generated root artifact (untracked)**

Run:
```bash
git rm src/spec.types.test.ts
rm -f spec.types.ts        # repo-root generated file, gitignored — plain rm, not git rm
```

- [ ] **Step 2: Update `package.json` scripts**

Change the `test` script from:
```json
"test": "npm run fetch:spec-types && jest",
```
to:
```json
"test": "jest",
```
and delete the `fetch:spec-types` script line:
```json
"fetch:spec-types": "curl -o spec.types.ts https://raw.githubusercontent.com/modelcontextprotocol/modelcontextprotocol/refs/heads/main/schema/2025-06-18/schema.ts",
```

- [ ] **Step 3: Verify `npm test` runs jest directly**

Run: `npm test 2>&1 | tail -15`
Expected: jest runs without the curl step; suite passes (guard still red on existence cases).

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "chore: drop SDK spec-conformance test and fetch:spec-types script"
```

---

### Task 6: Delete the vendored SDK surface

**Files:** all paths in the "Delete (vendored SDK)" list above, except the spec files already removed in Task 5.

- [ ] **Step 1: Delete vendored dirs and root SDK files**

Run:
```bash
git rm -r src/server src/client src/examples src/integration-tests src/__mocks__
git rm src/types.ts src/inMemory.ts src/inMemory.test.ts src/server.ts src/test-max-listeners.ts src/cli.ts
```
(`src/cli.ts` is the SDK example test client; the `server`/`client` npm scripts that invoke it are removed in Task 8.)

- [ ] **Step 2: Delete SDK files inside `src/shared/` (keep the 3 helpers)**

Run:
```bash
git rm src/shared/protocol.ts src/shared/protocol.test.ts \
       src/shared/protocol-transport-handling.test.ts \
       src/shared/transport.ts src/shared/stdio.ts src/shared/stdio.test.ts \
       src/shared/uriTemplate.ts src/shared/uriTemplate.test.ts \
       src/shared/auth.ts src/shared/auth-utils.ts src/shared/auth-utils.test.ts \
       src/shared/metadataUtils.ts
```

- [ ] **Step 3: Confirm `src/shared/` now holds only Pawel's helpers**

Run: `ls src/shared/`
Expected: exactly `constants.ts  devlog-utils.ts  eventTargetConfig.ts` (+ any of their own tests).

- [ ] **Step 4: Type-check + full suite (now nothing references deleted files)**

Run: `npx tsc --noEmit && npx jest`
Expected: PASS — **including** the guard test, which now goes fully green (all vendored paths gone, package imports resolve). If `tsc` reports a missing module, an import was missed — fix it before committing.

> **Transitional-diagnostic note:** during Tasks 4–5 the editor/LSP may show a type-identity error at `src/servers/base-server.ts:53` (npm-package `McpServer` vs vendored `src/server/mcp` `McpServer`, "separate declarations of private property `_clientCapabilities`"). `tsc --noEmit` already exits 0 through those tasks; the LSP warning is a stale dual-type artifact. Deleting vendored `src/server/` in this task removes the duplicate type source — **confirm this diagnostic is gone after Step 4** (it is structurally guaranteed to clear).

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "chore: remove vendored MCP SDK source (consume @modelcontextprotocol/sdk)"
```

---

### Task 7: package.json cleanup — remove fork-inherited dead scripts & metadata

**Files:** Modify `package.json`

After Task 6, several scripts point at deleted files. Clean them so `package.json` reflects a de-vendored project.

- [ ] **Step 1: Remove dead scripts referencing deleted vendored files**

Delete these script lines:
```json
"examples:simple-server:w": "tsx --watch src/examples/server/simpleStreamableHttp.ts --oauth",
"server": "tsx watch --clear-screen=false src/cli.ts server",
"client": "tsx src/cli.ts client",
```
And fix `start`, which chains to the now-removed `server` script — repoint it to the core server:
```json
"start": "npm run server:core",
```

- [ ] **Step 2: De-fork the package description**

Change:
```json
"description": "Developer logging and workspace management MCP servers for multiple AI CLIs (based on MCP SDK v1.17.1)",
```
to:
```json
"description": "Multi-layer agent-memory MCP server (working, episodic, semantic, procedural, affective) for Claude Code and any MCP client.",
```

- [ ] **Step 3: Verify no script references a deleted path**

Run:
```bash
grep -nE "src/cli\.ts|src/examples|src/client|src/server/|spec-types|inMemory|simpleStreamableHttp" package.json
```
Expected: no output.

- [ ] **Step 4: Sanity-check the scripts that remain actually run**

Run: `npm run build && node bin/devlog-core.js --help 2>&1 | head -3`
Expected: build succeeds; core server entrypoint resolves.

- [ ] **Step 5: Commit**

```bash
git add package.json
git commit -m "chore: drop fork-inherited dead scripts and de-fork package description"
```

---

### Task 8: Prove byte-clean de-vendor at `@1.17.1` (checkpoint commit)

**Files:** none (verification only)

- [ ] **Step 1: Clean build from scratch**

Run: `rm -rf dist && npm run build`
Expected: ESM + servers build succeeds with no vendored references.

- [ ] **Step 2: Full suite + lint**

Run: `npm test && npm run lint`
Expected: all green. This is the **de-vendor-complete** state on `@1.17.1` — equivalence proven before any upgrade.

- [ ] **Step 3: Smoke-test a server entrypoint actually boots**

Run: `node bin/devlog-core.js --help 2>&1 | head -5` (or `npm run dev:core` briefly)
Expected: starts without `MODULE_NOT_FOUND`.

- [ ] **Step 4: Tag the checkpoint**

```bash
git tag devendor-complete-1.17.1
```

---

### Task 9: README cleanup — reflect the de-vendored project

**Files:** Modify `README.md`

The README is already a curated devlog-mcp product README; only a few spots reference the deleted vendored layout or the fork relationship.

- [ ] **Step 1: Remove the deleted `examples/` line from the project-structure tree**

In the `### Project structure` block (around line 365), delete:
```text
└── examples/             # Usage examples
```
and re-point the preceding `docs/` branch glyph so the tree still terminates cleanly:
```text
├── docs/                 # Architecture notes and plans
```
becomes the last `└──` entry:
```text
└── docs/                 # Architecture notes and plans
```

- [ ] **Step 2: Reframe the SDK relationship as a dependency, not a fork**

In `## Acknowledgments` (around line 376), change:
```text
- Built on the [MCP TypeScript SDK](https://github.com/modelcontextprotocol/typescript-sdk) by Anthropic.
- Original SDK © 2024 Anthropic, PBC — MIT License.
```
to:
```text
- Depends on the [MCP TypeScript SDK](https://github.com/modelcontextprotocol/typescript-sdk) (`@modelcontextprotocol/sdk`) by Anthropic, used under its MIT License.
```
Leave the top-of-file `> **Built on** Anthropic's MCP TypeScript SDK.` line and the License badge/section unchanged — the LICENSE rewrite is a separate, deliberate step (tracked in the licensing decision), not part of de-vendoring.

- [ ] **Step 3: Verify no stale vendored references remain in the README**

Run:
```bash
grep -nE "examples/|src/cli|simpleStreamableHttp|spec\.types" README.md
```
Expected: no output.

- [ ] **Step 4: Commit**

```bash
git add README.md
git commit -m "docs: align README with de-vendored project (drop examples/, reframe SDK as dependency)"
```

---

### Task 10: Bump to `@1.29.0` (separate commit)

**Files:** Modify `package.json` (dependency version)

- [ ] **Step 1: Upgrade the SDK**

Run: `npm install --save-exact @modelcontextprotocol/sdk@1.29.0`
Expected: dependency now `1.29.0`; lockfile updated.

- [ ] **Step 2: Type-check for breaking API changes across 12 minor versions**

Run: `npx tsc --noEmit`
Expected: ideally clean. If errors appear, they are isolated to this commit (the point of separating it). Fix imports/signatures per the SDK changelog.

- [ ] **Step 3: Full suite + build + smoke test**

Run: `npm test && npm run build && node bin/devlog-core.js --help 2>&1 | head -5`
Expected: all green.

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: bump @modelcontextprotocol/sdk to 1.29.0"
```

---

## Self-Review

**Spec coverage:** delete vendored SDK ✅ (Tasks 5,6 incl. `src/cli.ts`) · rewire imports ✅ (Tasks 3,4) · keep `src/` = Pawel's code ✅ (helpers kept in place, Task 6 Step 3) · requestId decision ✅ (Task 1, dropped) · package.json cleanup ✅ (Task 7) · README cleanup ✅ (Task 9) · separate de-vendor vs bump commits ✅ (Task 8 tag, Task 10) · no orphaned imports ✅ (Task 4 Step 2, Task 6 Step 4 `tsc`).

**Placeholder scan:** every code/command step contains literal commands and the exact replacement strings; the 30-file list is materialized to `/tmp/sdk-type-importers.txt` in Task 1 Step 3.

**Type consistency:** symbol names used (`McpServer`, `CallToolResult`, `StdioServerTransport`, `StreamableHTTPServerTransport`, `isInitializeRequest`) match the existing imports and the SDK's public exports; the guard test type-name `CallToolResult` matches Task 3's rewired import.

**Risks:** (1) `@1.17.1` may not be published to npm with an identical layout to the fork — Task 2 Step 1 surfaces this immediately; if unavailable, jump the pin to the nearest published `1.1x`. (2) `tsc` under `Node16` is strict about subpath exports — Task 3 Step 3 / Task 4 Step 3 catch any resolution gap before deletion.
