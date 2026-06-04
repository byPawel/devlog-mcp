# Dokoro

This is the development log for tracking project progress, decisions, and insights.

## Structure

- **daily/** - Daily work sessions and progress
- **features/** - Feature planning and implementation tracking
- **decisions/** - Architectural and design decisions
- **insights/** - Research findings and analysis
- **research/** - Deep dives and explorations
- **retrospective/** - Weekly/monthly reviews and learnings
- **archive/** - Old content for reference

## Getting Started

1. Use `dokoro_workspace_claim` to start a new session
2. Track progress with `dokoro_session_log`
3. End sessions with `dokoro_workspace_dump`

## Conventions

### Filename Format
`YYYY-MM-DD-HHhMM-dayname-type-topic.md`

Examples:
- 2025-06-26-09h33-wednesday-session-state-management.md
- 2025-06-26-14h22-wednesday-feature-api-integration.md
- 2025-06-27-10h00-thursday-decision-architecture.md

### Tags
Use frontmatter tags for better organization:
```yaml
tags:
  type: [session, feature, decision, research]
  scope: [api, ui, backend, infrastructure]
  status: [planned, in-progress, completed, blocked]
```

---
*Initialized: 2025-08-05*