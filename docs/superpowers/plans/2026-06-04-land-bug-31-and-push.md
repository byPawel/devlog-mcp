# Land BUG-31 Fix and Push Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Verify the already-written BUG-31 migration/schema fix, commit it, integrate the diverged `origin/main` (which has PR #22), and push all commits.

**Architecture:** The BUG-31 fix repairs database init on *legacy* SQLite DBs that were created before later schema additions. Three problems, one root cause (`schema.sql` seeds `schema_version=1`, colliding with `MIGRATIONS` v1 so v1's table creation never ran): (1) `runMigrations` now calls `ensureEntityTables`/`ensureAgentFeedbackTable` unconditionally; (2) `ensureEntityTables` adds `valid_from` with a *constant* default then backfills (SQLite forbids non-constant NOT NULL defaults on ADD COLUMN); migration v2 tolerates a legacy `entity_relations` missing temporal columns; (3) new migration v7 creates `conversation_summaries` on legacy DBs, and `session_summary_add` inserts a placeholder `sessions` row to satisfy the FK. The code and its tests already exist in the working tree — this plan **verifies and lands** them; it does not re-derive them.

**Tech Stack:** TypeScript (ESM, strict), better-sqlite3 + Drizzle, Jest (`ts-jest`), Git.

---

## Current State (read before starting)

Uncommitted working-tree changes (the BUG-31 fix, 5 files):
- `src/db/migrations.ts` — unconditional base-table ensurers in `runMigrations`; new migration **v7** (`conversation_summaries`).
- `src/db/entity-tables.ts` — constant-default `valid_from` ADD COLUMN + backfill.
- `src/tools/workspace-tools.ts` — placeholder `sessions` row insert in `devlog_session_summary_add`.
- `src/db/migrations.test.ts` — +2 tests (v2 legacy survival, v7 creates table).
- `src/tools/workspace-tools.summary.test.ts` — +1 test (ad-hoc session under FK enforcement).

Branch divergence: `main` is **ahead 10, behind 1** of `origin/main`. The 1 behind is `2d64d96 chore: remove dead ChromaDB code (#22)`. PR #22 touches `server.ts`, `backup-recovery-tools.ts`, `chromadb-tools.ts`, `compression-tool.ts`, `enhanced-compression-helper.ts`, `lancedb-tools.ts`, `auto-capture.ts` — **no overlap** with the BUG-31 files.

Known flaky test (not a regression): an `allowedMethods` test occasionally fails once in a full-suite run but passes in isolation. If you see exactly that one failure, re-run it alone to confirm.

---

## Task 1: Verify the BUG-31 fix in isolation

The proof that the fix works is that its three targeted tests pass. Run them before anything else — if they fail, stop and report; do not commit.

**Files:**
- Test: `src/db/migrations.test.ts`
- Test: `src/tools/workspace-tools.summary.test.ts`

- [ ] **Step 1: Run the two new migration tests**

Run:
```sh
npx jest src/db/migrations.test.ts -t "BUG-31" -v
```
Expected: PASS — 2 tests:
- `migration v2 survives a legacy entity_relations that LACKS valid_from/valid_to (BUG-31)`
- `migration v7 creates conversation_summaries on a legacy DB that lacks it (BUG-31)`

- [ ] **Step 2: Run the new workspace-tools summary test**

Run:
```sh
npx jest src/tools/workspace-tools.summary.test.ts -t "BUG-31" -v
```
Expected: PASS — 1 test:
- `session_summary_add succeeds for an ad-hoc session label under FK enforcement (BUG-31)`

- [ ] **Step 3: Run both full test files (catch regressions in neighboring tests)**

Run:
```sh
npx jest src/db/migrations.test.ts src/tools/workspace-tools.summary.test.ts
```
Expected: PASS — all tests in both files green (the pre-existing v3/v4/v5/v6 migration tests and the existing summary tests must still pass).

---

## Task 2: Full verification (lint, build, whole suite)

Confirm the change is type-clean, lints, and doesn't regress the rest of the repo before committing.

**Files:** none (verification only)

- [ ] **Step 1: Lint**

Run:
```sh
npm run lint
```
Expected: exits 0, no errors. (Warnings that pre-date this change are acceptable; new errors are not.)

- [ ] **Step 2: Build (type-check + emit)**

Run:
```sh
npm run build
```
Expected: exits 0, no TypeScript errors.

- [ ] **Step 3: Full test suite**

Run:
```sh
npm test
```
Expected: all suites pass. **Exception:** the known-flaky `allowedMethods` test may fail once. If the ONLY failure is that test, run `npx jest -t "allowedMethods"` to confirm it passes in isolation, then treat the suite as green. Any other failure → stop and investigate (use superpowers:systematic-debugging).

---

## Task 3: Commit the BUG-31 fix

Commit exactly the 5 BUG-31 files. Do **not** stage the untracked `devlog/`, `.plan-cache/`, or `docs/` artifacts — they are unrelated working-session output.

**Files:**
- `src/db/migrations.ts`, `src/db/migrations.test.ts`, `src/db/entity-tables.ts`, `src/tools/workspace-tools.ts`, `src/tools/workspace-tools.summary.test.ts`

- [ ] **Step 1: Stage only the BUG-31 files**

Run:
```sh
git add src/db/migrations.ts src/db/migrations.test.ts src/db/entity-tables.ts \
        src/tools/workspace-tools.ts src/tools/workspace-tools.summary.test.ts
```

- [ ] **Step 2: Confirm the staged set is exactly those 5 files**

Run:
```sh
git status --short
```
Expected: the 5 files above show as staged (`M ` in the left column). Untracked `??` entries (`devlog/`, `.plan-cache/`, `docs/...`) remain unstaged. If anything else is staged, `git restore --staged <file>` it.

- [ ] **Step 3: Commit**

Run:
```sh
git commit -m "fix(db): repair DB init on legacy SQLite DBs (BUG-31)

- runMigrations: run ensureEntityTables/ensureAgentFeedbackTable
  unconditionally, since legacy DBs seeded schema_version=1 skipped
  MIGRATIONS v1 and never got the base tables.
- ensureEntityTables: ADD COLUMN valid_from with a constant default then
  backfill from created_at (SQLite forbids non-constant NOT NULL defaults).
- migration v2: tolerate a legacy entity_relations lacking valid_from/valid_to.
- migration v7: create conversation_summaries on pre-existing DBs.
- session_summary_add: insert a placeholder sessions row to satisfy the
  conversation_summaries.session_id FK for ad-hoc session labels.

Adds regression tests for the legacy-DB v2 survival, v7 table creation,
and FK-enforced ad-hoc summary insert."
```
Expected: commit succeeds; `git log --oneline -1` shows the new commit at HEAD.

---

## Task 4: Integrate origin/main (rebase onto PR #22)

`main` is 1 behind, so a plain push is rejected. Rebase the local commits (now 11) onto the fetched `origin/main`. The BUG-31 commit does not overlap PR #22. The only realistic conflict is in `src/server.ts`, edited by both the de-vendor commits and PR #22.

**Files:** none (git history operation; conflict resolution if prompted)

- [ ] **Step 1: Fetch latest remote state**

Run:
```sh
git fetch origin
```
Expected: completes; `git status -sb` still reports `ahead 11, behind 1` (11 = 10 de-vendor + BUG-31).

- [ ] **Step 2: Rebase onto origin/main**

Run:
```sh
git rebase origin/main
```
Expected (clean case): `Successfully rebased and updated refs/heads/main.`

If a conflict appears (most likely `src/server.ts`): open the conflicted file, keep BOTH intents — the MCP-SDK import changes from the de-vendor commit AND the ChromaDB removal from PR #22 (i.e., do not re-introduce ChromaDB code that #22 deleted; do keep the `@modelcontextprotocol/sdk` imports). Then:
```sh
git add <resolved-file>
git rebase --continue
```
Repeat until the rebase completes. To abort and reassess: `git rebase --abort` (returns to pre-rebase state — then stop and report).

- [ ] **Step 3: Re-verify after rebase**

Run:
```sh
npm run build && npm test
```
Expected: build clean; suite green (same flaky-`allowedMethods` exception as Task 2). A rebase can silently break things even with no textual conflict — this re-run is mandatory, not optional.

- [ ] **Step 4: Confirm history is linear and ahead-only**

Run:
```sh
git status -sb
git log --oneline origin/main..HEAD
```
Expected: status shows `ahead 11` and **not** `behind`; the log lists 11 commits ending in the BUG-31 fix.

---

## Task 5: Push

**Files:** none

- [ ] **Step 1: Push to origin/main**

Run:
```sh
git push origin main
```
Expected: push accepted, `origin/main` updated. (Because we rebased rather than merged, the push is a fast-forward and needs no force. If git unexpectedly demands `--force-with-lease`, stop — that means someone pushed again; re-fetch and re-evaluate.)

- [ ] **Step 2: Confirm fully synced**

Run:
```sh
git status -sb
```
Expected: `## main...origin/main` with no `ahead`/`behind`. The BUG-31 fix and all prior commits are now on the remote.

---

## Self-Review notes

- **Spec coverage:** Verify (Task 1–2) → commit (Task 3) → integrate divergence (Task 4) → push (Task 5). Covers the "verify the fix and commit" request plus the "+ push" the user selected.
- **Not committed by this plan:** untracked `devlog/`, `.plan-cache/`, and the various `docs/plans/*.md` / `docs/*.md` working artifacts. They are deliberately excluded from the BUG-31 commit. Decide separately whether any belong in the repo.
- **Migration version:** v7 is the correct next version (existing migrations run 1–6). Do not renumber.
- **Risk:** the only foreseeable rebase conflict is `src/server.ts` (de-vendor edits vs. PR #22 ChromaDB deletions); Task 4 Step 2 handles it. BUG-31 files have zero overlap with PR #22.
