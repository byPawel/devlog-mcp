/**
 * Centralized formatting utilities for devlog-mcp
 * Provides consistent icons, colors, and output formatting
 *
 * Icon modes:
 * - 'nerd' (default): Nerd Font icons - requires patched font
 * - 'unicode': Clean Unicode symbols - works everywhere
 *
 * Set via: DEVLOG_ICON_MODE=nerd|unicode
 *
 * Features:
 * - Smart Nerd Font detection (auto-detects terminal support)
 * - React Ink rendering for complex layouts
 * - Gradient text support
 * - ASCII flowcharts (Mermaid alternative)
 */

// =============================================================================
// RE-EXPORT FROM SPECIALIZED MODULES
// =============================================================================

// Smart icon system with auto-detection
export {
  Icon,
  icon,
  hasNerdFontSupport,
  resetIconCache,
  unicodeIcons,
  nerdIcons,
  type IconName,
  type NerdIconName,
} from './icons.js';

// React Ink rendering - core
export {
  renderInkToString,
  renderGradientText,
  renderGradientDivider,
  renderGradientBoxTop,
  renderStatusCard,
  renderResultBlock,
  renderSessionInfo,
  renderTaskList,
  renderAsciiFlowchart,
  renderQuickFlow,
  renderGradientBox,
  drawBox,
  borderChars,
  StatusCard,
  ResultBlock,
  SessionInfo,
  TaskList,
  AsciiFlowchart,
  type GradientPreset,
  type BorderStyle,
  type StatusCardProps,
  type ResultBlockProps,
  type FlowNode,
  type FlowEdge,
  // Advanced visualization components
  WorkflowCascade,
  renderWorkflowCascade,
  type WorkflowStep,
  ModelChorus,
  renderModelChorus,
  type ModelResponse,
  ProgressReel,
  renderProgressReel,
  type ProgressPhase,
  SparklinesGrid,
  renderSparklinesGrid,
  type SparklineData,
  ThinkingChainArbor,
  renderThinkingChainArbor,
  type ThinkingStep,
  FocusSessionHorizon,
  renderFocusSessionHorizon,
  type FocusSessionSummary,
  ReceiptPrinter,
  renderReceipt,
  type ReceiptData,
  WaterfallTrace,
  renderWaterfallTrace,
  type WaterfallStep,
  ErrorAutopsy,
  renderErrorAutopsy,
  type ErrorDetails,
  SourceHeatmap,
  renderSourceHeatmap,
  type SourceCitation,
} from './ink-renderer.js';

// =============================================================================
// LEGACY COMPATIBILITY - Keep existing icon aliases working
// =============================================================================

import { Icon as IconInternal } from './icons.js';

// Semantic aliases for common use cases
export const Status = {
  get ok() { return IconInternal.success; },
  get err() { return IconInternal.error; },
  get warn() { return IconInternal.warning; },
  get info() { return IconInternal.info; },
} as const;

// Internal alias for using Icon within this file
const I = IconInternal;

// =============================================================================
// ANSI COLORS (optional - for terminal output)
// =============================================================================

export const Color = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',

  // Foreground
  black: '\x1b[30m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  white: '\x1b[37m',
  gray: '\x1b[90m',

  // Bright variants
  brightRed: '\x1b[91m',
  brightGreen: '\x1b[92m',
  brightYellow: '\x1b[93m',
  brightBlue: '\x1b[94m',
  brightCyan: '\x1b[96m',
} as const;

// Whether to enable ANSI colors in output
// Set to false for MCP responses (Claude strips/shows raw codes)
let colorsEnabled = false;

export function enableColors(enabled: boolean): void {
  colorsEnabled = enabled;
}

export function color(text: string, c: string): string {
  if (!colorsEnabled) return text;
  return `${c}${text}${Color.reset}`;
}

// =============================================================================
// FORMATTING HELPERS
// =============================================================================

/**
 * Format a header with icon
 */
export function header(icon: string, text: string, level: 1 | 2 | 3 | 4 = 2): string {
  const hashes = '#'.repeat(level);
  return `${hashes} ${icon} ${text}`;
}

/**
 * Format a status line
 */
export function status(icon: string, label: string, value?: string | number): string {
  if (value !== undefined) {
    return `${icon} **${label}:** ${value}`;
  }
  return `${icon} ${label}`;
}

/**
 * Format a list item
 */
export function listItem(icon: string, text: string, indent = 0): string {
  const prefix = '  '.repeat(indent);
  return `${prefix}- ${icon} ${text}`;
}

/**
 * Format key-value pair
 */
export function kv(key: string, value: string | number | boolean | null | undefined): string {
  if (value === null || value === undefined) {
    return `**${key}:** —`;
  }
  return `**${key}:** ${value}`;
}

/**
 * Format a section with items
 */
export function section(title: string, items: string[], iconStr?: string): string {
  const headerIcon = iconStr || I.folder;
  const lines = [header(headerIcon, title, 3)];
  if (items.length === 0) {
    lines.push('_No items_');
  } else {
    lines.push(...items);
  }
  return lines.join('\n');
}

/**
 * Format inline code
 */
export function code(text: string): string {
  return `\`${text}\``;
}

/**
 * Format a code block
 */
export function codeBlock(text: string, lang = ''): string {
  return `\`\`\`${lang}\n${text}\n\`\`\``;
}

/**
 * Format a timestamp
 */
export function timestamp(date: Date | string | number): string {
  const d = new Date(date);
  return d.toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, '');
}

/**
 * Format duration in human-readable form
 */
export function duration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  if (ms < 3600000) return `${Math.floor(ms / 60000)}m ${Math.floor((ms % 60000) / 1000)}s`;
  const hours = Math.floor(ms / 3600000);
  const mins = Math.floor((ms % 3600000) / 60000);
  return `${hours}h ${mins}m`;
}

/**
 * Format a count with label
 */
export function count(n: number, singular: string, plural?: string): string {
  const word = n === 1 ? singular : (plural || `${singular}s`);
  return `${n} ${word}`;
}

/**
 * Format percentage
 */
export function percent(value: number, total: number): string {
  if (total === 0) return '—';
  return `${Math.round((value / total) * 100)}%`;
}

// =============================================================================
// RESPONSE BUILDERS
// =============================================================================

export interface ToolResponse {
  success: boolean;
  title: string;
  body: string;
  details?: Record<string, unknown>;
}

/**
 * Build a success response
 */
export function successResponse(title: string, body: string): string {
  return `${I.success} **${title}**\n\n${body}`;
}

/**
 * Build an error response
 */
export function errorResponse(title: string, body: string): string {
  return `${I.error} **${title}**\n\n${body}`;
}

/**
 * Build a warning response
 */
export function warningResponse(title: string, body: string): string {
  return `${I.warning} **${title}**\n\n${body}`;
}

/**
 * Build an info response
 */
export function infoResponse(title: string, body: string): string {
  return `${I.info} **${title}**\n\n${body}`;
}

// =============================================================================
// WORKSPACE-SPECIFIC FORMATTERS
// =============================================================================

export function formatWorkspaceStatus(data: {
  active: boolean;
  task?: string;
  agent?: string;
  duration?: number;
  progress?: string[];
}): string {
  const lines: string[] = [];

  if (data.active) {
    lines.push(header(I.success, 'Workspace Active', 2));
    if (data.task) lines.push(kv('Task', data.task));
    if (data.agent) lines.push(kv('Agent', code(data.agent)));
    if (data.duration) lines.push(kv('Duration', duration(data.duration)));
  } else {
    lines.push(header(I.unlock, 'Workspace Available', 2));
    lines.push('No active session');
  }

  if (data.progress && data.progress.length > 0) {
    lines.push('');
    lines.push(header(I.chart, 'Progress', 3));
    data.progress.forEach(p => lines.push(listItem(I.arrow, p)));
  }

  return lines.join('\n');
}

export function formatTaskList(tasks: Array<{
  id: string;
  title: string;
  status: 'active' | 'paused' | 'completed' | 'pending';
  duration?: number;
}>): string {
  if (tasks.length === 0) {
    return '_No tasks_';
  }

  const statusIcon = {
    active: I.active,
    paused: I.paused,
    completed: I.completed,
    pending: I.pending,
  };

  return tasks.map(t => {
    const icon = statusIcon[t.status];
    const dur = t.duration ? ` (${duration(t.duration)})` : '';
    return `${icon} ${t.title}${dur}`;
  }).join('\n');
}

export function formatStats(stats: Record<string, number>): string {
  const lines: string[] = [];
  for (const [key, value] of Object.entries(stats)) {
    lines.push(`${I.tag} **${key}:** ${value}`);
  }
  return lines.join('\n');
}

// =============================================================================
// BOX DRAWING (for structured output)
// =============================================================================

export const Box = {
  tl: '┌', t: '─', tr: '┐',
  l: '│',          r: '│',
  bl: '└', b: '─', br: '┘',

  // Connectors
  cross: '┼',
  tee: '┬',
  bTee: '┴',
  lTee: '├',
  rTee: '┤',
} as const;

/**
 * Draw a simple box around text
 */
export function box(text: string, width?: number): string {
  const lines = text.split('\n');
  const maxLen = width || Math.max(...lines.map(l => l.length));

  const top = Box.tl + Box.t.repeat(maxLen + 2) + Box.tr;
  const bot = Box.bl + Box.b.repeat(maxLen + 2) + Box.br;
  const padded = lines.map(l => `${Box.l} ${l.padEnd(maxLen)} ${Box.r}`);

  return [top, ...padded, bot].join('\n');
}

// =============================================================================
// PROGRESS INDICATORS
// =============================================================================

/**
 * ASCII progress bar
 */
export function progressBar(current: number, total: number, width = 20): string {
  const pct = total > 0 ? current / total : 0;
  const filled = Math.round(pct * width);
  const empty = width - filled;
  return `[${I.success.repeat(filled)}${I.pending.repeat(empty)}] ${Math.round(pct * 100)}%`;
}

/**
 * Simple fraction
 */
export function fraction(current: number, total: number): string {
  return `${current}/${total}`;
}
