# DevLog MCP with Multiple AI CLIs

DevLog MCP is designed to work with various AI CLI tools, not just Claude Code.

## Supported CLIs

### Claude Code (Primary)
```bash
claude mcp add devlog "node" "$(pwd)/bin/devlog-core.js"
```

### Gemini CLI
```bash
# Using gemini-cli (https://github.com/google-gemini/gemini-cli)
gemini mcp add devlog "node" "$(pwd)/bin/devlog-core.js"
```

### Qwen3 Coder
```bash
# Using Qwen3 Coder (https://qwenlm.github.io/blog/qwen3-coder/)
qwen mcp add devlog "node" "$(pwd)/bin/devlog-core.js"
```

## CLI-Specific Configuration

### Environment Variables

Each CLI may use different environment variables:

```bash
# Claude Code
CLAUDE_CLI_VERSION=1.0.0
ANTHROPIC_API_KEY=sk-ant-...

# Gemini CLI
GEMINI_CLI_VERSION=1.0.0
GEMINI_API_KEY=...

# Qwen3 Coder
QWEN_CLI_VERSION=1.0.0
QWEN_API_KEY=...
```

### Feature Compatibility

| Feature | Claude Code | Gemini CLI | Qwen3 Coder |
|---------|------------|------------|-------------|
| Streaming | ✅ | ✅ | ❌ |
| OAuth | ✅ | ❌ | ❌ |
| Notifications | ✅ | ❌ | ❌ |
| Tool Calling | ✅ | ✅ | ✅ |

## Multi-CLI Setup

### Option 1: Separate Configurations

Create CLI-specific config files:

```bash
# .env.claude
ANTHROPIC_API_KEY=sk-ant-...
DEVLOG_WORKSPACE_ID=claude-workspace

# .env.gemini
GEMINI_API_KEY=...
DEVLOG_WORKSPACE_ID=gemini-workspace

# .env.qwen
QWEN_API_KEY=...
DEVLOG_WORKSPACE_ID=qwen-workspace
```

Add servers with different names:
```bash
claude mcp add devlog-claude "./mcp-wrapper.sh" ".env.claude" "node" "bin/devlog-core.js"
gemini mcp add devlog-gemini "./mcp-wrapper.sh" ".env.gemini" "node" "bin/devlog-core.js"
qwen mcp add devlog-qwen "./mcp-wrapper.sh" ".env.qwen" "node" "bin/devlog-core.js"
```

### Option 2: Unified Configuration

Use a single configuration with CLI detection:

```bash
# .env.local
ANTHROPIC_API_KEY=sk-ant-...
GEMINI_API_KEY=...
QWEN_API_KEY=...

# DevLog will auto-detect which CLI is calling it
DEVLOG_AUTO_DETECT_CLI=true
```

## CLI Detection

DevLog automatically detects which CLI is using it and adapts responses accordingly:

```typescript
// Auto-detection in action
const cli = detectCLI();
console.log(`Running with ${cli.name} v${cli.version}`);

// Adapt features based on CLI
if (!cli.features.supportsStreaming) {
  // Return batch responses instead of streaming
}
```

## Workspace Isolation

Each CLI can have its own workspace:

```bash
# Automatic workspace naming
DEVLOG_WORKSPACE_ID=${CLI_NAME:-default}-workspace

# Or explicit naming
DEVLOG_WORKSPACE_ID=my-claude-project  # for Claude
DEVLOG_WORKSPACE_ID=my-gemini-project  # for Gemini
```

## Tool Compatibility

All core DevLog tools work with all CLIs:
- `devlog_workspace_status`
- `devlog_workspace_claim`
- `devlog_session_log`
- `devlog_analytics_summary`

Some tools may have reduced functionality:
- Streaming tools → batch mode for Qwen3
- OAuth tools → disabled for non-Claude CLIs

## Best Practices

1. **Use separate workspaces** for different CLIs to avoid conflicts
2. **Configure API keys** for the specific CLI you're using
3. **Test tool compatibility** when switching CLIs
4. **Monitor logs** for CLI detection messages

## Example: Multi-CLI Workflow

```bash
# Morning: Use Claude for complex analysis
export DEVLOG_WORKSPACE_ID=project-claude
claude chat "Analyze the codebase architecture"

# Afternoon: Use Gemini for quick queries
export DEVLOG_WORKSPACE_ID=project-gemini
gemini chat "List recent changes"

# Evening: Use Qwen for code generation
export DEVLOG_WORKSPACE_ID=project-qwen
qwen generate "Create a test suite"

# All sessions logged separately in DevLog!
```

## Troubleshooting

### CLI Not Detected
```bash
# Manually specify CLI
DEVLOG_CLI_NAME=gemini node bin/devlog-core.js
```

### Feature Not Supported
Check logs for messages like:
```
[DevLog] CLI 'qwen3-coder' does not support streaming, using batch mode
```

### Workspace Conflicts
Use unique workspace IDs:
```bash
DEVLOG_WORKSPACE_ID=${USER}-${CLI_NAME}-${PROJECT}
```