/**
 * Devlog-MCP 2.0 Database Schema (Drizzle ORM)
 *
 * Per-Project SQLite Database with:
 * - Document management (issues, PRDs, research, decisions)
 * - Tagging system (file-level and section-level)
 * - Time tracking with parallel task slots
 * - Modification history (Claude vs User tracking)
 * - Conversation memory and session context
 * - Knowledge graph (entities and relations)
 */

import { sqliteTable, text, integer, real, index, uniqueIndex } from "drizzle-orm/sqlite-core";
import { relations, sql } from "drizzle-orm";

// ═══════════════════════════════════════════════════════════════════════════
// SCHEMA VERSION (for migrations)
// ═══════════════════════════════════════════════════════════════════════════

export const schemaVersion = sqliteTable("schema_version", {
  version: integer("version").primaryKey(),
  appliedAt: text("applied_at").default(sql`CURRENT_TIMESTAMP`),
  description: text("description"),
});

// ═══════════════════════════════════════════════════════════════════════════
// PROJECT METADATA
// ═══════════════════════════════════════════════════════════════════════════

export const project = sqliteTable("project", {
  id: text("id").primaryKey().default("default"),
  name: text("name").notNull(),
  rootPath: text("root_path").notNull(),
  devlogPath: text("dokoro_path").notNull(),
  createdAt: text("created_at").default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").default(sql`CURRENT_TIMESTAMP`),
  settingsJson: text("settings_json"),
});

// ═══════════════════════════════════════════════════════════════════════════
// CORE DOCUMENTS TABLE
// ═══════════════════════════════════════════════════════════════════════════

export const docs = sqliteTable(
  "docs",
  {
    id: text("id").primaryKey(), // filename stem
    filepath: text("filepath").notNull().unique(),
    title: text("title").notNull(),
    content: text("content"),
    docType: text("doc_type").notNull().default("issue"), // issue|prd|research|decision|note
    status: text("status").notNull().default("inbox"), // inbox|active|backlog|done|archived
    prdStage: text("prd_stage"), // idea|breakdown|improve|finalize
    priority: text("priority").default("medium"), // low|medium|high|urgent

    // Time tracking
    timeEstimatedMin: integer("time_estimated_min"),
    timeActualMin: integer("time_actual_min"),
    parallelSlot: integer("parallel_slot"), // 1-5 terminal slot

    // Dates
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    dueAt: text("due_at"),
    completedAt: text("completed_at"),

    // External links
    ghIssue: integer("gh_issue"),
    ghPr: integer("gh_pr"),
    ghRepo: text("gh_repo"),

    // Embeddings
    embeddingId: text("embedding_id"),
    embeddingModel: text("embedding_model"),
    embeddingUpdatedAt: text("embedding_updated_at"),

    // Flexible metadata
    metadataJson: text("metadata_json"),
    contentHash: text("content_hash"),
  },
  (table) => [
    index("idx_docs_status").on(table.status),
    index("idx_docs_type_status").on(table.docType, table.status),
    index("idx_docs_priority").on(table.priority),
    index("idx_docs_dates").on(table.createdAt, table.updatedAt),
    index("idx_docs_content_hash").on(table.contentHash),
  ]
);

// ═══════════════════════════════════════════════════════════════════════════
// USERS/AUTHORS
// ═══════════════════════════════════════════════════════════════════════════

export const users = sqliteTable(
  "users",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    name: text("name").notNull().unique(),
    displayName: text("display_name"),
    type: text("type").notNull().default("human"), // human|ai|system
    email: text("email"),
    avatarUrl: text("avatar_url"),
    createdAt: text("created_at").default(sql`CURRENT_TIMESTAMP`),
    lastActiveAt: text("last_active_at"),
    settingsJson: text("settings_json"),
  },
  (table) => [index("idx_users_type").on(table.type)]
);

// ═══════════════════════════════════════════════════════════════════════════
// TAGS
// ═══════════════════════════════════════════════════════════════════════════

export const tags = sqliteTable(
  "tags",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    name: text("name").notNull().unique(),
    color: text("color"),
    description: text("description"),
    parentId: integer("parent_id"), // Self-reference handled via relations
    usageCount: integer("usage_count").default(0),
    createdAt: text("created_at").default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [index("idx_tags_name").on(table.name)]
);

export const docTags = sqliteTable(
  "doc_tags",
  {
    docId: text("doc_id")
      .notNull()
      .references(() => docs.id, { onDelete: "cascade" }),
    tagId: integer("tag_id")
      .notNull()
      .references(() => tags.id, { onDelete: "cascade" }),
    source: text("source").default("manual"), // manual|yaml|hashtag|filename|folder|ai
    confidence: real("confidence").default(1.0),
    createdAt: text("created_at").default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [index("idx_doc_tags_tag").on(table.tagId), index("idx_doc_tags_doc").on(table.docId)]
);

// ═══════════════════════════════════════════════════════════════════════════
// SECTION TAGS (for tagging sections within markdown files)
// ═══════════════════════════════════════════════════════════════════════════

export const sectionTags = sqliteTable(
  "section_tags",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    docId: text("doc_id")
      .notNull()
      .references(() => docs.id, { onDelete: "cascade" }),
    sectionHeader: text("section_header").notNull(), // The header text (e.g., "## Future Plans")
    sectionLevel: integer("section_level").notNull(), // 1-6 for # to ######
    tagId: integer("tag_id")
      .notNull()
      .references(() => tags.id, { onDelete: "cascade" }),
    lineNumber: integer("line_number"), // Line number in the file
    content: text("content"), // Section content for preview/search
    source: text("source").default("comment"), // comment|manual|ai
    createdAt: text("created_at").default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index("idx_section_tags_doc").on(table.docId),
    index("idx_section_tags_tag").on(table.tagId),
  ]
);

// ═══════════════════════════════════════════════════════════════════════════
// TIME TRACKING
// ═══════════════════════════════════════════════════════════════════════════

export const timeEntries = sqliteTable(
  "time_entries",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    docId: text("doc_id")
      .notNull()
      .references(() => docs.id, { onDelete: "cascade" }),
    userId: integer("user_id").references(() => users.id),
    terminalSlot: integer("terminal_slot"), // 1-5
    startedAt: text("started_at").notNull(),
    endedAt: text("ended_at"),
    durationMin: integer("duration_min"),
    status: text("status").notNull().default("active"), // active|paused|completed
    interruptions: integer("interruptions").default(0),
    notes: text("notes"),
    createdAt: text("created_at").default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index("idx_time_doc").on(table.docId),
    index("idx_time_user").on(table.userId),
    index("idx_time_slot").on(table.terminalSlot),
    index("idx_time_status").on(table.status),
  ]
);

// ═══════════════════════════════════════════════════════════════════════════
// ENTITY GRAPH (GraphRAG)
// ═══════════════════════════════════════════════════════════════════════════

export const entities = sqliteTable(
  "entities",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    type: text("type").notNull(), // project|person|concept|file|api|component|service
    name: text("name").notNull(),
    canonicalName: text("canonical_name"),
    description: text("description"),
    metadataJson: text("metadata_json"),
    createdAt: text("created_at").default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at").default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    uniqueIndex("idx_entity_type_name").on(table.type, table.canonicalName),
    index("idx_entity_type").on(table.type),
  ]
);

export const docEntities = sqliteTable(
  "doc_entities",
  {
    docId: text("doc_id")
      .notNull()
      .references(() => docs.id, { onDelete: "cascade" }),
    entityId: integer("entity_id")
      .notNull()
      .references(() => entities.id, { onDelete: "cascade" }),
    relationType: text("relation_type").notNull(), // mentions|blocks|implements|uses|depends_on
    context: text("context"),
    confidence: real("confidence").default(1.0),
    createdAt: text("created_at").default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index("idx_doc_entity_doc").on(table.docId),
    index("idx_doc_entity_entity").on(table.entityId),
  ]
);

export const entityRelations = sqliteTable(
  "entity_relations",
  {
    sourceId: integer("source_id")
      .notNull()
      .references(() => entities.id, { onDelete: "cascade" }),
    targetId: integer("target_id")
      .notNull()
      .references(() => entities.id, { onDelete: "cascade" }),
    relationType: text("relation_type").notNull(),
    weight: real("weight").default(1.0),
    metadataJson: text("metadata_json"),
    // Bi-temporal validity (Zep/Graphiti-style). NULL valid_to = open fact.
    // NOTE: PK is (source_id, target_id, relation_type) — only one open fact
    // per tuple at a time. Closing a fact (UPDATE valid_to = now) preserves
    // the row but prevents re-opening the same tuple without first deleting.
    validFrom: text("valid_from").notNull().default(sql`CURRENT_TIMESTAMP`),
    validTo: text("valid_to"),
    createdAt: text("created_at").default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index("idx_entity_rel_source").on(table.sourceId),
    index("idx_entity_rel_target").on(table.targetId),
    index("idx_entity_rel_valid_to").on(table.validTo),
  ]
);

// ═══════════════════════════════════════════════════════════════════════════
// SESSIONS
// ═══════════════════════════════════════════════════════════════════════════

export const sessions = sqliteTable(
  "sessions",
  {
    id: text("id").primaryKey(),
    userId: integer("user_id").references(() => users.id),
    startedAt: text("started_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    endedAt: text("ended_at"),
    status: text("status").notNull().default("active"), // active|paused|completed|abandoned
    focusDocId: text("focus_doc_id").references(() => docs.id),
    goalsJson: text("goals_json"),
    summary: text("summary"),
    notes: text("notes"),
    metadataJson: text("metadata_json"),
  },
  (table) => [
    index("idx_session_user").on(table.userId),
    index("idx_session_status").on(table.status),
    index("idx_session_dates").on(table.startedAt, table.endedAt),
  ]
);

// ═══════════════════════════════════════════════════════════════════════════
// CONVERSATION MEMORY
// ═══════════════════════════════════════════════════════════════════════════

export const conversationSummaries = sqliteTable(
  "conversation_summaries",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    sessionId: text("session_id").references(() => sessions.id, { onDelete: "set null" }),
    aiModel: text("ai_model").notNull(),
    summary: text("summary").notNull(),
    keyDecisionsJson: text("key_decisions_json"),
    keyTopicsJson: text("key_topics_json"),
    linkedDocsJson: text("linked_docs_json"),
    messageCount: integer("message_count"),
    tokenCount: integer("token_count"),
    startedAt: text("started_at").notNull(),
    endedAt: text("ended_at"),
    createdAt: text("created_at").default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index("idx_conv_session").on(table.sessionId),
    index("idx_conv_model").on(table.aiModel),
    index("idx_conv_dates").on(table.startedAt, table.endedAt),
  ]
);

// ═══════════════════════════════════════════════════════════════════════════
// RELATIONS (for Drizzle query builder)
// ═══════════════════════════════════════════════════════════════════════════

export const docsRelations = relations(docs, ({ many }) => ({
  tags: many(docTags),
  timeEntries: many(timeEntries),
  entities: many(docEntities),
  sectionTags: many(sectionTags),
}));

export const usersRelations = relations(users, ({ many }) => ({
  timeEntries: many(timeEntries),
  sessions: many(sessions),
}));

export const tagsRelations = relations(tags, ({ many, one }) => ({
  docs: many(docTags),
  sections: many(sectionTags),
  parent: one(tags, {
    fields: [tags.parentId],
    references: [tags.id],
  }),
}));

export const sessionsRelations = relations(sessions, ({ one, many }) => ({
  user: one(users, {
    fields: [sessions.userId],
    references: [users.id],
  }),
  focusDoc: one(docs, {
    fields: [sessions.focusDocId],
    references: [docs.id],
  }),
  conversations: many(conversationSummaries),
}));

export const entitiesRelations = relations(entities, ({ many }) => ({
  docs: many(docEntities),
  relationsAsSource: many(entityRelations, { relationName: "source" }),
  relationsAsTarget: many(entityRelations, { relationName: "target" }),
}));

// ═══════════════════════════════════════════════════════════════════════════
// AFFECTIVE MEMORY (agent feedback / success-failure history)
// ═══════════════════════════════════════════════════════════════════════════

export const agentFeedback = sqliteTable(
  "agent_feedback",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    agentId: text("agent_id").notNull(),
    toolName: text("tool_name").notNull(),
    outcome: text("outcome").notNull(),
    confidence: real("confidence").default(1.0),
    latencyMs: integer("latency_ms"),
    errorMessage: text("error_message"),
    docId: text("doc_id").references(() => docs.id, { onDelete: "set null" }),
    sessionId: text("session_id").references(() => sessions.id, { onDelete: "set null" }),
    metadataJson: text("metadata_json"),
    recordedAt: text("recorded_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index("idx_feedback_tool").on(table.toolName),
    index("idx_feedback_agent").on(table.agentId),
    index("idx_feedback_outcome").on(table.outcome),
    index("idx_feedback_session").on(table.sessionId),
    index("idx_feedback_recorded").on(table.recordedAt),
  ]
);
