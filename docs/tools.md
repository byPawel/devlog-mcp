# Dokoro MCP Tools Documentation

This document provides detailed information about all available tools in the Dokoro MCP servers.

## Core Server Tools

### dokoro_workspace_status

Check the current workspace status including active agents and locks.

**Parameters:**
- None

**Returns:**
- `exists`: Boolean indicating if workspace exists
- `currentAgent`: Current agent ID (if any)
- `lastActive`: Last activity timestamp
- `isLocked`: Lock status
- `lockInfo`: Detailed lock information if locked

**Example:**
```typescript
const status = await dokoro_workspace_status();
// Returns: { exists: true, currentAgent: "agent-12345", isLocked: false }
```

### dokoro_workspace_claim

Claim a workspace with multi-agent lock support and session tracking.

**Parameters:**
- `task` (string, required): Current task or focus area
- `force` (boolean, optional): Force claim even if locked
- `tags` (object, optional): Session tags

**Returns:**
- Success message with session details
- Error message if claim fails

**Example:**
```typescript
const result = await dokoro_workspace_claim({
  task: "Implement user authentication",
  tags: { feature: "auth", priority: "high" }
});
```

### dokoro_workspace_dump

Export the current workspace data including session information.

**Parameters:**
- `format` (string, optional): Output format ("json" or "markdown", default: "json")

**Returns:**
- Workspace data in requested format

**Example:**
```typescript
const data = await dokoro_workspace_dump({ format: "markdown" });
```

### dokoro_session_log

Log entries for the current development session.

**Parameters:**
- `entries` (string[], required): Log entries to add
- `tags` (object, optional): Additional tags
- `summary` (string, optional): Session summary

**Returns:**
- Success confirmation with entry count

**Example:**
```typescript
await dokoro_session_log({
  entries: [
    "Implemented login endpoint",
    "Added JWT token generation",
    "Fixed CORS issues"
  ],
  tags: { completed: true },
  summary: "Authentication system complete"
});
```

### dokoro_current_update

Update the current.md file with latest information.

**Parameters:**
- `content` (string, required): New content for current.md
- `append` (boolean, optional): Append instead of replace

**Returns:**
- Success confirmation

**Example:**
```typescript
await dokoro_current_update({
  content: "## Today's Progress\n- Completed auth implementation",
  append: true
});
```

## Analytics Server Tools

### dokoro_analytics_summary

Get a summary of development analytics.

**Parameters:**
- `days` (number, optional): Number of days to analyze (default: 7)

**Returns:**
- Total sessions
- Total time spent
- Most active days
- Top tasks/tags

**Example:**
```typescript
const summary = await dokoro_analytics_summary({ days: 30 });
```

### dokoro_analytics_patterns

Analyze work patterns and productivity insights.

**Parameters:**
- `startDate` (string, optional): Start date (ISO format)
- `endDate` (string, optional): End date (ISO format)

**Returns:**
- Work patterns by hour/day
- Peak productivity times
- Task completion rates

### dokoro_analytics_report

Generate a detailed analytics report.

**Parameters:**
- `startDate` (string, required): Start date
- `endDate` (string, required): End date
- `groupBy` (string, optional): Group by "tag", "task", or "day"
- `format` (string, optional): "json" or "markdown"

**Returns:**
- Comprehensive analytics report

## Planning Server Tools

### dokoro_plan_create

Create a new development plan.

**Parameters:**
- `goal` (string, required): Main goal or objective
- `tasks` (string[], optional): List of tasks
- `context` (string, optional): Additional context
- `useAI` (boolean, optional): Use AI for plan generation

**Returns:**
- Created plan with ID and details

**Example:**
```typescript
const plan = await dokoro_plan_create({
  goal: "Implement OAuth2 integration",
  tasks: [
    "Research OAuth2 providers",
    "Design authentication flow",
    "Implement provider integration"
  ],
  context: "Existing JWT auth in place"
});
```

### dokoro_plan_update

Update an existing plan.

**Parameters:**
- `planId` (string, required): Plan ID
- `updates` (object, required): Fields to update

**Returns:**
- Updated plan details

### dokoro_task_add

Add a new task to the current plan.

**Parameters:**
- `task` (string, required): Task description
- `priority` (string, optional): "low", "medium", "high"
- `tags` (string[], optional): Task tags
- `planId` (string, optional): Associated plan ID

**Returns:**
- Created task with ID

### dokoro_task_update

Update task status or details.

**Parameters:**
- `taskId` (string, required): Task ID
- `status` (string, optional): "pending", "in-progress", "completed"
- `notes` (string, optional): Additional notes

**Returns:**
- Updated task details

## Search Server Tools

### dokoro_search

Basic search across all development logs.

**Parameters:**
- `query` (string, required): Search query
- `limit` (number, optional): Maximum results (default: 10)
- `offset` (number, optional): Results offset

**Returns:**
- Array of matching log entries

**Example:**
```typescript
const results = await dokoro_search({
  query: "authentication bug",
  limit: 20
});
```

### dokoro_search_semantic

AI-powered semantic search using embeddings.

**Parameters:**
- `query` (string, required): Search query
- `useEmbeddings` (boolean, optional): Use semantic search
- `threshold` (number, optional): Similarity threshold (0-1)
- `limit` (number, optional): Maximum results

**Returns:**
- Semantically similar entries with relevance scores

### dokoro_search_by_date

Search within specific date ranges.

**Parameters:**
- `startDate` (string, required): Start date (ISO format)
- `endDate` (string, required): End date
- `query` (string, optional): Additional text filter

**Returns:**
- Entries within date range

### dokoro_search_by_tag

Search entries by tags.

**Parameters:**
- `tags` (string[], required): Tags to search for
- `matchAll` (boolean, optional): Require all tags (default: false)

**Returns:**
- Entries matching tag criteria

## Error Handling

All tools follow consistent error handling:

1. **Missing Parameters**: Returns error with missing parameter details
2. **Invalid Parameters**: Returns validation error with specifics
3. **System Errors**: Returns error with message and optional stack trace
4. **Lock Conflicts**: Returns specific lock conflict information

## Best Practices

1. **Always check workspace status** before claiming
2. **Use meaningful task descriptions** for better analytics
3. **Tag consistently** for effective searching
4. **Log regularly** throughout development sessions
5. **Use force claim sparingly** - respect other agents' locks
6. **Batch log entries** when possible for performance

## Rate Limits

- No hard rate limits on tool calls
- Workspace claims have built-in lock timeouts
- Search operations may be throttled if using AI features

## Integration Examples

### Full Session Workflow

```typescript
// 1. Check and claim workspace
const status = await dokoro_workspace_status();
if (!status.isLocked || status.lockInfo.isExpired) {
  await dokoro_workspace_claim({
    task: "Feature: User Dashboard",
    tags: { sprint: "S24-3", team: "frontend" }
  });
}

// 2. Create a plan
const plan = await dokoro_plan_create({
  goal: "Implement user dashboard",
  tasks: [
    "Design dashboard layout",
    "Create API endpoints",
    "Implement frontend components"
  ]
});

// 3. Work and log progress
await dokoro_session_log({
  entries: ["Completed dashboard wireframes"],
  tags: { milestone: "design-complete" }
});

// 4. Update task status
await dokoro_task_update({
  taskId: plan.tasks[0].id,
  status: "completed"
});

// 5. Search for related work
const related = await dokoro_search_semantic({
  query: "dashboard implementation patterns",
  useEmbeddings: true
});

// 6. Generate analytics
const report = await dokoro_analytics_summary({ days: 7 });
```