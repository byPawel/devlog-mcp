# Ollama Embed Timeout (#19) + CI Flake Diagnosis (#20) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** (Task 1, #19) Make `EmbeddingService` fail fast when Ollama is unreachable so `session_summary_add`/`session_recall` never hang. (Task 2, #20) Diagnose and fix the cross-suite MCP request leak that intermittently reddens CI via the `allowedMethods` test.

**Architecture:** Task 1 wraps both `EmbeddingService` HTTP calls in an `AbortController` timeout (default 5s, env-overridable, timer `unref`'d), then throws — existing callers already catch and fall back, so behavior degrades gracefully and *fast*. Task 2 is investigation-led: reproduce the leak deterministically, identify the suite that leaves a pending MCP request/open transport, and add proper teardown.

**Tech Stack:** TypeScript (ESM, `.js` imports), Jest (plain `npx jest`), better-sqlite3, MCP TS SDK transports.

> **Scope note:** These are two independent subsystems (our embeddings code vs. forked SDK test infra). Task 1 is fully specified and high value — do it first and it can ship on its own. Task 2 is a diagnosis spike: the exact fix line is only knowable after step 2's reproduction pins the leaker, so its remediation step states the concrete pattern to apply rather than a fabricated diff.

---

## File Structure

| File | Responsibility | Task |
|---|---|---|
| `src/services/vector-service.ts` | Add timeout to `callOllama` + `healthCheck` | 1 |
| `src/services/embedding-timeout.test.ts` (new) | Prove embed rejects fast on a hanging endpoint | 1 |
| (TBD by diagnosis) one `*.test.ts` under `src/server` / `src/client` / `src/integration-tests` | Add `afterEach` teardown that closes the leaked transport | 2 |

---

## Task 1: Fast-fail timeout for Ollama calls (#19)

**Files:**
- Modify: `src/services/vector-service.ts:129-154` (`callOllama`) and `:165-175` (`healthCheck`)
- Test: `src/services/embedding-timeout.test.ts` (create)

- [ ] **Step 1: Write the failing test**

Create `src/services/embedding-timeout.test.ts`:

```typescript
import { EmbeddingService } from './vector-service.js';

describe('EmbeddingService timeout', () => {
  const realFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = realFetch;
    delete process.env.OLLAMA_TIMEOUT_MS;
  });

  it('rejects quickly when the endpoint hangs (no indefinite wait)', async () => {
    process.env.OLLAMA_TIMEOUT_MS = '50';
    // fetch that never resolves on its own — only an abort signal ends it.
    globalThis.fetch = ((_url: string, opts: { signal?: AbortSignal }) =>
      new Promise((_resolve, reject) => {
        opts.signal?.addEventListener('abort', () =>
          reject(Object.assign(new Error('aborted'), { name: 'AbortError' })),
        );
      })) as unknown as typeof fetch;

    const svc = new EmbeddingService('http://10.255.255.1:11434'); // unroutable
    const started = Date.now();
    await expect(svc.embed('hello world')).rejects.toThrow();
    expect(Date.now() - started).toBeLessThan(1000); // failed fast, not hung
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/services/embedding-timeout.test.ts`
Expected: FAIL — the promise never rejects (no abort wired), so the test times out / does not complete fast. (Confirms the hang the fix removes.)

- [ ] **Step 3: Implement the timeout in `callOllama`**

In `src/services/vector-service.ts`, replace the body of `callOllama` (lines 129-154) with:

```typescript
  private async callOllama(cleanText: string): Promise<EmbeddingResult> {
    const timeoutMs = Number(process.env.OLLAMA_TIMEOUT_MS) || 5000;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    if (typeof timer.unref === 'function') timer.unref(); // don't keep the event loop alive
    try {
      const response = await fetch(`${this.ollamaUrl}/api/embed`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: this.model, input: cleanText }),
        signal: controller.signal,
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error(`[Embedding] Ollama error: ${response.status} - ${errorText.slice(0, 200)}`);
        throw new Error(`Ollama embedding failed: ${response.statusText}`);
      }

      const data = await response.json() as { embeddings: number[][] };
      const embedding = data.embeddings[0];
      if (!embedding || embedding.length === 0) {
        throw new Error('No embedding returned from Ollama');
      }
      const tokenCount = Math.ceil(cleanText.length / APPROX_CHARS_PER_TOKEN);
      return { embedding, tokenCount };
    } finally {
      clearTimeout(timer);
    }
  }
```

- [ ] **Step 4: Apply the same timeout to `healthCheck`**

In `src/services/vector-service.ts`, replace `healthCheck` (lines 165-175) with:

```typescript
  async healthCheck(): Promise<boolean> {
    const timeoutMs = Number(process.env.OLLAMA_TIMEOUT_MS) || 5000;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    if (typeof timer.unref === 'function') timer.unref();
    try {
      const response = await fetch(`${this.ollamaUrl}/api/tags`, { signal: controller.signal });
      if (!response.ok) return false;
      const data = await response.json() as { models: { name: string }[] };
      return data.models.some(m => m.name.includes(this.model));
    } catch {
      return false;
    } finally {
      clearTimeout(timer);
    }
  }
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx jest src/services/embedding-timeout.test.ts`
Expected: PASS — `embed()` rejects in well under 1s.

- [ ] **Step 6: Run the embedding/vector suites for regressions**

Run: `npx jest src/services/embedding-cache.test.ts src/services/chunking.test.ts`
Expected: PASS (no behavior change when fetch resolves normally).

- [ ] **Step 7: Commit**

```bash
git add src/services/vector-service.ts src/services/embedding-timeout.test.ts
git commit -m "fix(embeddings): add abortable timeout to Ollama calls (closes #19)"
```

---

## Task 2: Diagnose & fix the cross-suite MCP leak (#20)

**Investigation-led** — the leaker is one of the SDK transport suites; pin it before editing.

**Files:**
- Modify (determined by Step 2): one of `src/server/{mcp,index,title,sse}.test.ts`, `src/shared/protocol-transport-handling.test.ts`, `src/client/{index,stdio}.test.ts`, `src/integration-tests/process-cleanup.test.ts` — the candidates that currently have **no `afterEach`/`afterAll` teardown** yet open transports/clients.

- [ ] **Step 1: Reproduce deterministically**

Run the full suite with open-handle detection several times and capture the leak:

```bash
for i in 1 2 3 4 5; do NODE_OPTIONS=--experimental-vm-modules npx jest --detectOpenHandles 2>&1 | tee /tmp/jest-$i.log | grep -E "open handle|Jest did not exit|-32001|allowedMethods|leaking"; echo "--- run $i ---"; done
```
Expected: at least one run shows `-32001`/leak warning, and `--detectOpenHandles` prints the stack of the un-closed timer/socket — that stack names the source file.

- [ ] **Step 2: Identify the leaking suite**

From the `--detectOpenHandles` stack(s), find the test file that opens an MCP `Client`/transport and never `await`s `close()`. Cross-reference the candidate list (suites that connect transports but have no teardown):

```bash
for f in $(grep -rlnE "new Client\\(|ClientTransport|\\.connect\\(" src --include=*.test.ts); do grep -qE "afterEach|afterAll" "$f" || echo "NO TEARDOWN: $f"; done
```
Pick the file whose stack matches the open handle. Confirm it's the leaker by running it back-to-back with `allowedMethods`:

```bash
npx jest <leaker>.test.ts src/server/auth/middleware/allowedMethods.test.ts --runInBand
```
Expected: the `-32001` now attaches to `allowedMethods` reproducibly when the leaker runs first.

- [ ] **Step 3: Add teardown that closes the transport (write the fix as a failing-then-passing guard)**

In the identified suite, ensure every opened `client`/`server`/transport is closed. Apply this concrete pattern (adapt variable names to the suite):

```typescript
// at top of the describe block
let openClient: Client | undefined;
let openServer: McpServer | undefined;

afterEach(async () => {
  await openClient?.close();
  await openServer?.close();
  openClient = undefined;
  openServer = undefined;
});
```
Assign the suite's created `client`/`server` to `openClient`/`openServer` where they are constructed so the `afterEach` always closes them — including on test failure.

- [ ] **Step 4: Verify the leak is gone**

```bash
for i in 1 2 3 4 5; do NODE_OPTIONS=--experimental-vm-modules npx jest 2>&1 | grep -E "leaking|-32001|did not exit|Tests:"; echo "--- run $i ---"; done
```
Expected: every run ends `Tests: … 829 passed` (or current total) with **no** "worker failed to exit gracefully / leaking" warning and no `-32001`.

- [ ] **Step 5: Commit**

```bash
git add <leaker>.test.ts
git commit -m "test: close leaked transport so async timeout no longer flakes other suites (closes #20)"
```

---

## Final verification

- [ ] `npm run lint && npm test && npm run build` — green.
- [ ] Push, open PR(s), confirm CI is green on first run (no rerun needed) — the real proof for #20.

## Self-Review

- **Spec coverage:** #19 → Task 1 (timeout on both `callOllama` and `healthCheck`, env-overridable, `unref`'d, fast-fail test). #20 → Task 2 (reproduce → identify → teardown → verify). ✅
- **Placeholder scan:** Task 1 is fully concrete (real code + commands). Task 2's "TBD file" is inherent to a diagnosis spike, not a placeholder — Step 2 gives the exact commands that resolve it, and Step 3 gives the concrete teardown code to apply. The only unknown is *which* file, which the plan deliberately derives rather than guesses. ✅
- **Type consistency:** `OLLAMA_TIMEOUT_MS` read identically in `callOllama` and `healthCheck`; `APPROX_CHARS_PER_TOKEN` is the existing module constant. ✅
- **Independence:** Task 1 ships alone; Task 2 is touch-tests-only. Recommend **separate PRs** (one closes #19, one closes #20).
