# devlog-mcp — Agent Memory for Claude Code & friends

A multi-layer **agent memory** MCP server. Persists what your agent does, what it knows, and how well it works — across sessions, models, and projects.

> Built on Anthropic's MCP TypeScript SDK. Storage: SQLite (Drizzle ORM) + LanceDB vectors + a small file-backed workspace.

## Why this exists

LLM agents forget every session. Most "memory" plugins are one undifferentiated vector store. `devlog-mcp` instead separates memory by **function** — borrowing the CoALA-inspired taxonomy used by Letta, Zep, Mem0, and Cognee — so the agent can ask the right layer the right question.

## The five memory layers

| Layer | What it remembers | Where it lives | MCP tools |
|---|---|---|---|
| **Working** | Current task, locks, open questions | `.devlog/.mcp/current-workspace.md` + `sessions(status='active')` + `questions.json` | `devlog_workspace_claim`, `devlog_workspace_dump`, `devlog_workspace_status`, `devlog_session_log`, `devlog_question_*` |
| **Episodic** | Past sessions, time entries, conversation summaries | `sessions`, `time_entries`, `conversation_summaries` | `devlog_session_recall`, `devlog_session_log` |
| **Semantic** | Facts, entities, relations, tags, doc vectors | `entities`, `entity_relations` (bi-temporal), `doc_entities`, `tags`, `doc_tags`, `docs`, LanceDB `doc_vectors` + `chunks` | `devlog_entity_graph`, `devlog_entity_extract_deep` |
| **Procedural** | Plans, workflows, checklists | `docs(doc_type='plan')` + plan JSON files | `devlog_plan_create`, `devlog_plan_check`, `devlog_plan_validate`, `devlog_plan_status`, `devlog_plan_list`, `devlog_plan_blocker` |
| **Affective** | Per-tool/per-agent success, failure, latency, confidence | `agent_feedback` | `devlog_feedback_record`, `devlog_feedback_query` |

### What's special

- **Bi-temporal facts** (Zep/Graphiti-style): every `entity_relations` row has `valid_from` / `valid_to`. Contradictions don't overwrite — they close a window. Query the graph "as of" any timestamp via the `as_of` param on `devlog_entity_graph`.
- **Hybrid search**: SQLite FTS5 + LanceDB vectors merged via Reciprocal Rank Fusion.
- **Affective layer**: among popular OSS memory libs (Mem0, Letta, Zep, Cognee, LangMem), `devlog-mcp` is the only one that natively tracks per-tool success/failure history (`agent_feedback`). Use it to bias model routing.
- **Optional, local LLM**: Ollama (`nomic-embed-text` + `llama3.2`) for embeddings and deep entity extraction. Server works without it — falls back to regex extraction.

## Quick start

### Installation

1. **Clone the repository**
   ```bash
   git clone https://github.com/pavveu/devlog-mcp
   cd devlog-mcp
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Configure environment**
   ```bash
   cp .env.example .env.local
   # Edit .env.local with your API keys (optional)
   ```

4. **Build the project**
   ```bash
   npm run build
   ```

5. **Add to Claude**
   ```bash
   # Add core server (essential features)
   claude mcp add devlog-core "node" "$(pwd)/dist/servers/core-server.js"
   
   # Or add with environment variables
   claude mcp add devlog-core "$(pwd)/../mcp-wrapper.sh" ".env.local" "node" "$(pwd)/dist/servers/core-server.js"
   ```

### Ollama setup (optional — enables embeddings and deep entity extraction)

1. **Install Ollama**: https://ollama.com
2. **Pull the required models**:
   ```bash
   ollama pull nomic-embed-text
   ollama pull llama3.2
   ```
3. **Start Ollama** (it runs as a background service automatically on most platforms):
   ```bash
   ollama serve
   ```

Ollama is only needed for `devlog_entity_extract_deep` and LanceDB vector indexing. All other tools work without it.

## Architecture at a glance

```
+------------ working -------------+    +--------- affective -----------+
| workspace.md | sessions(active)  |    | agent_feedback                |
+----------------------------------+    +-------------------------------+
+---- episodic ----+  +------ semantic ------+  +---- procedural ----+
| sessions | time_ |  | entities | relations |  | docs(plan)         |
| entries  | conv_ |  | doc_vectors (Lance)  |  | plans/*.json       |
| summaries|       |  | tags | doc_entities  |  |                    |
+------------------+  +----------------------+  +--------------------+
                            |
                       Drizzle / SQLite
```

## Tools

Tools are organised by which memory layer they read/write.

### Working memory (current task)
| Tool | Description |
|------|-------------|
| `devlog_workspace_status` | Check workspace status and active sessions |
| `devlog_workspace_claim` | Claim workspace with file-based lock |
| `devlog_workspace_dump` | Export workspace data (registers docs in SQLite) |
| `devlog_session_log` | Log development session entries with tags |
| `devlog_question_add` | Log a question during development |
| `devlog_question_answer` | Answer a previously logged question |
| `devlog_question_list` | List all tracked questions |
| `devlog_question_check` | Check status of open questions |

### Episodic memory (past sessions)
| Tool | Description |
|------|-------------|
| `devlog_session_recall` | Read past session summaries (filter by query, session_id, since timestamp) |
| `devlog_compress_week` | Generate a compressed weekly summary (sessions, decisions, mermaid charts) |

### Semantic memory (facts and the knowledge graph)
| Tool | Description |
|------|-------------|
| `devlog_entity_graph` | Query the entity graph — search by name/type or traverse from a specific entity. Accepts `as_of` ISO timestamp for point-in-time queries against bi-temporal `entity_relations`. |
| `devlog_entity_extract_deep` | Run LLM-powered deep extraction on a document via Ollama (requires `llama3.2`) |

### Procedural memory (plans and workflows)
| Tool | Description |
|------|-------------|
| `devlog_plan_create` | Create a development plan with tasks |
| `devlog_plan_check` | Check progress on a plan's tasks |
| `devlog_plan_blocker` | Report a blocker on a plan task |
| `devlog_plan_validate` | Validate plan completion criteria |
| `devlog_plan_status` | Get overall plan status summary |
| `devlog_plan_list` | List all plans |

### Affective memory (agent feedback)
| Tool | Description |
|------|-------------|
| `devlog_feedback_record` | Record the outcome of a tool call (success / failure / partial / rejected / timeout) with confidence and latency |
| `devlog_feedback_query` | Per-tool success rates, recent failures, agent-specific stats |

### Other
| Tool | Description |
|------|-------------|
| `devlog_init` | Initialize devlog workspace and database |
| `devlog_save_image` | Save an image asset (base64 or URL) |
| `devlog_save_file` | Save a file asset |
| `devlog_list_assets` | List saved assets |

> Tools above are exposed by the **core server** (`dist/esm/servers/core-server.js`). The optional **analytics server** (`dist/esm/servers/analytics-server.js`) adds `devlog_compress_week`. Other modular servers (search, planning, tracking) expose additional tools that are not yet wired into core — see `src/servers/*.ts` for the current registrations.

## Integration with `tachibot-mcp`

`devlog-mcp` is the memory backend for `tachibot-mcp` (multi-model orchestrator). Bridge tools (`bridge_index_research`, `bridge_import_plan`, `bridge_get_context`) connect tachibot's reasoning outputs into devlog's semantic layer. See `docs/superpowers/plans/2026-05-22-tachibot-as-orchestrator.md` for the full integration design.

## Comparison with neighbouring projects

| Project | Architecture | Native temporal | Native affective |
|---|---|---|---|
| **devlog-mcp** | SQLite + LanceDB + entity graph | yes (bi-temporal relations) | yes (`agent_feedback`) |
| Mem0 | Vector + optional graph | no | no |
| Letta (MemGPT) | Tiered OS-like, self-editing | via metadata | via metadata |
| Zep / Graphiti | Temporal knowledge graph | yes (bi-temporal) | no |
| Cognee | Graph + vector poly-store | partial | no |
| LangMem | Modular over LangGraph | no | no |

## Development

### Building from Source

```bash
# Install dependencies
npm install

# Run in development mode
npm run dev

# Build for production
npm run build

# Run tests
npm test

# Lint code
npm run lint
```

### Project Structure

```
devlog-mcp/
├── src/
│   ├── servers/          # MCP server implementations
│   ├── tools/            # Tool implementations
│   ├── utils/            # Utility functions
│   └── types/            # TypeScript type definitions
├── examples/             # Usage examples
├── docs/                 # Additional documentation
└── tests/                # Test files
```

## License

MIT License - see [LICENSE](LICENSE) file for details.

## Acknowledgments

- Built on top of the [MCP TypeScript SDK](https://github.com/modelcontextprotocol/typescript-sdk) by Anthropic
- Original SDK Copyright (c) 2024 Anthropic, PBC - MIT License
- Thanks to the Anthropic team for creating the Model Context Protocol
