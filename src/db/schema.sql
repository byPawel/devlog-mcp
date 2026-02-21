-- ═══════════════════════════════════════════════════════════════════════════
-- DEVLOG-MCP 2.0 SQLite Schema
-- Per-Project Database (each project gets its own .devlog/db/devlog.sqlite)
-- ═══════════════════════════════════════════════════════════════════════════

PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;
PRAGMA busy_timeout = 5000;

-- ═══════════════════════════════════════════════════════════════════════════
-- SCHEMA VERSION (for migrations)
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS schema_version (
  version INTEGER PRIMARY KEY,
  applied_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  description TEXT
);

INSERT INTO schema_version (version, description) VALUES (1, 'Initial schema - Devlog 2.0');

-- ═══════════════════════════════════════════════════════════════════════════
-- PROJECT METADATA
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS project (
  id TEXT PRIMARY KEY DEFAULT 'default',
  name TEXT NOT NULL,
  root_path TEXT NOT NULL,              -- Absolute path to project root
  devlog_path TEXT NOT NULL,            -- Relative path to devlog folder (usually 'devlog')
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  settings_json TEXT                    -- Project-specific settings
);

-- ═══════════════════════════════════════════════════════════════════════════
-- CORE DOCUMENTS TABLE (issues, PRDs, research, decisions unified)
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS docs (
  id TEXT PRIMARY KEY,                  -- filename stem: 2025-01-26-field-bug
  filepath TEXT UNIQUE NOT NULL,        -- relative path from devlog root
  title TEXT NOT NULL,
  content TEXT,                         -- full markdown content for FTS
  doc_type TEXT NOT NULL DEFAULT 'issue', -- issue|prd|research|decision|note
  status TEXT NOT NULL DEFAULT 'inbox', -- inbox|active|backlog|done|archived
  prd_stage TEXT,                       -- idea|breakdown|improve|finalize (for PRDs)
  priority TEXT DEFAULT 'medium',       -- low|medium|high|urgent

  -- Time tracking
  time_estimated_min INTEGER,           -- estimated minutes
  time_actual_min INTEGER,              -- actual minutes (calculated from time_entries)
  parallel_slot INTEGER,                -- 1-5 terminal slot for multi-task

  -- Dates
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  due_at DATETIME,                      -- optional deadline
  completed_at DATETIME,                -- when status changed to done

  -- External links
  gh_issue INTEGER,                     -- GitHub issue number
  gh_pr INTEGER,                        -- GitHub PR number
  gh_repo TEXT,                         -- owner/repo format

  -- Embeddings
  embedding_id TEXT,                    -- Vector DB reference (ChromaDB/LanceDB)
  embedding_model TEXT,                 -- Model used for embedding
  embedding_updated_at DATETIME,        -- When embedding was last updated

  -- Flexible metadata (JSON for extensibility)
  metadata_json TEXT,                   -- {"custom_field": "value", ...}

  -- Content hash for change detection
  content_hash TEXT                     -- MD5/SHA256 of content for incremental updates
);

-- ═══════════════════════════════════════════════════════════════════════════
-- USERS/AUTHORS (supports human, AI, system - future multi-user ready)
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT UNIQUE NOT NULL,            -- 'user', 'claude', 'llm:qwen', 'john@example.com'
  display_name TEXT,                    -- Human-readable name
  type TEXT NOT NULL DEFAULT 'human',   -- human|ai|system
  email TEXT,                           -- for future multi-user
  avatar_url TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  last_active_at DATETIME,
  settings_json TEXT                    -- User preferences
);

-- Pre-populate with known authors
INSERT OR IGNORE INTO users (name, display_name, type) VALUES ('user', 'User', 'human');
INSERT OR IGNORE INTO users (name, display_name, type) VALUES ('claude', 'Claude', 'ai');
INSERT OR IGNORE INTO users (name, display_name, type) VALUES ('llm:qwen', 'Qwen', 'ai');
INSERT OR IGNORE INTO users (name, display_name, type) VALUES ('llm:llama', 'Llama', 'ai');
INSERT OR IGNORE INTO users (name, display_name, type) VALUES ('llm:grok', 'Grok', 'ai');
INSERT OR IGNORE INTO users (name, display_name, type) VALUES ('llm:gemini', 'Gemini', 'ai');
INSERT OR IGNORE INTO users (name, display_name, type) VALUES ('llm:gpt', 'GPT', 'ai');
INSERT OR IGNORE INTO users (name, display_name, type) VALUES ('system', 'System', 'system');

-- ═══════════════════════════════════════════════════════════════════════════
-- DOCUMENT ASSIGNMENTS (ownership, assignees, reviewers)
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS doc_assignments (
  doc_id TEXT NOT NULL REFERENCES docs(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'assignee', -- creator|assignee|reviewer|contributor
  assigned_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (doc_id, user_id, role)
);

-- ═══════════════════════════════════════════════════════════════════════════
-- TAGS (normalized for efficient queries)
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS tags (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT UNIQUE NOT NULL,            -- 'bug', 'api', 'urgent'
  color TEXT,                           -- Hex color for UI
  description TEXT,
  parent_id INTEGER REFERENCES tags(id), -- Hierarchical tags
  usage_count INTEGER DEFAULT 0,        -- Track popularity
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS doc_tags (
  doc_id TEXT NOT NULL REFERENCES docs(id) ON DELETE CASCADE,
  tag_id INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  source TEXT DEFAULT 'manual',         -- manual|yaml|hashtag|filename|folder|ai
  confidence REAL DEFAULT 1.0,          -- AI-suggested tag confidence (0-1)
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (doc_id, tag_id)
);

-- ═══════════════════════════════════════════════════════════════════════════
-- FULL-TEXT SEARCH (FTS5)
-- ═══════════════════════════════════════════════════════════════════════════

CREATE VIRTUAL TABLE IF NOT EXISTS docs_fts USING fts5(
  id,
  title,
  content,
  tags_text,                            -- denormalized: "bug api urgent"
  content='docs',
  content_rowid='rowid',
  tokenize='porter unicode61'
);

-- ═══════════════════════════════════════════════════════════════════════════
-- FTS SYNC TRIGGERS
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TRIGGER IF NOT EXISTS docs_ai AFTER INSERT ON docs BEGIN
  INSERT INTO docs_fts(rowid, id, title, content, tags_text)
  VALUES (
    new.rowid,
    new.id,
    new.title,
    new.content,
    (SELECT group_concat(t.name, ' ') FROM tags t
     JOIN doc_tags dt ON t.id = dt.tag_id
     WHERE dt.doc_id = new.id)
  );
END;

CREATE TRIGGER IF NOT EXISTS docs_ad AFTER DELETE ON docs BEGIN
  INSERT INTO docs_fts(docs_fts, rowid, id, title, content, tags_text)
  VALUES ('delete', old.rowid, old.id, old.title, old.content, NULL);
END;

CREATE TRIGGER IF NOT EXISTS docs_au AFTER UPDATE ON docs BEGIN
  INSERT INTO docs_fts(docs_fts, rowid, id, title, content, tags_text)
  VALUES ('delete', old.rowid, old.id, old.title, old.content, NULL);
  INSERT INTO docs_fts(rowid, id, title, content, tags_text)
  VALUES (
    new.rowid,
    new.id,
    new.title,
    new.content,
    (SELECT group_concat(t.name, ' ') FROM tags t
     JOIN doc_tags dt ON t.id = dt.tag_id
     WHERE dt.doc_id = new.id)
  );
END;

-- Trigger to update tags_text when doc_tags changes
CREATE TRIGGER IF NOT EXISTS doc_tags_ai AFTER INSERT ON doc_tags BEGIN
  UPDATE docs SET updated_at = CURRENT_TIMESTAMP WHERE id = new.doc_id;
END;

CREATE TRIGGER IF NOT EXISTS doc_tags_ad AFTER DELETE ON doc_tags BEGIN
  UPDATE docs SET updated_at = CURRENT_TIMESTAMP WHERE id = old.doc_id;
END;

-- ═══════════════════════════════════════════════════════════════════════════
-- TIME TRACKING
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS time_entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  doc_id TEXT NOT NULL REFERENCES docs(id) ON DELETE CASCADE,
  user_id INTEGER REFERENCES users(id),  -- who worked on it
  terminal_slot INTEGER,                  -- 1-5 parallel slots
  started_at DATETIME NOT NULL,
  ended_at DATETIME,
  duration_min INTEGER,                   -- Calculated: (ended_at - started_at) in minutes
  status TEXT NOT NULL DEFAULT 'active',  -- active|paused|completed
  interruptions INTEGER DEFAULT 0,        -- Pause/resume count
  notes TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS daily_timeline (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  date DATE NOT NULL,
  user_id INTEGER REFERENCES users(id),
  planned_json TEXT,                      -- [{doc_id, slot, start, end}]
  actual_json TEXT,                       -- What really happened
  utilization_pct INTEGER,                -- Productive time / total time
  total_planned_min INTEGER,
  total_actual_min INTEGER,
  notes TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(date, user_id)
);

-- ═══════════════════════════════════════════════════════════════════════════
-- MODIFICATION HISTORY (who changed what - Claude vs User tracking)
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS modifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  doc_id TEXT NOT NULL REFERENCES docs(id) ON DELETE CASCADE,
  user_id INTEGER REFERENCES users(id),   -- user|claude|llm:qwen
  commit_sha TEXT,                        -- Git commit if available
  section TEXT,                           -- problem|requirements|approach|full
  change_type TEXT NOT NULL,              -- create|add|edit|delete|accept_suggestion|reject_suggestion
  diff_preview TEXT,                      -- First 500 chars of change
  old_content TEXT,                       -- Previous content (for undo)
  new_content TEXT,                       -- New content
  ai_suggested BOOLEAN DEFAULT FALSE,     -- Was this an AI suggestion?
  accepted BOOLEAN,                       -- Did user accept? (null if manual edit)
  timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
  session_id TEXT                         -- Links to devlog session
);

-- ═══════════════════════════════════════════════════════════════════════════
-- ENTITY GRAPH (GraphRAG - knowledge graph for project)
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS entities (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  type TEXT NOT NULL,                     -- project|person|concept|file|api|component|service
  name TEXT NOT NULL,
  canonical_name TEXT,                    -- Normalized name for matching
  description TEXT,
  metadata_json TEXT,                     -- Additional structured data
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(type, canonical_name)
);

CREATE TABLE IF NOT EXISTS doc_entities (
  doc_id TEXT NOT NULL REFERENCES docs(id) ON DELETE CASCADE,
  entity_id INTEGER NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  relation_type TEXT NOT NULL,            -- mentions|blocks|implements|uses|depends_on|related_to
  context TEXT,                           -- Surrounding text where entity was found
  confidence REAL DEFAULT 1.0,            -- Extraction confidence (0-1)
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (doc_id, entity_id, relation_type)
);

-- Entity-to-entity relations (for knowledge graph)
CREATE TABLE IF NOT EXISTS entity_relations (
  source_id INTEGER NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  target_id INTEGER NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  relation_type TEXT NOT NULL,            -- depends_on|uses|implements|extends|related_to
  weight REAL DEFAULT 1.0,                -- Relation strength
  metadata_json TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (source_id, target_id, relation_type)
);

-- ═══════════════════════════════════════════════════════════════════════════
-- SESSIONS (replaces broken current.md - tracks work sessions)
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,                    -- UUID or timestamp-based
  user_id INTEGER REFERENCES users(id),
  started_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ended_at DATETIME,
  status TEXT NOT NULL DEFAULT 'active',  -- active|paused|completed|abandoned
  focus_doc_id TEXT REFERENCES docs(id),  -- Current focus (optional)
  goals_json TEXT,                        -- Session goals [{goal, completed}]
  summary TEXT,                           -- AI-generated or manual summary
  notes TEXT,
  metadata_json TEXT                      -- Flexible session data
);

-- ═══════════════════════════════════════════════════════════════════════════
-- CONVERSATION MEMORY (AI conversation tracking)
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS conversation_summaries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT REFERENCES sessions(id) ON DELETE SET NULL,
  ai_model TEXT NOT NULL,                 -- claude|gpt|qwen|etc
  summary TEXT NOT NULL,                  -- AI-generated conversation summary
  key_decisions_json TEXT,                -- [{decision, reasoning, outcome}]
  key_topics_json TEXT,                   -- ["topic1", "topic2"]
  linked_docs_json TEXT,                  -- [doc_id1, doc_id2] - docs discussed
  message_count INTEGER,                  -- Number of messages in conversation
  token_count INTEGER,                    -- Approximate tokens used
  started_at DATETIME NOT NULL,
  ended_at DATETIME,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- ═══════════════════════════════════════════════════════════════════════════
-- CROSS-SESSION CONTEXT (auto-load relevant context)
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS session_context (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  context_type TEXT NOT NULL,             -- doc|conversation|entity|file|decision
  context_id TEXT NOT NULL,               -- Reference to the context item
  relevance_score REAL DEFAULT 1.0,       -- How relevant (0-1), used for auto-loading
  loaded_at DATETIME,                     -- When this context was loaded into session
  used BOOLEAN DEFAULT FALSE,             -- Whether context was actually used
  notes TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(session_id, context_type, context_id)
);

-- ═══════════════════════════════════════════════════════════════════════════
-- KNOWLEDGE LINKS (enhanced entity linking: files <-> PRDs <-> decisions)
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS knowledge_links (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_type TEXT NOT NULL,              -- doc|file|entity|conversation
  source_id TEXT NOT NULL,
  target_type TEXT NOT NULL,
  target_id TEXT NOT NULL,
  link_type TEXT NOT NULL,                -- implements|references|decides|blocks|supersedes
  bidirectional BOOLEAN DEFAULT FALSE,    -- Is this a two-way link?
  strength REAL DEFAULT 1.0,              -- Link strength for ranking
  created_by INTEGER REFERENCES users(id),
  auto_detected BOOLEAN DEFAULT FALSE,    -- Was this link auto-detected by AI?
  notes TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(source_type, source_id, target_type, target_id, link_type)
);

-- ═══════════════════════════════════════════════════════════════════════════
-- CONTEXT RELEVANCE (for smart context loading)
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS context_relevance (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  doc_id TEXT NOT NULL REFERENCES docs(id) ON DELETE CASCADE,
  related_doc_id TEXT REFERENCES docs(id) ON DELETE CASCADE,
  related_entity_id INTEGER REFERENCES entities(id) ON DELETE CASCADE,
  relevance_type TEXT NOT NULL,           -- semantic|temporal|structural|explicit
  score REAL NOT NULL,                    -- 0-1 relevance score
  computed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  expires_at DATETIME,                    -- When to recompute
  UNIQUE(doc_id, related_doc_id, relevance_type),
  UNIQUE(doc_id, related_entity_id, relevance_type)
);

-- ═══════════════════════════════════════════════════════════════════════════
-- OFFLINE SYNC QUEUE (for GitHub/external service sync)
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS sync_queue (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  action TEXT NOT NULL,                   -- create_issue|close_issue|update_issue|create_pr|comment
  target_service TEXT NOT NULL,           -- github|jira|notion|etc
  payload_json TEXT NOT NULL,             -- Action-specific data
  status TEXT NOT NULL DEFAULT 'pending', -- pending|processing|completed|failed
  retry_count INTEGER DEFAULT 0,
  max_retries INTEGER DEFAULT 3,
  error_message TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  processed_at DATETIME,
  completed_at DATETIME
);

-- ═══════════════════════════════════════════════════════════════════════════
-- INDEXES (optimized for common queries)
-- ═══════════════════════════════════════════════════════════════════════════

-- Docs: multi-field filtering
CREATE INDEX IF NOT EXISTS idx_docs_status ON docs(status);
CREATE INDEX IF NOT EXISTS idx_docs_type_status ON docs(doc_type, status);
CREATE INDEX IF NOT EXISTS idx_docs_prd_stage ON docs(prd_stage) WHERE prd_stage IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_docs_priority ON docs(priority);
CREATE INDEX IF NOT EXISTS idx_docs_dates ON docs(created_at, updated_at);
CREATE INDEX IF NOT EXISTS idx_docs_due ON docs(due_at) WHERE due_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_docs_slot ON docs(parallel_slot) WHERE parallel_slot IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_docs_gh ON docs(gh_issue) WHERE gh_issue IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_docs_content_hash ON docs(content_hash);

-- Assignments: filter by user
CREATE INDEX IF NOT EXISTS idx_assign_user ON doc_assignments(user_id);
CREATE INDEX IF NOT EXISTS idx_assign_role ON doc_assignments(role);
CREATE INDEX IF NOT EXISTS idx_assign_doc ON doc_assignments(doc_id);

-- Tags: fast tag lookups
CREATE INDEX IF NOT EXISTS idx_tags_name ON tags(name);
CREATE INDEX IF NOT EXISTS idx_doc_tags_tag ON doc_tags(tag_id);
CREATE INDEX IF NOT EXISTS idx_doc_tags_doc ON doc_tags(doc_id);

-- Time: daily queries
CREATE INDEX IF NOT EXISTS idx_time_doc ON time_entries(doc_id);
CREATE INDEX IF NOT EXISTS idx_time_date ON time_entries(date(started_at));
CREATE INDEX IF NOT EXISTS idx_time_user ON time_entries(user_id);
CREATE INDEX IF NOT EXISTS idx_time_slot ON time_entries(terminal_slot);
CREATE INDEX IF NOT EXISTS idx_time_status ON time_entries(status);

-- Modifications: history queries
CREATE INDEX IF NOT EXISTS idx_mod_doc ON modifications(doc_id);
CREATE INDEX IF NOT EXISTS idx_mod_user ON modifications(user_id);
CREATE INDEX IF NOT EXISTS idx_mod_date ON modifications(timestamp);
CREATE INDEX IF NOT EXISTS idx_mod_session ON modifications(session_id);

-- Entities: graph queries
CREATE INDEX IF NOT EXISTS idx_entity_type ON entities(type);
CREATE INDEX IF NOT EXISTS idx_entity_canonical ON entities(canonical_name);
CREATE INDEX IF NOT EXISTS idx_doc_entity_doc ON doc_entities(doc_id);
CREATE INDEX IF NOT EXISTS idx_doc_entity_entity ON doc_entities(entity_id);
CREATE INDEX IF NOT EXISTS idx_entity_rel_source ON entity_relations(source_id);
CREATE INDEX IF NOT EXISTS idx_entity_rel_target ON entity_relations(target_id);

-- Sessions
CREATE INDEX IF NOT EXISTS idx_session_user ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_session_status ON sessions(status);
CREATE INDEX IF NOT EXISTS idx_session_dates ON sessions(started_at, ended_at);

-- Conversation memory
CREATE INDEX IF NOT EXISTS idx_conv_session ON conversation_summaries(session_id);
CREATE INDEX IF NOT EXISTS idx_conv_model ON conversation_summaries(ai_model);
CREATE INDEX IF NOT EXISTS idx_conv_dates ON conversation_summaries(started_at, ended_at);

-- Session context
CREATE INDEX IF NOT EXISTS idx_ctx_session ON session_context(session_id);
CREATE INDEX IF NOT EXISTS idx_ctx_relevance ON session_context(relevance_score DESC);

-- Knowledge links
CREATE INDEX IF NOT EXISTS idx_klink_source ON knowledge_links(source_type, source_id);
CREATE INDEX IF NOT EXISTS idx_klink_target ON knowledge_links(target_type, target_id);

-- Context relevance
CREATE INDEX IF NOT EXISTS idx_relevance_doc ON context_relevance(doc_id);
CREATE INDEX IF NOT EXISTS idx_relevance_score ON context_relevance(score DESC);

-- Sync queue
CREATE INDEX IF NOT EXISTS idx_sync_status ON sync_queue(status);
CREATE INDEX IF NOT EXISTS idx_sync_service ON sync_queue(target_service);

-- ═══════════════════════════════════════════════════════════════════════════
-- VIEWS (common queries as views for convenience)
-- ═══════════════════════════════════════════════════════════════════════════

-- Active tasks with time tracking
CREATE VIEW IF NOT EXISTS v_active_tasks AS
SELECT
  d.*,
  GROUP_CONCAT(DISTINCT t.name) as tags,
  (SELECT SUM(duration_min) FROM time_entries te WHERE te.doc_id = d.id) as total_time_min,
  (SELECT COUNT(*) FROM time_entries te WHERE te.doc_id = d.id AND te.status = 'active') as active_sessions
FROM docs d
LEFT JOIN doc_tags dt ON d.id = dt.doc_id
LEFT JOIN tags t ON dt.tag_id = t.id
WHERE d.status = 'active'
GROUP BY d.id;

-- Today's timeline
CREATE VIEW IF NOT EXISTS v_today_timeline AS
SELECT
  te.*,
  d.title,
  d.doc_type,
  d.priority,
  u.name as user_name
FROM time_entries te
JOIN docs d ON te.doc_id = d.id
LEFT JOIN users u ON te.user_id = u.id
WHERE date(te.started_at) = date('now')
ORDER BY te.started_at;

-- Recent modifications (for history view)
CREATE VIEW IF NOT EXISTS v_recent_modifications AS
SELECT
  m.*,
  d.title as doc_title,
  u.name as user_name,
  u.type as user_type
FROM modifications m
JOIN docs d ON m.doc_id = d.id
LEFT JOIN users u ON m.user_id = u.id
ORDER BY m.timestamp DESC
LIMIT 100;

-- AI contribution stats
CREATE VIEW IF NOT EXISTS v_ai_stats AS
SELECT
  u.name,
  u.type,
  COUNT(*) as total_changes,
  SUM(CASE WHEN m.ai_suggested THEN 1 ELSE 0 END) as ai_suggestions,
  SUM(CASE WHEN m.accepted = 1 THEN 1 ELSE 0 END) as accepted,
  SUM(CASE WHEN m.accepted = 0 THEN 1 ELSE 0 END) as rejected
FROM modifications m
JOIN users u ON m.user_id = u.id
GROUP BY u.id;

-- PRD workflow status
CREATE VIEW IF NOT EXISTS v_prd_status AS
SELECT
  prd_stage,
  COUNT(*) as count,
  GROUP_CONCAT(id) as doc_ids
FROM docs
WHERE doc_type = 'prd'
GROUP BY prd_stage;
