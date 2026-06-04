# Claude Code Agent Teams — Operational Reference

A practical how-to for spinning up multi-agent teams inside Claude Code. Written for an LLM agent that has access to the Claude Code tool surface and needs to coordinate parallel work without re-reading the full docs every time.

Source: [code.claude.com/docs/en/agent-teams](https://code.claude.com/docs/en/agent-teams) (verified 2026-05-22) plus hands-on verification in this repo.

---

## TL;DR

**Use a team when** you need 2-5 independent Claude sessions that talk to each other (parallel review, competing hypotheses, cross-layer feature work). Each teammate is a full Claude session with its own context window.

**Use subagents instead when** you just need a worker that runs in isolation and reports a result back — no peer-to-peer comms needed.

The tradeoff: teams cost N× more tokens but give you peer-to-peer coordination via a shared task list and direct messaging.

---

## Prerequisites

1. **Claude Code v2.1.32 or later** (`claude --version`).
2. **Experimental flag enabled** in `~/.claude/settings.json`:
   ```json
   {
     "env": { "CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS": "1" }
   }
   ```
   Or via shell: `export CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1`.
3. **Tool schemas loaded.** `TeamCreate`, `TeamDelete`, `SendMessage`, and the `Task*` tools are deferred — load them before use:
   ```
   ToolSearch(query: "select:TeamCreate,TeamDelete,SendMessage,TaskCreate,TaskList,TaskUpdate,TaskGet", max_results: 7)
   ```

---

## Tool Surface

| Tool | What it does | Who calls it |
|---|---|---|
| `TeamCreate` | Creates team config + task list on disk | Lead only |
| `Agent` (with `team_name` + `name`) | Spawns a teammate that joins the team | Lead only |
| `TaskCreate` / `TaskUpdate` / `TaskGet` / `TaskList` | Shared task list | Lead and teammates |
| `SendMessage` | Send a message to a named agent (peer or lead) | Lead and teammates |
| `TeamDelete` | Cleans up team + task directories | Lead only, after all teammates are shut down |

**On-disk layout:**
- `~/.claude/teams/{team-name}/config.json` — team config, members list
- `~/.claude/tasks/{team-name}/` — shared task list

These are auto-managed. Don't hand-edit.

---

## The Six-Step Workflow

```
1. TeamCreate            → create team + task list
2. TaskCreate × N        → create one task per investigation/work item
3. Agent × N             → spawn teammates with team_name + name
                           (give each one a spawn prompt + which task to claim)
4. Wait                  → messages auto-deliver; idle notifications are informational
5. SendMessage shutdown  → terminate teammates one by one
6. TeamDelete            → remove team + task dirs
```

### Step 1 — Create the team

```jsonc
TeamCreate({
  team_name: "memory-security-audit",
  agent_type: "team-lead",
  description: "Audit security posture of Claude Code's local memory system."
})
```

Returns `{ team_name, team_file_path, lead_agent_id }`. The current session is now the **lead**.

### Step 2 — Create tasks (one per work item)

```jsonc
TaskCreate({
  subject: "Audit on-disk storage of memory files",
  description: "Investigate ~/.claude/projects/<slug>/memory/, file perms, " +
               "scan for accidentally-stored secrets, report findings.",
  activeForm: "Auditing on-disk storage"
})
```

Returns a task ID (e.g., `#1`). The teammate will claim this task by ID.

### Step 3 — Spawn teammates (in parallel)

Send one message with multiple `Agent` calls so they spawn concurrently:

```jsonc
Agent({
  description: "Storage auditor teammate",
  subagent_type: "Explore",                   // read-only is safer for audits
  name: "storage-auditor",                    // referenced via SendMessage
  team_name: "memory-security-audit",         // joins the team
  run_in_background: true,
  prompt: `You are storage-auditor on team memory-security-audit. ` +
          `Claim Task #1 via TaskUpdate (owner: "storage-auditor", ` +
          `status: "in_progress"), run TaskGet to read full description, ` +
          `execute the investigation, mark task completed, then send ` +
          `findings to team-lead via SendMessage. Read-only — do NOT write.`
})
```

Spawn returns `agent_id: name@team_name`.

**Key prompt patterns:**
- Tell them their name and the lead's name.
- Tell them which task ID to claim and how (via `TaskUpdate`).
- Tell them to report results via `SendMessage` to `team-lead`.
- Constrain scope: word count, read-only, redaction rules for sensitive findings.

### Step 4 — Wait for results

Messages from teammates arrive automatically as `<teammate-message>` blocks in your next turn. **Do not poll.** The system delivers them when your turn ends.

Idle notifications (`{"type":"idle_notification",...}`) are informational only — a teammate going idle right after sending a message is normal flow (they're waiting for follow-up). Don't treat idle as completion or error.

### Step 5 — Shut down teammates

Send one shutdown request per teammate. The `message` field uses a literal object:

```jsonc
SendMessage({
  to: "storage-auditor",
  message: { type: "shutdown_request", reason: "investigation complete" }
})
```

Approving shutdown terminates the teammate process. You can run all shutdowns in parallel.

### Step 6 — Delete the team

After all teammates have terminated:

```jsonc
TeamDelete({})   // operates on the current session's team context
```

`TeamDelete` **fails if any teammate is still active.** Always shutdown first.

---

## Worked Example: Parallel Security Audit

Three teammates investigating distinct angles of a single problem. Each uses `subagent_type: "Explore"` because investigation is read-only — `SendMessage` and `TaskUpdate` are still available since team tools come from team membership, not from the agent type's tool list.

```
TeamCreate(team_name="memory-security-audit", ...)

TaskCreate(subject="Audit on-disk storage")         // → task #1
TaskCreate(subject="Map prompt-injection surface")  // → task #2
TaskCreate(subject="Analyze scope boundaries")      // → task #3

// All three Agent spawns in ONE message → parallel:
Agent(name="storage-auditor",   subagent_type="Explore", team_name=..., prompt="...claim #1...")
Agent(name="injection-hunter",  subagent_type="Explore", team_name=..., prompt="...claim #2...")
Agent(name="scope-analyzer",    subagent_type="Explore", team_name=..., prompt="...claim #3...")

// — wait for teammate-message blocks to arrive in your context —

// Verify any cross-teammate disagreements yourself before reporting:
Bash("ls -la <relevant path>")

// Shut down in parallel:
SendMessage(to="storage-auditor",  message={type:"shutdown_request", reason:"done"})
SendMessage(to="injection-hunter", message={type:"shutdown_request", reason:"done"})
SendMessage(to="scope-analyzer",   message={type:"shutdown_request", reason:"done"})

TeamDelete({})
```

**Synthesis discipline:** when teammates' reports conflict (e.g., one says file perms are `600`, another says `644`), the lead must **verify the disputed fact directly** before relaying to the user. Teammate reports are inputs to your judgment, not final truth.

---

## Choosing Teammate Types

When spawning, `subagent_type` controls the teammate's tool list:

| Type | Tools | Use for |
|---|---|---|
| `Explore` | Read-only (Read, Grep, Bash, etc.) | Investigation, audit, research |
| `general-purpose` | Full (incl. Edit, Write) | Implementation work |
| Custom (`.claude/agents/`) | As defined in agent frontmatter | Pre-configured roles (security-reviewer, etc.) |

**Team tools (`SendMessage`, `Task*`) are always available** regardless of `subagent_type` — they come from team membership.

Subagent definitions referenced by name (e.g., `security-reviewer`) get their body **appended** to the system prompt (not replacing it), and their `tools` allowlist applies. Their `skills` and `mcpServers` frontmatter is **not** applied when running as a teammate — those come from project/user settings.

---

## Sizing

- **3–5 teammates** is the sweet spot. Beyond that, coordination overhead eats the parallelism gain.
- **5–6 tasks per teammate** keeps everyone productive without thrashing.
- For 15 independent tasks, 3 teammates is right. For 5, often 1 session is right.

---

## Gotchas (hands-on, not always obvious from docs)

1. **`SendMessage` shutdown payload is a literal object**, not a string:
   `{ type: "shutdown_request", reason: "..." }` — wrapping it in a string breaks the protocol handshake.
2. **The lead's text output is NOT visible to teammates.** To talk to a teammate, you MUST use `SendMessage`. Printing to the user does nothing for them.
3. **Don't quote teammate messages back to the user.** They're already rendered as `<teammate-message>` blocks in the user's UI.
4. **Idle notifications are not errors.** Don't react unless you have new work to assign.
5. **Memory is shared across teammates** for the same project path. If teammate-A writes to `~/.claude/projects/<slug>/memory/`, teammate-B sees it on next session start. Treat memory writes as project-scoped, not session-scoped.
6. **Permissions are inherited from the lead at spawn time.** You can change individual modes after, but not at spawn. `--dangerously-skip-permissions` propagates to all teammates.
7. **The shared task list is automatic with the team.** Calling `TaskCreate` after `TeamCreate` writes into the team's task dir, not a separate scope. After `TeamDelete`, the task list is gone.
8. **One team at a time per lead.** Clean up before starting a new one.

---

## Hooks for quality gates

Three hook events let you enforce rules on team work:

- **`TeammateIdle`** — exit code `2` to give feedback and keep them working
- **`TaskCreated`** — exit code `2` to block creation with feedback
- **`TaskCompleted`** — exit code `2` to block completion with feedback

Configure in `~/.claude/settings.json` under `hooks`.

---

## Hard Limitations

- No `/resume` or `/rewind` restoration of in-process teammates — after resume, spawn new ones.
- Task status can lag — teammates sometimes forget to mark tasks completed.
- Shutdown isn't instant — teammates finish their current turn first.
- No nested teams (teammates can't spawn their own teams).
- Leadership is fixed for the session lifetime.
- Split-pane mode requires tmux or iTerm2 — falls back to in-process otherwise.

---

## Quick-reference cheat sheet

```text
ENABLE:    CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1 in env or settings.json
VERSION:   claude --version  →  v2.1.32+
CREATE:    TeamCreate(team_name, agent_type, description)
TASKS:     TaskCreate(subject, description, activeForm)
SPAWN:     Agent(name, team_name, subagent_type, prompt, run_in_background:true)
TALK:      SendMessage(to, message, summary)
SHUTDOWN:  SendMessage(to, message:{type:"shutdown_request", reason})
DELETE:    TeamDelete({})

FILES:     ~/.claude/teams/<name>/config.json
           ~/.claude/tasks/<name>/

WAIT:      Don't poll. <teammate-message> blocks auto-deliver.
VERIFY:    When teammates disagree, the lead checks the disputed fact directly.
```
