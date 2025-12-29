/**
 * Text Formatters for DevLog MCP
 *
 * Styled text helpers for terminal output.
 * Ported from tachibot-mcp ansi-styles.ts
 */

import './color-setup.js';
import chalk from 'chalk';

// ============================================================================
// PROGRESS BAR
// ============================================================================

export const progressChars = {
  filled: '█',
  empty: '░',
  partial: ['▏', '▎', '▍', '▌', '▋', '▊', '▉'],
};

/**
 * Render a progress bar with color coding
 * Red < 33% < Yellow < 66% < Green
 */
export function progressBar(percent: number, width: number = 20): string {
  const clamped = Math.max(0, Math.min(100, percent));
  const filled = Math.round((clamped / 100) * width);
  const empty = width - filled;

  const bar = progressChars.filled.repeat(filled) + progressChars.empty.repeat(empty);
  const color = clamped < 33 ? chalk.red : clamped < 66 ? chalk.yellow : chalk.green;

  return color(`[${bar}]`) + chalk.gray(` ${clamped}%`);
}

// ============================================================================
// SCORES & STATS
// ============================================================================

/**
 * Render a score with color coding (e.g., "3/10" or "9/10")
 * Low scores = red, medium = yellow, high = green
 */
export function score(value: number, max: number = 10): string {
  const percent = (value / max) * 100;
  const color = percent < 40 ? chalk.red : percent < 70 ? chalk.yellow : chalk.green;
  return chalk.bold(color(`${value}`)) + chalk.gray(`/${max}`);
}

/**
 * Render a score with improvement arrow (e.g., "3/10 → 9/10")
 */
export function scoreImprovement(from: number, to: number, max: number = 10): string {
  const fromScore = score(from, max);
  const toScore = score(to, max);
  const arrow = from < to ? chalk.greenBright(' → ') : chalk.redBright(' → ');
  return fromScore + arrow + toScore;
}

/**
 * Render a percentage with color coding
 */
export function percentage(value: number): string {
  const clamped = Math.max(0, Math.min(100, value));
  const color = clamped < 33 ? chalk.red : clamped < 66 ? chalk.yellow : chalk.green;
  return color.bold(`${clamped}%`);
}

// ============================================================================
// KEY-VALUE FORMATTING
// ============================================================================

/**
 * Render a label with value (e.g., "Tokens: 1,234")
 */
export function labelValue(label: string, value: string | number): string {
  return chalk.gray(`${label}: `) + chalk.white.bold(`${value}`);
}

/**
 * Render a key-value pair inline (e.g., "model=gpt-5.2")
 */
export function keyValue(key: string, value: string): string {
  return chalk.cyan(key) + chalk.gray('=') + chalk.white(value);
}

// ============================================================================
// TIME & METRICS
// ============================================================================

/**
 * Render a timestamp [HH:MM:SS]
 */
export function timestamp(date?: Date): string {
  const d = date || new Date();
  const time = d.toLocaleTimeString('en-US', { hour12: false });
  return chalk.gray(`[${time}]`);
}

/**
 * Render duration (e.g., "1.2s" or "45ms")
 * Green < 5s < Yellow < 15s < Red
 */
export function duration(ms: number): string {
  if (ms < 1000) {
    return chalk.cyan(`${ms}ms`);
  }
  const seconds = (ms / 1000).toFixed(1);
  const color = ms < 5000 ? chalk.green : ms < 15000 ? chalk.yellow : chalk.red;
  return color(`${seconds}s`);
}

/**
 * Render a cost (e.g., "$0.0045")
 * Green < $0.01 < Yellow < $0.10 < Red
 */
export function cost(amount: number): string {
  const color = amount < 0.01 ? chalk.green : amount < 0.10 ? chalk.yellow : chalk.red;
  return color(`$${amount.toFixed(4)}`);
}

/**
 * Render tokens count with formatting (e.g., "1,234 tokens")
 */
export function tokens(count: number): string {
  const formatted = count.toLocaleString();
  const color = count < 1000 ? chalk.green : count < 5000 ? chalk.yellow : chalk.cyan;
  return color(`${formatted} tokens`);
}

// ============================================================================
// TEXT STYLING
// ============================================================================

/**
 * Render highlighted text (yellow background)
 */
export function highlight(text: string): string {
  return chalk.bgYellow.black(` ${text} `);
}

/**
 * Render inline code (gray background)
 */
export function inlineCode(text: string): string {
  return chalk.bgGray.white(` ${text} `);
}

/**
 * Render a file path (cyan, underlined)
 */
export function filePath(path: string): string {
  return chalk.cyan.underline(path);
}

/**
 * Render a clickable URL/link
 * Uses OSC 8 hyperlinks for supported terminals (iTerm, WezTerm, kitty)
 */
export function link(url: string, text?: string): string {
  const displayText = text || url;
  const supportsHyperlinks =
    process.env.TERM_PROGRAM === 'iTerm.app' ||
    process.env.TERM_PROGRAM === 'WezTerm' ||
    process.env.TERM === 'xterm-kitty';

  if (supportsHyperlinks) {
    return `\x1b]8;;${url}\x07${chalk.blue.underline(displayText)}\x1b]8;;\x07`;
  }
  return chalk.blue.underline(displayText);
}

// ============================================================================
// STATUS MESSAGES
// ============================================================================

/**
 * Render a warning message with icon
 */
export function warning(text: string): string {
  return chalk.bgYellow.black(' ⚠ ') + chalk.yellow(` ${text}`);
}

/**
 * Render an error message with icon
 */
export function error(text: string): string {
  return chalk.bgRed.white(' ✗ ') + chalk.red(` ${text}`);
}

/**
 * Render a success message with icon
 */
export function success(text: string): string {
  return chalk.bgGreen.black(' ✓ ') + chalk.green(` ${text}`);
}

/**
 * Render an info message with icon
 */
export function info(text: string): string {
  return chalk.bgBlue.white(' ℹ ') + chalk.blue(` ${text}`);
}

/**
 * Render a debug message with icon
 */
export function debug(text: string): string {
  return chalk.bgMagenta.white(' 🔍 ') + chalk.magenta(` ${text}`);
}

// ============================================================================
// DIVIDERS
// ============================================================================

/**
 * Render a thin divider line
 */
export function dividerThin(width: number = 60): string {
  return chalk.gray('─'.repeat(width));
}

/**
 * Render a thick divider line
 */
export function dividerThick(width: number = 60): string {
  return chalk.gray('━'.repeat(width));
}

/**
 * Render a double divider line
 */
export function dividerDouble(width: number = 60): string {
  return chalk.gray('═'.repeat(width));
}

// ============================================================================
// COMPOSITE HELPERS
// ============================================================================

/**
 * Render a section header with divider
 */
export function sectionHeader(title: string, width: number = 60): string {
  return `\n${chalk.bold.white(title)}\n${dividerThin(width)}\n`;
}

/**
 * Render a tool result header with metrics
 * Example: " grok  2.3s | 1,234 tokens | $0.0012"
 */
export function toolResultHeader(opts: {
  model: string;
  durationMs?: number;
  tokenCount?: number;
  costAmount?: number;
}): string {
  const parts = [chalk.bgMagenta.black(` ${opts.model} `)];

  if (opts.durationMs !== undefined) {
    parts.push(duration(opts.durationMs));
  }
  if (opts.tokenCount !== undefined) {
    parts.push(tokens(opts.tokenCount));
  }
  if (opts.costAmount !== undefined) {
    parts.push(cost(opts.costAmount));
  }

  return parts.join(chalk.gray(' | ')) + '\n';
}

/**
 * Render a code review score summary
 * Example: "Score: 3/10 → 9/10 with fixes"
 */
export function reviewScore(current: number, potential?: number, max: number = 10): string {
  if (potential !== undefined) {
    return chalk.bold('Score: ') + scoreImprovement(current, potential, max) + chalk.gray(' with fixes');
  }
  return chalk.bold('Score: ') + score(current, max);
}
