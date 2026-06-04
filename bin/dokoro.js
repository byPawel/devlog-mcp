#!/usr/bin/env node
/**
 * dokoro — package entrypoint (works from the published npm package; no tsx/src needed).
 *
 * Default (no subcommand): start the unified MCP server over stdio. This is what
 *   `claude mcp add dokoro -- npx -y dokoro` runs — each project gets its own
 *   ./dokoro store (DOKORO_PATH defaults to <cwd>/dokoro), so install is per-project
 *   with zero shared state.
 *
 * Subcommands (init, migrate, …): delegate to the compiled CLI.
 *
 * Both targets are the compiled output under dist/esm (shipped via package.json
 * "files"), so this runs under plain `node` without tsx or the TypeScript sources.
 */

const sub = process.argv[2];
const CLI_COMMANDS = new Set([
  'init', 'migrate', 'cleanup', 'help', '--help', '-h', 'version', '--version', '-v',
]);

if (sub && CLI_COMMANDS.has(sub)) {
  await import('../dist/esm/dokoro-cli.js');
} else {
  // No subcommand → run the MCP server (stdio). Default to the unified server so a
  // single `npx -y dokoro` exposes all tools in one process.
  await import('../dist/esm/servers/unified-server.js');
}
