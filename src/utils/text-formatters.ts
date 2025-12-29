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

// ============================================================================
// GRADIENT DIVIDERS (256-color)
// ============================================================================

/**
 * Create a gradient divider using ANSI 256 colors
 */
export function gradientDivider(
  fromColor: number,
  toColor: number,
  char: string = '─',
  width: number = 60
): string {
  let result = '';
  for (let i = 0; i < width; i++) {
    const colorCode = Math.round(fromColor + ((toColor - fromColor) * (i / width)));
    result += chalk.ansi256(colorCode)(char);
  }
  return result;
}

export const gradients = {
  /** Blue to purple gradient (nebula theme) */
  blueToPurple: (width = 60) => gradientDivider(69, 141, '─', width),
  /** Cyan to magenta gradient (cyberpunk theme) */
  cyanToMagenta: (width = 60) => gradientDivider(51, 201, '═', width),
  /** Green to yellow gradient */
  greenToYellow: (width = 60) => gradientDivider(42, 226, '─', width),
  /** Ocean gradient (blue shades) */
  ocean: (width = 60) => gradientDivider(24, 39, '─', width),
  /** Sunset gradient (red to orange) */
  sunset: (width = 60) => gradientDivider(196, 214, '━', width),
  /** Rainbow using fixed color stops */
  rainbow: (width = 60) => {
    const colors = [196, 208, 226, 46, 51, 57, 201]; // ROYGBIV
    let result = '';
    for (let i = 0; i < width; i++) {
      const colorIndex = Math.floor((i / width) * colors.length);
      result += chalk.ansi256(colors[colorIndex])('━');
    }
    return result;
  },
};

// ============================================================================
// DECORATIVE SEPARATORS
// ============================================================================

export const decorative = {
  /** Starfield separator (random colors) */
  starfield: (width = 60) => {
    const stars = ['✦', '✧', '★', '☆', '·'];
    let result = '';
    for (let i = 0; i < width; i++) {
      const star = stars[Math.floor(Math.random() * stars.length)];
      result += chalk.ansi256(141 + Math.floor(Math.random() * 30))(star);
    }
    return result;
  },

  /** Circuit pattern (cyberpunk) */
  circuit: () => chalk.cyan('─┬──┴─┬──┴─┬──┴─┬──┴─┬──┴─┬──┴─┬──┴─'),

  /** Wave pattern (ocean) */
  waves: () => chalk.blue('≋≋≋≋≋≋≋≋≋≋≋≋≋≋≋≋≋≋≋≋≋≋≋≋≋≋≋≋≋≋'),

  /** Sparkles */
  sparkles: () => chalk.yellow('✨ ✨ ✨ ✨ ✨ ✨ ✨ ✨ ✨ ✨'),

  /** Arrows */
  arrows: () => chalk.cyan('→ → → → → → → → → → → → → → →'),

  /** Chevrons */
  chevrons: () => chalk.magenta('» » » » » » » » » » » » » » »'),

  /** Diamond chain */
  diamonds: () => chalk.cyan('◆ ◇ ◆ ◇ ◆ ◇ ◆ ◇ ◆ ◇ ◆ ◇ ◆ ◇ ◆'),

  /** Fade dots */
  fadeDots: () => chalk.gray('·  ·  ·  ·  ·  ·  ·  ·  ·  ·  ·'),

  /** DNA helix */
  dna: () => chalk.green('╱╲╱╲╱╲╱╲╱╲╱╲╱╲╱╲╱╲╱╲╱╲╱╲╱╲╱╲'),

  /** Binary */
  binary: () => chalk.green('01001010 11010010 10110101 01101001'),
};

// ============================================================================
// BOXED HEADERS & SECTIONS
// ============================================================================

const boxChars = {
  rounded: { tl: '╭', tr: '╮', bl: '╰', br: '╯', h: '─', v: '│' },
  sharp: { tl: '┌', tr: '┐', bl: '└', br: '┘', h: '─', v: '│' },
  double: { tl: '╔', tr: '╗', bl: '╚', br: '╝', h: '═', v: '║' },
  bold: { tl: '┏', tr: '┓', bl: '┗', br: '┛', h: '━', v: '┃' },
};

/**
 * Create a boxed header line: ╭─── Title ───╮
 */
export function boxedHeader(
  title: string,
  options: {
    width?: number;
    style?: 'rounded' | 'sharp' | 'double' | 'bold';
    color?: typeof chalk;
  } = {}
): string {
  const { width = 50, style = 'rounded', color = chalk.cyan } = options;
  const chars = boxChars[style];

  const innerWidth = width - 2;
  const titleLen = title.length + 2;
  const leftPad = Math.floor((innerWidth - titleLen) / 2);
  const rightPad = innerWidth - titleLen - leftPad;

  return color(
    chars.tl + chars.h.repeat(leftPad) + ' '
  ) + chalk.bold.white(title) + color(
    ' ' + chars.h.repeat(rightPad) + chars.tr
  );
}

/**
 * Create a full box around content
 */
export function boxSection(
  title: string,
  content: string,
  options: {
    width?: number;
    style?: 'rounded' | 'sharp' | 'double' | 'bold';
    color?: typeof chalk;
  } = {}
): string {
  const { width = 50, style = 'rounded', color = chalk.cyan } = options;
  const chars = boxChars[style];

  const innerWidth = width - 4;
  const titleLen = title.length + 2;
  const leftPad = Math.floor((innerWidth - titleLen) / 2);
  const rightPad = innerWidth - titleLen - leftPad;

  const lines: string[] = [];

  // Top border with title
  lines.push(color(
    chars.tl + chars.h.repeat(leftPad + 1) + ' '
  ) + chalk.bold.white(title) + color(
    ' ' + chars.h.repeat(rightPad + 1) + chars.tr
  ));

  // Content lines
  const contentLines = content.split('\n');
  for (const line of contentLines) {
    const paddedLine = line.slice(0, innerWidth).padEnd(innerWidth);
    lines.push(color(chars.v + ' ') + paddedLine + color(' ' + chars.v));
  }

  // Bottom border
  lines.push(color(chars.bl + chars.h.repeat(width - 2) + chars.br));

  return lines.join('\n');
}

// ============================================================================
// SPARKLINES (ASCII data visualization)
// ============================================================================

const sparkChars = ['▁', '▂', '▃', '▄', '▅', '▆', '▇', '█'];

/**
 * Create a sparkline from data points
 * Example: sparkline([1,3,5,2,8,4,6]) → "▁▃▅▂█▄▆"
 */
export function sparkline(data: number[], color?: typeof chalk): string {
  if (data.length === 0) return '';

  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;

  const line = data.map(value => {
    const normalized = (value - min) / range;
    const index = Math.min(Math.floor(normalized * sparkChars.length), sparkChars.length - 1);
    return sparkChars[index];
  }).join('');

  return color ? color(line) : chalk.cyan(line);
}

/**
 * Create a labeled sparkline with min/max
 */
export function sparklineLabeled(label: string, data: number[]): string {
  if (data.length === 0) return `${label}: (no data)`;

  const min = Math.min(...data);
  const max = Math.max(...data);
  const line = sparkline(data);

  return `${chalk.gray(label + ':')} ${line} ${chalk.gray(`(${min}-${max})`)}`;
}

// ============================================================================
// TREE/LIST FORMATTING
// ============================================================================

/**
 * Format items as a tree structure
 */
export function tree(items: string[], options: { indent?: number; color?: typeof chalk } = {}): string {
  const { indent = 0, color = chalk.cyan } = options;
  const prefix = '  '.repeat(indent);

  return items.map((item, i) => {
    const isLast = i === items.length - 1;
    const branch = isLast ? '└── ' : '├── ';
    return prefix + color(branch) + item;
  }).join('\n');
}

/**
 * Format as a bullet list with different levels
 */
export function bulletList(items: Array<{ text: string; level?: number }>): string {
  const bullets = ['●', '○', '▸', '▹', '•'];
  const colors = [chalk.cyan, chalk.yellow, chalk.green, chalk.magenta, chalk.gray];

  return items.map(({ text, level = 0 }) => {
    const bullet = bullets[Math.min(level, bullets.length - 1)];
    const color = colors[Math.min(level, colors.length - 1)];
    const indent = '  '.repeat(level);
    return indent + color(bullet) + ' ' + text;
  }).join('\n');
}

// ============================================================================
// TABLE FORMATTING
// ============================================================================

/**
 * Format data as a simple table
 */
export function table(
  headers: string[],
  rows: string[][],
  options: { color?: typeof chalk } = {}
): string {
  const { color = chalk.cyan } = options;

  // Calculate column widths
  const widths = headers.map((h, i) => {
    const maxRow = Math.max(...rows.map(r => (r[i] || '').length));
    return Math.max(h.length, maxRow);
  });

  const lines: string[] = [];

  // Header
  const headerLine = headers.map((h, i) => chalk.bold(h.padEnd(widths[i]))).join(' │ ');
  lines.push(headerLine);

  // Separator
  const separator = widths.map(w => color('─'.repeat(w))).join('─┼─');
  lines.push(separator);

  // Rows
  for (const row of rows) {
    const rowLine = row.map((cell, i) => (cell || '').padEnd(widths[i])).join(' │ ');
    lines.push(rowLine);
  }

  return lines.join('\n');
}
