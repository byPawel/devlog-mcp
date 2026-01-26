# Devlog Inbox UI Design

## Overview

Desktop application for managing 880+ markdown devlog files with RAG-powered chat, local AI agents, and rich visualization.

## Tech Stack

| Layer | Technology |
|-------|------------|
| Framework | Tauri 2.0 |
| Frontend | React 19 + Redux Toolkit |
| Styling | Tailwind 4 + shadcn/ui |
| Database | SQLite (via existing devlog-mcp) |
| Vector Search | LanceDB (Rust-native) |
| Visualization | React Flow, Recharts, Mermaid, Markmap |

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           TAURI 2.0 SHELL                                   │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ┌─────────────┬─────────────────────────────────────┬───────────────────┐  │
│  │ FILTER NAV  │          MAIN VIEW                  │   RIGHT PANEL     │  │
│  │             │                                     │                   │  │
│  │ Smart Folders│  ┌─────────────────────────────┐  │  [Chat] [Agents]  │
│  │ ─────────── │  │ [Timeline] [Kanban] [List]  │  │  [Viz]            │
│  │ 📥 Inbox    │  └─────────────────────────────┘  │                   │  │
│  │ 🔥 Active   │                                     │  RAG Chat with   │  │
│  │ 📋 Backlog  │  Document list/grid/timeline       │  citations &     │  │
│  │ 📁 Archive  │                                     │  highlights      │  │
│  │             │  ┌─────────────────────────────┐  │                   │  │
│  │ PRD Stages  │  │ Selected Document Preview   │  │  Local Agents    │  │
│  │ ─────────── │  │ - Markdown render           │  │  - qwen-coder    │  │
│  │ 💡 Idea     │  │ - Screenshot gallery        │  │  - deepseek      │  │
│  │ 📝 Breakdown│  │ - Section highlights        │  │                   │  │
│  │ ❓ Improve  │  └─────────────────────────────┘  │  Visualizations  │  │
│  │ ✅ Finalize │                                     │  - Entity graph  │  │
│  │             │                                     │  - Time charts   │  │
│  │ Tags        │                                     │  - Diagrams      │  │
│  │ ─────────── │                                     │  - Mind maps     │  │
│  │ #bug #api   │                                     │                   │  │
│  └─────────────┴─────────────────────────────────────┴───────────────────┘  │
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │ Status Bar: Active session | Time tracked | Current task            │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────────┘
```

## Core Features

### 1. Three-Pane Layout

**Left Panel - Filter Navigation**
- Smart folders (Inbox, Active, Backlog, Archive)
- PRD stage filters (Idea → Breakdown → Improve → Finalize)
- Tag cloud with counts
- Date range picker
- Saved searches

**Center Panel - Main View**
- Toggle between Timeline, Kanban, List views
- Virtual scrolling for 1000+ files
- Document preview with markdown rendering
- Screenshot gallery with thumbnails
- Keyboard navigation (j/k, enter, esc)

**Right Panel - Intelligence**
- Tabs: Chat, Agents, Visualization

### 2. Chat with RAG Citations

```typescript
interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  citations?: Citation[];
  timestamp: Date;
}

interface Citation {
  docId: string;
  filepath: string;
  excerpt: string;      // 100-200 chars
  lineStart: number;
  lineEnd: number;
  relevanceScore: number;
}
```

**Features:**
- Hybrid search: SQLite FTS5 (BM25) + LanceDB (vectors)
- Clickable citations → jump to source
- Live highlighting in document preview
- "What tasks are blocked?" / "Summarize this week's progress"

### 3. Local Agents Panel

```typescript
interface AgentTask {
  id: string;
  type: "plan-vs-code" | "code-review" | "search";
  status: "pending" | "running" | "done" | "error";
  model: "qwen-coder" | "deepseek" | "gpt-oss";
  input: {
    planDocId?: string;
    codeGlob?: string;
    query?: string;
  };
  output?: {
    matches: CodeMatch[];
    summary: string;
    suggestions: string[];
  };
}
```

**Use Cases:**
- Compare devlog plan vs actual implementation
- Find code matching a spec section
- Review code against PRD requirements

### 4. Visualization Tabs

**Entity Graph (React Flow)**
- Nodes: Projects, files, concepts, people
- Edges: Mentions, blocks, implements
- Cluster by project/tag
- Click node → filter documents

**Time Charts (Recharts)**
- Stacked bar: time per project/day
- Burndown: estimate vs actual
- Heatmap: activity by hour/day

**Diagrams (Mermaid)**
- Render ```mermaid blocks from markdown
- Flowcharts, sequence diagrams, ERD

**Mind Maps (Markmap)**
- Auto-generate from document headers
- Navigate large PRDs visually

### 5. Screenshot Support

```typescript
interface Screenshot {
  id: string;
  docId: string;
  filename: string;
  path: string;          // .devlog/screenshots/<docId>/<filename>
  thumbnail: string;     // base64 or path to 200px thumb
  uploadedAt: Date;
  description?: string;
}
```

**Features:**
- Drag-drop or paste to upload
- Auto-generate thumbnails
- Gallery view in document preview
- Insert reference: `![Screenshot](screenshot://abc123)`

## State Management (Redux Toolkit)

```typescript
// store/index.ts
interface RootState {
  docs: DocsState;
  filters: FiltersState;
  chat: ChatState;
  agents: AgentsState;
  ui: UIState;
}

// Slices
interface DocsState {
  items: Record<string, Doc>;
  ids: string[];
  selectedId: string | null;
  loading: boolean;
  error: string | null;
}

interface FiltersState {
  status: string[];
  prdStage: string[];
  tags: string[];
  dateRange: { start: Date; end: Date } | null;
  search: string;
}

interface ChatState {
  messages: ChatMessage[];
  loading: boolean;
  highlightedCitations: string[];
}

interface AgentsState {
  tasks: Record<string, AgentTask>;
  activeTaskId: string | null;
}

interface UIState {
  mainView: "timeline" | "kanban" | "list";
  rightPanelTab: "chat" | "agents" | "viz";
  sidebarCollapsed: boolean;
}
```

## Performance Optimizations

1. **SQLite Indexes** - Already done in schema (status, tags, dates)
2. **Parallel Hybrid Search** - Run BM25 and vector search concurrently
3. **Markdown Cache** - Cache rendered HTML per content hash
4. **Web Workers** - Image processing off main thread
5. **Debounced File Watcher** - 500ms debounce, batch updates

## File Structure

```
devlog-inbox/
├── src-tauri/
│   ├── src/
│   │   ├── main.rs
│   │   ├── commands/      # Tauri commands
│   │   └── lib.rs
│   ├── Cargo.toml
│   └── tauri.conf.json
├── src/
│   ├── components/
│   │   ├── layout/
│   │   │   ├── FilterNav.tsx
│   │   │   ├── MainView.tsx
│   │   │   ├── RightPanel.tsx
│   │   │   └── StatusBar.tsx
│   │   ├── views/
│   │   │   ├── TimelineView.tsx
│   │   │   ├── KanbanView.tsx
│   │   │   └── ListView.tsx
│   │   ├── chat/
│   │   │   ├── ChatPanel.tsx
│   │   │   ├── ChatMessage.tsx
│   │   │   └── Citation.tsx
│   │   ├── agents/
│   │   │   ├── AgentsPanel.tsx
│   │   │   └── AgentTask.tsx
│   │   ├── viz/
│   │   │   ├── EntityGraph.tsx
│   │   │   ├── TimeCharts.tsx
│   │   │   ├── MermaidDiagram.tsx
│   │   │   └── MindMap.tsx
│   │   └── doc/
│   │       ├── DocPreview.tsx
│   │       ├── ScreenshotGallery.tsx
│   │       └── HighlightedContent.tsx
│   ├── store/
│   │   ├── index.ts
│   │   ├── docsSlice.ts
│   │   ├── filtersSlice.ts
│   │   ├── chatSlice.ts
│   │   ├── agentsSlice.ts
│   │   └── uiSlice.ts
│   ├── hooks/
│   │   ├── useSearch.ts
│   │   ├── useChat.ts
│   │   └── useAgent.ts
│   ├── lib/
│   │   ├── db.ts           # SQLite bridge
│   │   ├── lance.ts        # LanceDB bridge
│   │   ├── markdown.ts     # Render + cache
│   │   └── screenshots.ts  # Upload + thumbnails
│   ├── App.tsx
│   └── main.tsx
├── package.json
└── tailwind.config.ts
```

## Implementation Phases

### Phase 1: Scaffold & Core Layout
- Tauri 2.0 + React 19 project setup
- Three-pane layout with shadcn/ui
- SQLite bridge via Tauri commands
- Basic document list and preview

### Phase 2: Search & Filters
- Filter navigation with Redux
- Hybrid search (SQLite FTS5 first, LanceDB later)
- Virtual scrolling for performance

### Phase 3: Chat & RAG
- Chat UI with message history
- RAG pipeline: query → search → format → respond
- Citation rendering and click-to-highlight

### Phase 4: Agents & Visualization
- Agent task queue and status display
- React Flow entity graph
- Recharts time tracking charts
- Mermaid diagram rendering

### Phase 5: Screenshots & Polish
- Drag-drop upload
- Thumbnail generation
- Gallery component
- Keyboard shortcuts

## Integration with devlog-mcp

The UI communicates with the existing devlog-mcp backend:

```typescript
// Tauri command example
#[tauri::command]
async fn search_docs(query: String, filters: Filters) -> Result<Vec<Doc>, String> {
    // Call devlog-mcp search function
}

// Frontend usage
const results = await invoke("search_docs", { query, filters });
```

All data operations go through the MCP tools defined in `src/tools/devlog-db-tools.ts`.

## Success Criteria

- [ ] Launch in < 2 seconds
- [ ] Scroll 1000+ docs at 60fps
- [ ] Chat response in < 3 seconds (local models)
- [ ] Screenshot upload with preview in < 500ms
- [ ] All views keyboard navigable
