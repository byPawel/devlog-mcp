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
  devlogPath: text("devlog_path").notNull(),
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
// DOCUMENT ASSIGNMENTS
// ═══════════════════════════════════════════════════════════════════════════

export const docAssignments = sqliteTable(
  "doc_assignments",
  {
    docId: text("doc_id")
      .notNull()
      .references(() => docs.id, { onDelete: "cascade" }),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: text("role").notNull().default("assignee"), // creator|assignee|reviewer|contributor
    assignedAt: text("assigned_at").default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index("idx_assign_user").on(table.userId),
    index("idx_assign_doc").on(table.docId),
  ]
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

export const dailyTimeline = sqliteTable(
  "daily_timeline",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    date: text("date").notNull(),
    userId: integer("user_id").references(() => users.id),
    plannedJson: text("planned_json"),
    actualJson: text("actual_json"),
    utilizationPct: integer("utilization_pct"),
    totalPlannedMin: integer("total_planned_min"),
    totalActualMin: integer("total_actual_min"),
    notes: text("notes"),
    createdAt: text("created_at").default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [uniqueIndex("idx_timeline_date_user").on(table.date, table.userId)]
);

// ═══════════════════════════════════════════════════════════════════════════
// MODIFICATION HISTORY
// ═══════════════════════════════════════════════════════════════════════════

export const modifications = sqliteTable(
  "modifications",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    docId: text("doc_id")
      .notNull()
      .references(() => docs.id, { onDelete: "cascade" }),
    userId: integer("user_id").references(() => users.id),
    commitSha: text("commit_sha"),
    section: text("section"), // problem|requirements|approach|full
    changeType: text("change_type").notNull(), // create|add|edit|delete|accept_suggestion|reject_suggestion
    diffPreview: text("diff_preview"),
    oldContent: text("old_content"),
    newContent: text("new_content"),
    aiSuggested: integer("ai_suggested", { mode: "boolean" }).default(false),
    accepted: integer("accepted", { mode: "boolean" }),
    timestamp: text("timestamp").default(sql`CURRENT_TIMESTAMP`),
    sessionId: text("session_id"),
  },
  (table) => [
    index("idx_mod_doc").on(table.docId),
    index("idx_mod_user").on(table.userId),
    index("idx_mod_date").on(table.timestamp),
    index("idx_mod_session").on(table.sessionId),
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
    createdAt: text("created_at").default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index("idx_entity_rel_source").on(table.sourceId),
    index("idx_entity_rel_target").on(table.targetId),
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
// SESSION CONTEXT
// ═══════════════════════════════════════════════════════════════════════════

export const sessionContext = sqliteTable(
  "session_context",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    sessionId: text("session_id")
      .notNull()
      .references(() => sessions.id, { onDelete: "cascade" }),
    contextType: text("context_type").notNull(), // doc|conversation|entity|file|decision
    contextId: text("context_id").notNull(),
    relevanceScore: real("relevance_score").default(1.0),
    loadedAt: text("loaded_at"),
    used: integer("used", { mode: "boolean" }).default(false),
    notes: text("notes"),
    createdAt: text("created_at").default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    uniqueIndex("idx_ctx_unique").on(table.sessionId, table.contextType, table.contextId),
    index("idx_ctx_session").on(table.sessionId),
    index("idx_ctx_relevance").on(table.relevanceScore),
  ]
);

// ═══════════════════════════════════════════════════════════════════════════
// KNOWLEDGE LINKS
// ═══════════════════════════════════════════════════════════════════════════

export const knowledgeLinks = sqliteTable(
  "knowledge_links",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    sourceType: text("source_type").notNull(),
    sourceId: text("source_id").notNull(),
    targetType: text("target_type").notNull(),
    targetId: text("target_id").notNull(),
    linkType: text("link_type").notNull(), // implements|references|decides|blocks|supersedes
    bidirectional: integer("bidirectional", { mode: "boolean" }).default(false),
    strength: real("strength").default(1.0),
    createdBy: integer("created_by").references(() => users.id),
    autoDetected: integer("auto_detected", { mode: "boolean" }).default(false),
    notes: text("notes"),
    createdAt: text("created_at").default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    uniqueIndex("idx_klink_unique").on(
      table.sourceType,
      table.sourceId,
      table.targetType,
      table.targetId,
      table.linkType
    ),
    index("idx_klink_source").on(table.sourceType, table.sourceId),
    index("idx_klink_target").on(table.targetType, table.targetId),
  ]
);

// ═══════════════════════════════════════════════════════════════════════════
// SYNC QUEUE
// ═══════════════════════════════════════════════════════════════════════════

export const syncQueue = sqliteTable(
  "sync_queue",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    action: text("action").notNull(),
    targetService: text("target_service").notNull(),
    payloadJson: text("payload_json").notNull(),
    status: text("status").notNull().default("pending"),
    retryCount: integer("retry_count").default(0),
    maxRetries: integer("max_retries").default(3),
    errorMessage: text("error_message"),
    createdAt: text("created_at").default(sql`CURRENT_TIMESTAMP`),
    processedAt: text("processed_at"),
    completedAt: text("completed_at"),
  },
  (table) => [index("idx_sync_status").on(table.status), index("idx_sync_service").on(table.targetService)]
);

// ═══════════════════════════════════════════════════════════════════════════
// RELATIONS (for Drizzle query builder)
// ═══════════════════════════════════════════════════════════════════════════

export const docsRelations = relations(docs, ({ many }) => ({
  tags: many(docTags),
  assignments: many(docAssignments),
  timeEntries: many(timeEntries),
  modifications: many(modifications),
  entities: many(docEntities),
  sectionTags: many(sectionTags),
}));

export const usersRelations = relations(users, ({ many }) => ({
  assignments: many(docAssignments),
  timeEntries: many(timeEntries),
  modifications: many(modifications),
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
  contexts: many(sessionContext),
  conversations: many(conversationSummaries),
}));

export const entitiesRelations = relations(entities, ({ many }) => ({
  docs: many(docEntities),
  relationsAsSource: many(entityRelations, { relationName: "source" }),
  relationsAsTarget: many(entityRelations, { relationName: "target" }),
}));
