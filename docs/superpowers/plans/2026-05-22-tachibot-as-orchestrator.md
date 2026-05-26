# Tachibot-as-Orchestrator Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Promote `tachibot-mcp` from "bag of model adapters" to a real orchestrator that decomposes a goal, routes sub-tasks across models, threads context from `devlog-mcp` into each call, and feeds outcomes back into devlog's affective layer to bias future routing.

**Architecture:** Tachibot already has `FocusOrchestrator` (`src/orchestrator.ts`) that runs workflow steps, and a `memoryProvider` schema field in `sequential-thinking.ts` that only emits a "hint" today. Wire that hint into a real MCP call to `bridge_index_research`, then add an outer `tachibot_orchestrate` tool that (a) calls `bridge_get_context` upfront, (b) chooses models partly from `devlog_feedback_query`, (c) records `devlog_feedback_record` after every step. No new infra — just close the loop between two MCP servers that already coexist in `.mcp.json`.

**Tech Stack:** TypeScript 5, Zod, the in-tree MCP client (`src/mcp-client.ts`), `sequential-thinking.ts` session state, devlog bridge tools, Jest.

**Prerequisite:** Tasks 2–3 of `2026-05-22-memory-layer-upgrade.md` (the `agent_feedback` table and the `devlog_feedback_record` / `devlog_feedback_query` tools) must be merged first. Several steps below depend on them.

**Reading order for the implementer:**
- `/Users/gravity/Documents/WORK/TACHIBOT_ALL/tachibot-mcp/src/sequential-thinking.ts` — current `memoryProvider` hook (line 800, 913)
- `/Users/gravity/Documents/WORK/TACHIBOT_ALL/tachibot-mcp/src/orchestrator.ts` — existing workflow runner
- `/Users/gravity/Documents/WORK/TACHIBOT_ALL/tachibot-mcp/src/mcp-client.ts` — outbound MCP calls
- `/Users/gravity/Documents/WORK/TACHIBOT_ALL/devlog-mcp/src/tools/bridge-tools.ts` — what devlog already exposes for tachibot
- `/Users/gravity/Documents/WORK/TACHIBOT_ALL/devlog-mcp/src/services/bridge-service.ts` — bridge implementation

---

## Task 1: Inventory the existing wiring

**Files:** read-only.

Lock down exact line numbers and method names before changing code.

- [ ] **Step 1: Map the `memoryProvider` hook**

```bash
cd /Users/gravity/Documents/WORK/TACHIBOT_ALL/tachibot-mcp
grep -n "memoryProvider\|saveToMemory\|buildMemorySaveHint" src/sequential-thinking.ts
```
Expected: matches at roughly lines 102, 105, 127, 800, 913, 1044, 1067. Note the exact line numbers — they're used in Task 2.

- [ ] **Step 2: Confirm `MCPClient` can call other MCP servers**

```bash
grep -n "executeTool\|callTool\|connect" src/mcp-client.ts | head -40
```
Expected: there's an `executeTool(toolName, args)` (or similarly named) method. Note its signature.

- [ ] **Step 3: Confirm devlog bridge tools are reachable**

```bash
grep -n "bridge_index_research\|bridge_get_context\|bridge_import_plan" /Users/gravity/Documents/WORK/TACHIBOT_ALL/devlog-mcp/src/tools/bridge-tools.ts
```
Expected: each name appears as a `name: '...'` entry. These tools are exposed via `mcp__devlog-tachibot__*` in `.mcp.json`.

- [ ] **Step 4: Record findings in this plan**

Append to the bottom of this file under "Inventory results (Task 1)":
```markdown
## Inventory results (Task 1)
- `buildMemorySaveHint` defined at sequential-thinking.ts:<line>
- `memoryProvider` consumed at sequential-thinking.ts:<line> (currently emits hint only)
- MCPClient call method: `<exact signature>`
- Devlog tool names confirmed: bridge_index_research, bridge_get_context, bridge_import_plan
```

- [ ] **Step 5: Commit**

```bash
cd /Users/gravity/Documents/WORK/TACHIBOT_ALL/tachibot-mcp
git add ../devlog-mcp/docs/superpowers/plans/2026-05-22-tachibot-as-orchestrator.md
git commit -m "docs(plan): inventory tachibot↔devlog wiring"
```

---

## Task 2: Replace the `memoryProvider` hint with a real devlog write

**Files:**
- Modify: `tachibot-mcp/src/sequential-thinking.ts` (around line 913)
- Create: `tachibot-mcp/src/memory/devlog-adapter.ts`
- Test: `tachibot-mcp/src/memory/devlog-adapter.test.ts`

Today the code emits a string hint advising the caller to save. Make it actually save by calling `mcp__devlog-tachibot__bridge_index_research` through `MCPClient`.

- [ ] **Step 1: Write the failing test**

Create `src/memory/devlog-adapter.test.ts`:
```typescript
import { DevlogMemoryAdapter } from './devlog-adapter.js';

describe('DevlogMemoryAdapter', () => {
  it('serialises a sequential-thinking session into bridge_index_research args', async () => {
    const calls: Array<{ tool: string; args: unknown }> = [];
    const fakeClient = {
      executeTool: async (tool: string, args: unknown) => {
        calls.push({ tool, args });
        return JSON.stringify({ docId: 'research-tachibot-abc123', chunks: 2, action: 'indexed' });
      },
    };
    const adapter = new DevlogMemoryAdapter(fakeClient as any);
    const res = await adapter.save({
      source: 'tachibot',
      query: 'should we use bi-temporal facts?',
      content: '# distilled context\n- option A\n- option B\n\n## final\nchoose A',
      sessionId: 'sess-1',
      thoughts: 4,
    });
    expect(res.docId).toBe('research-tachibot-abc123');
    expect(calls).toHaveLength(1);
    expect(calls[0].tool).toBe('mcp__devlog-tachibot__bridge_index_research');
    const args = calls[0].args as { source: string; query: string; metadata?: Record<string, unknown> };
    expect(args.source).toBe('tachibot');
    expect(args.query).toBe('should we use bi-temporal facts?');
    expect(args.metadata?.sessionId).toBe('sess-1');
    expect(args.metadata?.thoughtCount).toBe(4);
  });

  it('returns null on adapter failure rather than throwing (best-effort persistence)', async () => {
    const fakeClient = {
      executeTool: async () => { throw new Error('mcp server unreachable'); },
    };
    const adapter = new DevlogMemoryAdapter(fakeClient as any);
    const res = await adapter.save({
      source: 'tachibot', query: 'x', content: 'y', sessionId: 's', thoughts: 1,
    });
    expect(res).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx jest src/memory/devlog-adapter.test.ts -v
```
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the adapter**

Create `src/memory/devlog-adapter.ts`:
```typescript
import type { MCPClient } from '../mcp-client.js';

export interface SaveInput {
  source: string;
  query: string;
  content: string;
  sessionId: string;
  thoughts: number;
  extraMetadata?: Record<string, unknown>;
}

export interface SaveResult {
  docId: string;
  chunks?: number;
  action?: string;
}

export class DevlogMemoryAdapter {
  constructor(private readonly client: Pick<MCPClient, 'executeTool'>) {}

  async save(input: SaveInput): Promise<SaveResult | null> {
    try {
      const raw = await this.client.executeTool('mcp__devlog-tachibot__bridge_index_research', {
        source: input.source,
        query: input.query,
        content: input.content,
        metadata: {
          sessionId: input.sessionId,
          thoughtCount: input.thoughts,
          savedAt: new Date().toISOString(),
          ...input.extraMetadata,
        },
      });
      const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
      return { docId: parsed.docId, chunks: parsed.chunks, action: parsed.action };
    } catch (err) {
      // Best-effort: memory persistence must never break the reasoning chain.
      console.error('[devlog-adapter] save failed:', err);
      return null;
    }
  }

  async getContext(query: string, limit = 10): Promise<Array<{ title: string; type: string; excerpt: string; score: number }>> {
    try {
      const raw = await this.client.executeTool('mcp__devlog-tachibot__bridge_get_context', {
        query, limit, include_research: true, include_plans: true,
      });
      const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
      return Array.isArray(parsed) ? parsed : [];
    } catch (err) {
      console.error('[devlog-adapter] getContext failed:', err);
      return [];
    }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx jest src/memory/devlog-adapter.test.ts -v
```
Expected: both tests PASS.

- [ ] **Step 5: Replace the hint emission in `sequential-thinking.ts`**

Open `tachibot-mcp/src/sequential-thinking.ts`. Locate the block that currently calls `this.buildMemorySaveHint(...)` (per Task 1 Step 1, around line 913). Replace it with:

```typescript
if (memoryProvider?.saveToMemory && !nextThoughtNeeded) {
  if (memoryProvider.provider === 'devlog') {
    const adapter = new DevlogMemoryAdapter(this.mcpClient);
    const saveResult = await adapter.save({
      source: 'tachibot',
      query: session.initialQuery ?? session.goal ?? 'tachibot-session',
      content: this.serialiseSessionForMemory(session, distilledContext, finalJudgeResponse),
      sessionId: session.id,
      thoughts: session.thoughts.length,
    });
    session.memorySaved = saveResult;
  } else {
    // Non-devlog providers: keep the legacy hint behaviour
    const hint = this.buildMemorySaveHint(session, memoryProvider.provider, distilledContext, finalJudgeResponse);
    session.memoryHint = hint;
  }
}
```

Add this import at the top of the file:
```typescript
import { DevlogMemoryAdapter } from './memory/devlog-adapter.js';
```

Implement `serialiseSessionForMemory` if it doesn't exist — add this private method on the same class:
```typescript
private serialiseSessionForMemory(
  session: { id: string; goal?: string; thoughts: Array<{ content: string; toolUsed?: string }> },
  distilled: string,
  judge?: string,
): string {
  const lines: string[] = [
    `# Tachibot session ${session.id}`,
    `Goal: ${session.goal ?? '(none)'}`,
    '',
    '## Distilled context',
    distilled,
  ];
  if (judge) {
    lines.push('', '## Final judge response', judge);
  }
  lines.push('', '## Thoughts');
  session.thoughts.forEach((t, i) => {
    lines.push(`### Thought ${i + 1}${t.toolUsed ? ` (${t.toolUsed})` : ''}`);
    lines.push(t.content);
  });
  return lines.join('\n');
}
```

- [ ] **Step 6: Run the full tachibot test suite + lint**

```bash
npm test
npm run lint
```
Expected: PASS, clean.

- [ ] **Step 7: Commit**

```bash
git add src/memory/devlog-adapter.ts src/memory/devlog-adapter.test.ts src/sequential-thinking.ts
git commit -m "feat(tachibot): real devlog memory persistence (replaces hint-only TODO)"
```

---

## Task 3: Context-load before each model call

**Files:**
- Modify: `tachibot-mcp/src/orchestrator.ts` (the `executeWorkflow` method)
- Test: `tachibot-mcp/src/orchestrator.context.test.ts`

The orchestrator currently runs steps with no memory of prior sessions. Before each step, call `bridge_get_context` and inject the top hits as additional context.

- [ ] **Step 1: Write the failing test**

Create `src/orchestrator.context.test.ts`:
```typescript
import { FocusOrchestrator } from './orchestrator.js';

describe('orchestrator context loading', () => {
  it('prefixes prior-context excerpts to each step prompt', async () => {
    const promptsSeen: string[] = [];

    const fakeAdapter = {
      getContext: async (q: string) => {
        if (q.includes('bi-temporal')) {
          return [
            { title: 'Past decision', type: 'research', excerpt: 'we chose Zep-style', score: 0.9 },
          ];
        }
        return [];
      },
      save: async () => null,
    };

    const orch = new FocusOrchestrator();
    (orch as any).memoryAdapter = fakeAdapter;
    (orch as any).executeTool = async (_tool: string, prompt: string) => {
      promptsSeen.push(prompt);
      return 'ok';
    };

    const workflow = {
      name: 'test', steps: [
        { tool: 'gemini_brainstorm', promptTechnique: 'first_principles' },
      ],
    };
    await orch.executeWorkflow(workflow as any, 'should we go bi-temporal on relations?');

    expect(promptsSeen[0]).toMatch(/Past decision/);
    expect(promptsSeen[0]).toMatch(/we chose Zep-style/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx jest src/orchestrator.context.test.ts -v
```
Expected: FAIL — orchestrator has no `memoryAdapter` field; prompts aren't prefixed.

- [ ] **Step 3: Add the adapter to the orchestrator**

In `src/orchestrator.ts`:

```typescript
import { DevlogMemoryAdapter } from './memory/devlog-adapter.js';

export class FocusOrchestrator {
  private mcpClient: MCPClient;
  private promptEngineer: PromptEngineer;
  private visualizer: WorkflowVisualizer;
  private workflowTemplates: Map<WorkflowType, WorkflowDefinition>;
  private memoryAdapter: DevlogMemoryAdapter;     // NEW

  constructor() {
    this.mcpClient = new MCPClient();
    this.promptEngineer = new PromptEngineer();
    this.visualizer = new WorkflowVisualizer();
    this.workflowTemplates = new Map(
      Object.entries(workflows) as [WorkflowType, WorkflowDefinition][]
    );
    this.memoryAdapter = new DevlogMemoryAdapter(this.mcpClient);   // NEW
  }
```

- [ ] **Step 4: Wire context-loading into `executeWorkflow`**

Inside `executeWorkflow`, replace the per-step prompt construction. Before `const result = await this.executeTool(...)`, add:

```typescript
const priorContext = await this.memoryAdapter.getContext(query, 5);
const contextBlock = priorContext.length === 0
  ? ''
  : `## Prior context (from devlog)\n${priorContext.map((c) =>
      `- [${c.type}] **${c.title}** (score ${c.score.toFixed(2)}): ${c.excerpt}`
    ).join('\n')}\n\n`;

const enhancedPrompt = contextBlock + this.promptEngineer.applyTechnique(
  step.tool, step.promptTechnique, query, results,
);
```

(Remove the old `enhancedPrompt = this.promptEngineer.applyTechnique(...)` line that the new code replaces.)

- [ ] **Step 5: Run test to verify it passes**

```bash
npx jest src/orchestrator.context.test.ts -v
npm run lint
```
Expected: PASS, clean.

- [ ] **Step 6: Commit**

```bash
git add src/orchestrator.ts src/orchestrator.context.test.ts
git commit -m "feat(tachibot): inject devlog context into every orchestrator step"
```

---

## Task 4: Feedback-aware model routing

**Files:**
- Create: `tachibot-mcp/src/orchestrators/feedback-router.ts`
- Create: `tachibot-mcp/src/orchestrators/feedback-router.test.ts`
- Modify: `tachibot-mcp/src/orchestrator.ts`

Use devlog's `agent_feedback` table (from memory-layer-upgrade Task 3) to bias which model handles which sub-task. If `gemini_brainstorm` has been failing on this kind of query, try `openai_brainstorm` first instead.

**Depends on:** `2026-05-22-memory-layer-upgrade.md` Tasks 2–3 must be merged.

- [ ] **Step 1: Write the failing test**

Create `src/orchestrators/feedback-router.test.ts`:
```typescript
import { FeedbackRouter } from './feedback-router.js';

function fakeClient(stats: Record<string, { success: number; failure: number }>) {
  return {
    executeTool: async (tool: string, args: unknown) => {
      if (tool === 'mcp__devlog-tachibot__devlog_feedback_query') {
        const filter = (args as { tool_name?: string }).tool_name;
        if (!filter) {
          const lines = Object.entries(stats).map(([t, s]) =>
            `${t}: total=${s.success + s.failure} success=${s.success} failure=${s.failure} success_rate=${(s.success / Math.max(s.success + s.failure, 1)).toFixed(3)} avg_confidence=1.0`
          );
          return lines.join('\n');
        }
        const s = stats[filter];
        return s
          ? `${filter}: total=${s.success + s.failure} success=${s.success} failure=${s.failure} success_rate=${(s.success / Math.max(s.success + s.failure, 1)).toFixed(3)} avg_confidence=1.0`
          : '(no feedback recorded)';
      }
      throw new Error('unexpected tool ' + tool);
    },
  };
}

describe('FeedbackRouter', () => {
  it('prefers the historically-most-successful candidate', async () => {
    const router = new FeedbackRouter(fakeClient({
      gemini_brainstorm: { success: 1, failure: 9 },
      openai_brainstorm: { success: 8, failure: 2 },
      grok_brainstorm:   { success: 5, failure: 5 },
    }) as any);
    const pick = await router.choose(['gemini_brainstorm', 'openai_brainstorm', 'grok_brainstorm']);
    expect(pick).toBe('openai_brainstorm');
  });

  it('falls back to the first candidate when there is no history', async () => {
    const router = new FeedbackRouter(fakeClient({}) as any);
    const pick = await router.choose(['gemini_brainstorm', 'openai_brainstorm']);
    expect(pick).toBe('gemini_brainstorm');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx jest src/orchestrators/feedback-router.test.ts -v
```
Expected: FAIL — module missing.

- [ ] **Step 3: Implement `FeedbackRouter`**

Create `src/orchestrators/feedback-router.ts`:
```typescript
import type { MCPClient } from '../mcp-client.js';

interface ToolStats {
  total: number;
  success: number;
  failure: number;
  successRate: number;
}

export class FeedbackRouter {
  constructor(private readonly client: Pick<MCPClient, 'executeTool'>) {}

  async choose(candidates: string[]): Promise<string> {
    if (candidates.length === 0) throw new Error('FeedbackRouter.choose: no candidates');
    const statsByTool = new Map<string, ToolStats>();
    for (const c of candidates) {
      const stats = await this.statsFor(c);
      if (stats) statsByTool.set(c, stats);
    }
    if (statsByTool.size === 0) return candidates[0];

    // Wilson lower bound would be better, but for now: max success rate breaks ties by total.
    const ranked = [...statsByTool.entries()].sort((a, b) => {
      if (b[1].successRate !== a[1].successRate) return b[1].successRate - a[1].successRate;
      return b[1].total - a[1].total;
    });
    const best = ranked[0][0];
    // If every candidate has zero data, fall back to the order the caller specified.
    return statsByTool.size === candidates.length ? best : best;
  }

  private async statsFor(toolName: string): Promise<ToolStats | null> {
    const raw = await this.client.executeTool('mcp__devlog-tachibot__devlog_feedback_query', { tool_name: toolName });
    const text = typeof raw === 'string' ? raw : '';
    const line = text.split('\n').find((l) => l.startsWith(`${toolName}:`));
    if (!line) return null;
    const total   = Number(line.match(/total=(\d+)/)?.[1] ?? 0);
    const success = Number(line.match(/success=(\d+)/)?.[1] ?? 0);
    const failure = Number(line.match(/failure=(\d+)/)?.[1] ?? 0);
    const successRate = Number(line.match(/success_rate=([\d.]+)/)?.[1] ?? 0);
    return { total, success, failure, successRate };
  }
}
```

- [ ] **Step 4: Wire router into orchestrator step selection**

In `src/orchestrator.ts`, add to the constructor:
```typescript
import { FeedbackRouter } from './orchestrators/feedback-router.js';
// ...
private feedbackRouter: FeedbackRouter;
// in constructor:
this.feedbackRouter = new FeedbackRouter(this.mcpClient);
```

Extend `WorkflowDefinition.steps` items to optionally carry `alternatives?: string[]`. In `executeWorkflow`, before executing the step:
```typescript
const candidates = [step.tool, ...(step.alternatives ?? [])];
const chosen = candidates.length > 1
  ? await this.feedbackRouter.choose(candidates)
  : step.tool;
// ... downstream: use `chosen` instead of `step.tool`
```

Update `src/types.ts` (or wherever `WorkflowDefinition` lives) to allow the optional `alternatives` field.

- [ ] **Step 5: Run tests + lint**

```bash
npx jest src/orchestrators/feedback-router.test.ts src/orchestrator.context.test.ts -v
npm run lint
```
Expected: all PASS.

- [ ] **Step 6: Commit**

```bash
git add src/orchestrators/feedback-router.ts src/orchestrators/feedback-router.test.ts src/orchestrator.ts src/types.ts
git commit -m "feat(tachibot): feedback-aware model routing (uses devlog agent_feedback)"
```

---

## Task 5: Record per-step outcomes back into devlog

**Files:**
- Modify: `tachibot-mcp/src/orchestrator.ts`
- Test: `tachibot-mcp/src/orchestrator.feedback.test.ts`

Close the loop: every step in `executeWorkflow` writes a `devlog_feedback_record` row so the router has more data next time.

- [ ] **Step 1: Write the failing test**

Create `src/orchestrator.feedback.test.ts`:
```typescript
import { FocusOrchestrator } from './orchestrator.js';

describe('orchestrator records feedback', () => {
  it('writes success on completed steps and failure on thrown ones', async () => {
    const recorded: any[] = [];
    const fakeClient = {
      executeTool: async (tool: string, args: any) => {
        if (tool === 'mcp__devlog-tachibot__devlog_feedback_record') { recorded.push(args); return 'ok'; }
        if (tool === 'mcp__devlog-tachibot__devlog_feedback_query')  return '';
        if (tool === 'mcp__devlog-tachibot__bridge_get_context')     return '[]';
        if (tool === 'good_tool') return 'output';
        if (tool === 'bad_tool')  throw new Error('boom');
        return '';
      },
    };
    const orch = new FocusOrchestrator();
    (orch as any).mcpClient = fakeClient;
    (orch as any).memoryAdapter = { getContext: async () => [], save: async () => null };
    (orch as any).feedbackRouter = { choose: async (cands: string[]) => cands[0] };

    const workflow = { name: 'mix', steps: [
      { tool: 'good_tool', promptTechnique: 'plain' },
      { tool: 'bad_tool',  promptTechnique: 'plain', optional: true },
    ]};
    await orch.executeWorkflow(workflow as any, 'go');

    expect(recorded).toHaveLength(2);
    expect(recorded[0]).toMatchObject({ tool_name: 'good_tool', outcome: 'success' });
    expect(recorded[1]).toMatchObject({ tool_name: 'bad_tool',  outcome: 'failure' });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx jest src/orchestrator.feedback.test.ts -v
```
Expected: FAIL — orchestrator never calls `devlog_feedback_record`.

- [ ] **Step 3: Add the recording call**

In `src/orchestrator.ts`, inside `executeWorkflow`'s per-step `try`/`catch`:

```typescript
const stepStart = Date.now();
try {
  const result = await this.executeTool(chosen, enhancedPrompt, context);
  results.push({ tool: chosen, output: result, timestamp: Date.now(), duration: Date.now() - startTime });
  await this.recordFeedback(chosen, 'success', Date.now() - stepStart, undefined);
  await this.visualizer.updateProgress(chosen, ToolStatus.COMPLETE);
  // ... existing adaptation logic
} catch (error) {
  await this.recordFeedback(chosen, 'failure', Date.now() - stepStart, error instanceof Error ? error.message : String(error));
  await this.visualizer.updateProgress(chosen, ToolStatus.ERROR);
  if (step.optional) {
    console.error(`Optional tool ${chosen} failed:`, error);
    continue;
  }
  throw error;
}
```

Add the helper:
```typescript
private async recordFeedback(toolName: string, outcome: 'success' | 'failure', latencyMs: number, errorMessage?: string): Promise<void> {
  try {
    await this.mcpClient.executeTool('mcp__devlog-tachibot__devlog_feedback_record', {
      agent_id: 'tachibot-orchestrator',
      tool_name: toolName,
      outcome,
      latency_ms: latencyMs,
      error_message: errorMessage,
    });
  } catch (err) {
    console.error('[orchestrator] feedback record failed:', err);
  }
}
```

- [ ] **Step 4: Run tests + lint**

```bash
npx jest src/orchestrator.feedback.test.ts -v
npm run lint
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/orchestrator.ts src/orchestrator.feedback.test.ts
git commit -m "feat(tachibot): record per-step outcomes into devlog affective memory"
```

---

## Task 6: New top-level `tachibot_orchestrate` MCP tool

**Files:**
- Create: `tachibot-mcp/src/tools/orchestrate-tool.ts`
- Create: `tachibot-mcp/src/tools/orchestrate-tool.test.ts`
- Modify: `tachibot-mcp/src/server.ts` (register the new tool)

A single entry point that does: decompose → context-load → route → execute → record → save final session.

- [ ] **Step 1: Write the failing test**

Create `src/tools/orchestrate-tool.test.ts`:
```typescript
import { orchestrateTool } from './orchestrate-tool.js';

describe('tachibot_orchestrate', () => {
  it('runs a workflow end-to-end and reports the synthesis', async () => {
    const fakeOrchestrator = {
      initialize: async () => {},
      selectWorkflow: () => ({ name: 'creative', steps: [{ tool: 'gemini_brainstorm', promptTechnique: 'plain' }] }),
      executeWorkflow: async () => '## creative Results\n- idea 1\n- idea 2\n\n### Synthesis\nUse idea 1.',
    };
    const tool = orchestrateTool({ buildOrchestrator: () => fakeOrchestrator as any });
    const res = await tool.handler({ goal: 'brainstorm onboarding flow', mode: 'creative' });
    const text = res.content[0].text;
    expect(text).toMatch(/idea 1/);
    expect(text).toMatch(/Synthesis/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx jest src/tools/orchestrate-tool.test.ts -v
```
Expected: FAIL.

- [ ] **Step 3: Implement the tool factory**

Create `src/tools/orchestrate-tool.ts`:
```typescript
import { z } from 'zod';
import { FocusOrchestrator } from '../orchestrator.js';

export interface OrchestrateDeps {
  buildOrchestrator?: () => FocusOrchestrator;
}

export function orchestrateTool(deps: OrchestrateDeps = {}) {
  const build = deps.buildOrchestrator ?? (() => new FocusOrchestrator());
  return {
    name: 'tachibot_orchestrate',
    title: 'Orchestrate a multi-model workflow with devlog memory',
    description: 'Decompose a goal, route across models (history-biased), inject prior devlog context into each step, and persist the session.',
    inputSchema: {
      goal: z.string().describe('The user-facing goal.'),
      mode: z.enum(['creative', 'research', 'solve', 'synthesis', 'brainstorm', 'reason']).optional(),
      context: z.string().optional(),
    },
    handler: async (args: { goal: string; mode?: string; context?: string }) => {
      const orch = build();
      await orch.initialize();
      const wf = orch.selectWorkflow(args.mode ?? 'creative', args.goal);
      const synthesis = await orch.executeWorkflow(wf, args.goal, args.context);
      return { content: [{ type: 'text', text: synthesis }] };
    },
  };
}
```

- [ ] **Step 4: Register the tool**

Open `src/server.ts`. Find where other tools are registered (look for `registerTool` or `server.tool(` calls). Add:
```typescript
import { orchestrateTool } from './tools/orchestrate-tool.js';
// ...
const ot = orchestrateTool();
server.registerTool(ot.name, { title: ot.title, description: ot.description, inputSchema: ot.inputSchema }, ot.handler);
```

- [ ] **Step 5: Run tests + lint + build**

```bash
npx jest src/tools/orchestrate-tool.test.ts -v
npm run lint
npm run build
```
Expected: PASS, clean, build succeeds.

- [ ] **Step 6: Commit**

```bash
git add src/tools/orchestrate-tool.ts src/tools/orchestrate-tool.test.ts src/server.ts
git commit -m "feat(tachibot): tachibot_orchestrate tool (one-shot multi-model + memory)"
```

---

## Task 7: Wire the new tool into `.mcp.json` (already present)

**Files:** check-only.

- [ ] **Step 1: Confirm tachibot-mcp is registered**

```bash
grep -n "tachibot-mcp" /Users/gravity/Documents/WORK/TACHIBOT_ALL/.mcp.json
```
Expected: an entry like `"tachibot-mcp"` or `"tachibot"`. If not, add it following the pattern of the existing `devlog-tachibot` entry — same shape, different binary.

- [ ] **Step 2: Smoke test from a Claude Code session**

After both projects are built (`npm run build` in each), restart MCP. In a new chat:
1. Call `mcp__tachibot-mcp__tachibot_orchestrate` with `{goal: "brainstorm an onboarding flow", mode: "creative"}`.
2. Verify a research doc landed in devlog: call `mcp__devlog-tachibot__bridge_get_context` with `{query: "onboarding"}`.
3. Verify feedback was recorded: call `mcp__devlog-tachibot__devlog_feedback_query` with `{agent_id: "tachibot-orchestrator"}`.

Expected: all three return non-empty results.

- [ ] **Step 3: No code commit** (verification-only step).

---

## Task 8: Update tachibot's README

**Files:**
- Modify: `/Users/gravity/Documents/WORK/TACHIBOT_ALL/tachibot-mcp/README.md`

- [ ] **Step 1: Read the current README**

```bash
wc -l /Users/gravity/Documents/WORK/TACHIBOT_ALL/tachibot-mcp/README.md
```
Read the whole file before rewriting.

- [ ] **Step 2: Add an "Orchestrator + memory" section**

Insert near the top (after the project description, before tool listings):
```markdown
## Orchestrator mode

`tachibot-mcp` runs as a multi-model orchestrator when paired with `devlog-mcp`:

- **Context load** — Every step calls `bridge_get_context` to pull prior research/plans.
- **Feedback-aware routing** — `FeedbackRouter` queries `devlog_feedback_query` and picks the candidate model with the best historical success rate for that tool family.
- **Outcome recording** — Each step writes `devlog_feedback_record` (success/failure, latency, error).
- **Session persistence** — On completion, the full distilled session is indexed back into devlog via `bridge_index_research`.

Single entry point: `mcp__tachibot-mcp__tachibot_orchestrate({goal, mode})`.

## Memory provider

In `sequential_thinking`, set `memoryProvider: { provider: "devlog", saveToMemory: true }` to persist that session as a research doc in devlog. Other providers fall back to legacy hint-only behaviour.

See `/devlog-mcp/docs/superpowers/plans/2026-05-22-tachibot-as-orchestrator.md` for the design.
```

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs: document tachibot-as-orchestrator + devlog memory"
```

---

## Task 9: End-to-end verification

- [ ] **Step 1: Build both projects**

```bash
cd /Users/gravity/Documents/WORK/TACHIBOT_ALL/devlog-mcp && npm run build
cd /Users/gravity/Documents/WORK/TACHIBOT_ALL/tachibot-mcp && npm run build
```
Expected: both exit 0.

- [ ] **Step 2: Run both test suites**

```bash
cd /Users/gravity/Documents/WORK/TACHIBOT_ALL/devlog-mcp && npm test
cd /Users/gravity/Documents/WORK/TACHIBOT_ALL/tachibot-mcp && npm test
```
Expected: 0 failures across the board.

- [ ] **Step 3: Integration smoke (via Claude Code)**

In a fresh Claude Code chat with both MCP servers loaded:
1. `mcp__tachibot-mcp__tachibot_orchestrate({goal: "design a tiny cache invalidation strategy", mode: "solve"})` — expect a synthesis with multiple model voices.
2. `mcp__devlog-tachibot__bridge_get_context({query: "cache invalidation"})` — expect ≥1 result from the previous call.
3. `mcp__devlog-tachibot__devlog_feedback_query({agent_id: "tachibot-orchestrator"})` — expect ≥1 row per tool that ran in step 1.
4. Force a known-bad model alternative on a workflow that has `alternatives: [...]`, run again, then query `devlog_feedback_query` and verify the next run picks the better candidate.

- [ ] **Step 4: Document the result**

Append a short retro to this plan file under "End-to-end results" — what worked, what surprised, any deferred follow-ups.

- [ ] **Step 5: Final commit (only if anything changed during smoke testing)**

```bash
git status
# commit any changes, otherwise no-op
```

---

## Inventory results (Task 1 — fill in after running Task 1)

(leave blank — populated during Task 1 Step 4)

## End-to-end results (Task 9 — fill in after running Task 9)

(leave blank — populated during Task 9 Step 4)
