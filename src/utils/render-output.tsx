/**
 * Render Output Middleware for DevLog MCP
 *
 * Converts RenderableResult types to React Ink components
 * and renders them to ANSI strings for MCP tool responses.
 *
 * Usage:
 *   const ansiOutput = renderOutput({
 *     type: 'status-card',
 *     data: { title: 'Success', status: 'success', message: 'Done!' }
 *   });
 */

// MUST be first - forces color support before chalk/ink load
import './color-setup.js';

import React from 'react';
import { render, Box, Text } from 'ink';
import Gradient from 'ink-gradient';
import { PassThrough } from 'stream';
import chalk from 'chalk';
import {
  Theme,
  RenderableResult,
  StatusCardProps,
  SearchResultProps,
  TaskItemProps,
  WorkspaceStatusProps,
  SessionInfoProps,
  ResultBlockProps,
  ProgressBarProps,
  SparklineProps,
  TableProps,
  TreeProps,
  DividerProps,
  BoxedSectionProps,
  MetricsRowProps,
  ScoreProps,
} from './themes/types.js';
import { ThemeProvider, useTheme, getCurrentTheme } from './themes/index.js';
import { icon } from './icons.js';

// Force colors in non-TTY environment (MCP uses stdio)
process.env.FORCE_COLOR = '3';

// ============================================================================
// RENDER TO STRING
// ============================================================================

/**
 * Render a React Ink element to an ANSI string
 */
export function renderInkToString(element: React.ReactElement): string {
  let output = '';

  const stream = new PassThrough();
  stream.on('data', (chunk) => {
    output += chunk.toString();
  });

  const { unmount, cleanup } = render(element, {
    stdout: stream as any,
    stdin: process.stdin,
    exitOnCtrlC: false,
  });

  unmount();
  cleanup();
  stream.end();

  return output;
}

// ============================================================================
// INK COMPONENTS
// ============================================================================

/**
 * Status Card Component
 */
function StatusCard({ title, status, message, details }: StatusCardProps): JSX.Element {
  const theme = useTheme();
  const statusColors = theme.status[status];
  const statusIcon = {
    success: icon('success'),
    error: icon('error'),
    warning: icon('warning'),
    info: icon('info'),
    active: icon('active'),
  }[status];

  return (
    <Box
      flexDirection="column"
      borderStyle={theme.borders.card}
      borderColor={theme.borderColors[status === 'active' ? 'info' : status]}
      paddingX={1}
    >
      <Box>
        <Text backgroundColor={statusColors.bg} color={statusColors.fg} bold>
          {' '}{statusIcon} {title}{' '}
        </Text>
      </Box>
      <Box marginTop={1}>
        <Text>{message}</Text>
      </Box>
      {details && Object.keys(details).length > 0 && (
        <Box flexDirection="column" marginTop={1}>
          {Object.entries(details).map(([key, value]) => (
            <Box key={key}>
              <Text color={theme.colors.muted}>{key}: </Text>
              <Text>{value}</Text>
            </Box>
          ))}
        </Box>
      )}
    </Box>
  );
}

/**
 * Search Results Component
 */
function SearchResults({ results }: { results: SearchResultProps[] }): JSX.Element {
  const theme = useTheme();

  if (results.length === 0) {
    return (
      <Box>
        <Text color={theme.colors.muted}>{icon('info')} No results found</Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column">
      <Box marginBottom={1}>
        <Text color={theme.colors.primary} bold>
          {icon('search')} Found {results.length} results
        </Text>
      </Box>
      {results.map((result, i) => (
        <Box key={i} flexDirection="column" marginBottom={1}>
          <Box>
            <Text color={theme.colors.primary} bold>{icon('file')} </Text>
            <Text bold>{result.file}</Text>
            {result.title && (
              <Text color={theme.colors.muted}> - {result.title}</Text>
            )}
          </Box>
          {result.lastModified && (
            <Box marginLeft={2}>
              <Text color={theme.colors.muted}>
                {icon('time')} {result.lastModified.toISOString()}
              </Text>
            </Box>
          )}
          <Box marginLeft={2}>
            <Text color={theme.text.body}>{icon('arrow')} {result.excerpt}</Text>
          </Box>
        </Box>
      ))}
    </Box>
  );
}

/**
 * Task List Component
 */
function TaskList({ tasks }: { tasks: TaskItemProps[] }): JSX.Element {
  const theme = useTheme();

  const statusConfig = {
    pending: { icon: icon('pending'), color: theme.colors.muted },
    in_progress: { icon: icon('active'), color: theme.colors.info },
    completed: { icon: icon('completed'), color: theme.colors.success },
  };

  return (
    <Box flexDirection="column">
      {tasks.map((task, i) => {
        const config = statusConfig[task.status];
        return (
          <Box key={i}>
            <Text color={config.color}>{config.icon} </Text>
            <Text
              strikethrough={task.status === 'completed'}
              color={task.status === 'completed' ? theme.colors.muted : undefined}
            >
              {task.content}
            </Text>
          </Box>
        );
      })}
    </Box>
  );
}

/**
 * Workspace Status Component
 */
function WorkspaceStatus(props: WorkspaceStatusProps): JSX.Element {
  const theme = useTheme();
  const lockIcon = props.isLocked ? icon('locked') : icon('unlocked');
  const lockColor = props.isLocked ? theme.colors.warning : theme.colors.success;

  return (
    <Box
      flexDirection="column"
      borderStyle={theme.borders.card}
      borderColor={theme.borderColors.default}
      paddingX={1}
    >
      <Box>
        <Gradient name={theme.gradients.header}>
          <Text bold>{icon('workspace')} Workspace: {props.workspaceId}</Text>
        </Gradient>
      </Box>
      <Box marginTop={1}>
        <Text color={lockColor}>{lockIcon} </Text>
        <Text>
          {props.isLocked ? `Locked by ${props.lockedBy || 'unknown'}` : 'Available'}
        </Text>
      </Box>
      {props.task && (
        <Box>
          <Text color={theme.colors.muted}>{icon('task')} Task: </Text>
          <Text>{props.task}</Text>
        </Box>
      )}
      {props.sessionDuration && (
        <Box>
          <Text color={theme.colors.muted}>{icon('time')} Duration: </Text>
          <Text>{props.sessionDuration}</Text>
        </Box>
      )}
      {props.entries !== undefined && (
        <Box>
          <Text color={theme.colors.muted}>{icon('file')} Entries: </Text>
          <Text>{props.entries}</Text>
        </Box>
      )}
    </Box>
  );
}

/**
 * Session Info Component
 */
function SessionInfo(props: SessionInfoProps): JSX.Element {
  const theme = useTheme();

  return (
    <Box flexDirection="column" borderStyle={theme.borders.card} borderColor={theme.borderColors.info} paddingX={1}>
      <Box>
        <Text color={theme.colors.info} bold>
          {icon('session')} Session: {props.sessionId}
        </Text>
      </Box>
      <Box marginTop={1}>
        <Text color={theme.colors.muted}>{icon('task')} </Text>
        <Text>{props.task}</Text>
      </Box>
      <Box>
        <Text color={theme.colors.muted}>{icon('time')} Started: </Text>
        <Text>{props.startTime.toISOString()}</Text>
      </Box>
      {props.duration && (
        <Box>
          <Text color={theme.colors.muted}>{icon('time')} Duration: </Text>
          <Text>{props.duration}</Text>
        </Box>
      )}
      <Box>
        <Text color={theme.colors.muted}>{icon('file')} Entries: </Text>
        <Text>{props.entriesCount}</Text>
      </Box>
    </Box>
  );
}

/**
 * Result Block Component
 */
function ResultBlock({ title, content, borderColor, gradient }: ResultBlockProps): JSX.Element {
  const theme = useTheme();
  const resolvedBorderColor = borderColor || theme.borderColors.default;
  const resolvedGradient = gradient || theme.gradients.header;

  return (
    <Box flexDirection="column" borderStyle={theme.borders.card} borderColor={resolvedBorderColor} paddingX={1}>
      <Box>
        <Gradient name={resolvedGradient}>
          <Text bold>{title}</Text>
        </Gradient>
      </Box>
      <Box marginTop={1}>
        <Text>{content}</Text>
      </Box>
    </Box>
  );
}

/**
 * Error Display Component
 */
function ErrorDisplay({ message, details }: { message: string; details?: string }): JSX.Element {
  const theme = useTheme();

  return (
    <Box flexDirection="column" borderStyle={theme.borders.card} borderColor={theme.borderColors.error} paddingX={1}>
      <Box>
        <Text backgroundColor={theme.status.error.bg} color={theme.status.error.fg} bold>
          {' '}{icon('error')} Error{' '}
        </Text>
      </Box>
      <Box marginTop={1}>
        <Text color={theme.colors.error}>{message}</Text>
      </Box>
      {details && (
        <Box marginTop={1}>
          <Text color={theme.colors.muted}>{details}</Text>
        </Box>
      )}
    </Box>
  );
}

// ============================================================================
// DATA VISUALIZATION COMPONENTS
// ============================================================================

const progressChars = { filled: '█', empty: '░' };
const sparkChars = ['▁', '▂', '▃', '▄', '▅', '▆', '▇', '█'];

/**
 * Progress Bar Component
 */
function ProgressBar({ percent, width = 20, label, showPercent = true }: ProgressBarProps): JSX.Element {
  const theme = useTheme();
  const clamped = Math.max(0, Math.min(100, percent));
  const filled = Math.round((clamped / 100) * width);
  const empty = width - filled;

  const bar = progressChars.filled.repeat(filled) + progressChars.empty.repeat(empty);
  const color = clamped < 33 ? theme.colors.error : clamped < 66 ? theme.colors.warning : theme.colors.success;

  return (
    <Box>
      {label && <Text color={theme.colors.muted}>{label}: </Text>}
      <Text color={color}>[{bar}]</Text>
      {showPercent && <Text color={theme.colors.muted}> {clamped}%</Text>}
    </Box>
  );
}

/**
 * Sparkline Component
 */
function Sparkline({ data, label, showMinMax = true }: SparklineProps): JSX.Element {
  const theme = useTheme();

  if (data.length === 0) {
    return <Text color={theme.colors.muted}>{label ? `${label}: ` : ''}(no data)</Text>;
  }

  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;

  const line = data.map(value => {
    const normalized = (value - min) / range;
    const index = Math.min(Math.floor(normalized * sparkChars.length), sparkChars.length - 1);
    return sparkChars[index];
  }).join('');

  return (
    <Box>
      {label && <Text color={theme.colors.muted}>{label}: </Text>}
      <Text color={theme.colors.info}>{line}</Text>
      {showMinMax && <Text color={theme.colors.muted}> ({min}-{max})</Text>}
    </Box>
  );
}

/**
 * Table Component
 */
function Table({ headers, rows }: TableProps): JSX.Element {
  const theme = useTheme();

  // Calculate column widths
  const widths = headers.map((h, i) => {
    const maxRow = Math.max(...rows.map(r => (r[i] || '').length));
    return Math.max(h.length, maxRow);
  });

  return (
    <Box flexDirection="column">
      {/* Header */}
      <Box>
        {headers.map((h, i) => (
          <Box key={i} width={widths[i] + 3}>
            <Text bold>{h.padEnd(widths[i])}</Text>
            {i < headers.length - 1 && <Text color={theme.colors.muted}> │ </Text>}
          </Box>
        ))}
      </Box>
      {/* Separator */}
      <Box>
        {widths.map((w, i) => (
          <Box key={i}>
            <Text color={theme.colors.primary}>{'─'.repeat(w)}</Text>
            {i < widths.length - 1 && <Text color={theme.colors.muted}>─┼─</Text>}
          </Box>
        ))}
      </Box>
      {/* Rows */}
      {rows.map((row, rowIdx) => (
        <Box key={rowIdx}>
          {row.map((cell, i) => (
            <Box key={i} width={widths[i] + 3}>
              <Text>{(cell || '').padEnd(widths[i])}</Text>
              {i < row.length - 1 && <Text color={theme.colors.muted}> │ </Text>}
            </Box>
          ))}
        </Box>
      ))}
    </Box>
  );
}

/**
 * Tree Component
 */
function Tree({ items }: TreeProps): JSX.Element {
  const theme = useTheme();
  const bullets = ['●', '○', '▸', '▹', '•'];
  const colors = [theme.colors.primary, theme.colors.warning, theme.colors.success, theme.colors.secondary, theme.colors.muted];

  return (
    <Box flexDirection="column">
      {items.map((item, i) => {
        const level = item.level || 0;
        const bullet = bullets[Math.min(level, bullets.length - 1)];
        const color = colors[Math.min(level, colors.length - 1)];

        return (
          <Box key={i} marginLeft={level * 2}>
            <Text color={color}>{bullet} </Text>
            <Text>{item.text}</Text>
          </Box>
        );
      })}
    </Box>
  );
}

/**
 * Divider Component
 */
function Divider({ style = 'thin', width = 50, decorativeStyle }: DividerProps): JSX.Element {
  const theme = useTheme();

  const chars: Record<string, string> = {
    thin: '─',
    thick: '━',
    double: '═',
  };

  const decoratives: Record<string, { pattern: string; color: string }> = {
    stars: { pattern: '✦ ✧ ★ ☆ · ', color: theme.colors.secondary },
    circuit: { pattern: '─┬──┴─', color: theme.colors.info },
    waves: { pattern: '≋', color: theme.colors.primary },
    diamonds: { pattern: '◆ ◇ ', color: theme.colors.info },
    arrows: { pattern: '→ ', color: theme.colors.info },
  };

  if (style === 'gradient') {
    return (
      <Box>
        <Gradient name={theme.gradients.divider}>
          <Text>{'━'.repeat(width)}</Text>
        </Gradient>
      </Box>
    );
  }

  if (style === 'rainbow') {
    return (
      <Box>
        <Gradient name="rainbow">
          <Text>{'━'.repeat(width)}</Text>
        </Gradient>
      </Box>
    );
  }

  if (style === 'decorative' && decorativeStyle) {
    const dec = decoratives[decorativeStyle];
    const repeatCount = Math.ceil(width / dec.pattern.length);
    const line = dec.pattern.repeat(repeatCount).slice(0, width);
    return (
      <Box>
        <Text color={dec.color}>{line}</Text>
      </Box>
    );
  }

  const char = chars[style] || chars.thin;
  return (
    <Box>
      <Text color={theme.colors.muted}>{char.repeat(width)}</Text>
    </Box>
  );
}

const boxChars = {
  rounded: { tl: '╭', tr: '╮', bl: '╰', br: '╯', h: '─', v: '│' },
  sharp: { tl: '┌', tr: '┐', bl: '└', br: '┘', h: '─', v: '│' },
  double: { tl: '╔', tr: '╗', bl: '╚', br: '╝', h: '═', v: '║' },
  bold: { tl: '┏', tr: '┓', bl: '┗', br: '┛', h: '━', v: '┃' },
};

/**
 * Boxed Section Component
 */
function BoxedSection({ title, content, style = 'rounded' }: BoxedSectionProps): JSX.Element {
  const theme = useTheme();
  const chars = boxChars[style];
  const contentLines = content.split('\n');
  const maxLen = Math.max(title.length + 4, ...contentLines.map(l => l.length));
  const width = maxLen + 4;

  const titlePadLeft = Math.floor((width - title.length - 4) / 2);
  const titlePadRight = width - title.length - 4 - titlePadLeft;

  return (
    <Box flexDirection="column">
      {/* Top border with title */}
      <Box>
        <Text color={theme.colors.primary}>
          {chars.tl}{chars.h.repeat(titlePadLeft + 1)}{' '}
        </Text>
        <Text bold color={theme.text.heading}>{title}</Text>
        <Text color={theme.colors.primary}>
          {' '}{chars.h.repeat(titlePadRight + 1)}{chars.tr}
        </Text>
      </Box>
      {/* Content */}
      {contentLines.map((line, i) => (
        <Box key={i}>
          <Text color={theme.colors.primary}>{chars.v} </Text>
          <Text>{line.padEnd(width - 4)}</Text>
          <Text color={theme.colors.primary}> {chars.v}</Text>
        </Box>
      ))}
      {/* Bottom border */}
      <Box>
        <Text color={theme.colors.primary}>
          {chars.bl}{chars.h.repeat(width - 2)}{chars.br}
        </Text>
      </Box>
    </Box>
  );
}

/**
 * Metrics Row Component (model badge with stats)
 */
function MetricsRow({ model, durationMs, tokenCount, costAmount }: MetricsRowProps): JSX.Element {
  const theme = useTheme();

  const formatDuration = (ms: number) => {
    if (ms < 1000) return `${ms}ms`;
    return `${(ms / 1000).toFixed(1)}s`;
  };

  const formatTokens = (count: number) => count.toLocaleString();

  const formatCost = (amount: number) => `$${amount.toFixed(4)}`;

  const durationColor = durationMs !== undefined
    ? (durationMs < 5000 ? theme.colors.success : durationMs < 15000 ? theme.colors.warning : theme.colors.error)
    : theme.colors.muted;

  const costColor = costAmount !== undefined
    ? (costAmount < 0.01 ? theme.colors.success : costAmount < 0.10 ? theme.colors.warning : theme.colors.error)
    : theme.colors.muted;

  return (
    <Box>
      {model && (
        <Text backgroundColor={theme.colors.secondary} color="#000" bold> {model} </Text>
      )}
      {durationMs !== undefined && (
        <>
          <Text color={theme.colors.muted}> </Text>
          <Text color={durationColor}>{formatDuration(durationMs)}</Text>
        </>
      )}
      {tokenCount !== undefined && (
        <>
          <Text color={theme.colors.muted}> │ </Text>
          <Text color={theme.colors.info}>{formatTokens(tokenCount)} tokens</Text>
        </>
      )}
      {costAmount !== undefined && (
        <>
          <Text color={theme.colors.muted}> │ </Text>
          <Text color={costColor}>{formatCost(costAmount)}</Text>
        </>
      )}
    </Box>
  );
}

/**
 * Score Component
 */
function Score({ value, max = 10, label, showImprovement }: ScoreProps): JSX.Element {
  const theme = useTheme();

  const getColor = (v: number, m: number) => {
    const percent = (v / m) * 100;
    return percent < 40 ? theme.colors.error : percent < 70 ? theme.colors.warning : theme.colors.success;
  };

  return (
    <Box>
      {label && <Text color={theme.colors.muted}>{label}: </Text>}
      {showImprovement && (
        <>
          <Text color={getColor(showImprovement.from, max)} bold>{showImprovement.from}</Text>
          <Text color={theme.colors.muted}>/{max}</Text>
          <Text color={theme.colors.success}> → </Text>
        </>
      )}
      <Text color={getColor(value, max)} bold>{value}</Text>
      <Text color={theme.colors.muted}>/{max}</Text>
    </Box>
  );
}

// ============================================================================
// MARKDOWN RENDERING
// ============================================================================

/**
 * Markdown Renderer Component (simple version)
 * TODO: Implement full markdown parsing with marked/markdown-it
 */
function MarkdownContent({ content }: { content: string }): JSX.Element {
  const theme = useTheme();

  // Simple line-by-line rendering for now
  const lines = content.split('\n');

  return (
    <Box flexDirection="column">
      {lines.map((line, i) => {
        // Headers
        if (line.startsWith('# ')) {
          return (
            <Box key={i}>
              <Gradient name={theme.gradients.header}>
                <Text bold>{line.slice(2)}</Text>
              </Gradient>
            </Box>
          );
        }
        if (line.startsWith('## ')) {
          return (
            <Box key={i}>
              <Text color={theme.colors.primary} bold>{line.slice(3)}</Text>
            </Box>
          );
        }
        if (line.startsWith('### ')) {
          return (
            <Box key={i}>
              <Text color={theme.colors.secondary} bold>{line.slice(4)}</Text>
            </Box>
          );
        }

        // Bullets
        if (line.startsWith('- ') || line.startsWith('* ')) {
          return (
            <Box key={i}>
              <Text color={theme.bullets.level1.color}>{theme.bullets.level1.char} </Text>
              <Text>{line.slice(2)}</Text>
            </Box>
          );
        }
        if (line.startsWith('  - ') || line.startsWith('  * ')) {
          return (
            <Box key={i} marginLeft={2}>
              <Text color={theme.bullets.level2.color}>{theme.bullets.level2.char} </Text>
              <Text>{line.slice(4)}</Text>
            </Box>
          );
        }

        // Regular text
        return (
          <Box key={i}>
            <Text>{line}</Text>
          </Box>
        );
      })}
    </Box>
  );
}

// ============================================================================
// COMPONENT ROUTER
// ============================================================================

/**
 * Route RenderableResult to appropriate Ink component
 */
function RenderableRouter({ result }: { result: RenderableResult }): JSX.Element {
  switch (result.type) {
    case 'status-card':
      return <StatusCard {...result.data} />;
    case 'search-results':
      return <SearchResults results={result.data} />;
    case 'task-list':
      return <TaskList tasks={result.data} />;
    case 'workspace-status':
      return <WorkspaceStatus {...result.data} />;
    case 'session-info':
      return <SessionInfo {...result.data} />;
    case 'result-block':
      return <ResultBlock {...result.data} />;
    case 'markdown':
      return <MarkdownContent content={result.data.content} />;
    case 'text':
      return <Text>{result.data.text}</Text>;
    case 'error':
      return <ErrorDisplay message={result.data.message} details={result.data.details} />;
    // Data visualization
    case 'progress-bar':
      return <ProgressBar {...result.data} />;
    case 'sparkline':
      return <Sparkline {...result.data} />;
    case 'table':
      return <Table {...result.data} />;
    case 'tree':
      return <Tree {...result.data} />;
    case 'divider':
      return <Divider {...result.data} />;
    case 'boxed-section':
      return <BoxedSection {...result.data} />;
    case 'metrics-row':
      return <MetricsRow {...result.data} />;
    case 'score':
      return <Score {...result.data} />;
    default:
      return <Text>Unknown result type</Text>;
  }
}

// ============================================================================
// MAIN RENDER FUNCTION
// ============================================================================

/**
 * Render a RenderableResult to ANSI string
 *
 * @param result - The structured result to render
 * @param theme - Optional theme override (defaults to DEVLOG_THEME env var or nebula)
 * @returns ANSI-formatted string for terminal output
 *
 * @example
 * const output = renderOutput({
 *   type: 'status-card',
 *   data: { title: 'Success', status: 'success', message: 'Done!' }
 * });
 */
export function renderOutput(result: RenderableResult, theme?: Theme): string {
  const resolvedTheme = theme || getCurrentTheme();

  const element = (
    <ThemeProvider theme={resolvedTheme}>
      <RenderableRouter result={result} />
    </ThemeProvider>
  );

  return renderInkToString(element);
}

/**
 * Render plain text with theme styling
 */
export function renderText(text: string, theme?: Theme): string {
  return renderOutput({ type: 'text', data: { text } }, theme);
}

/**
 * Render markdown content with theme styling
 */
export function renderMarkdown(content: string, theme?: Theme): string {
  return renderOutput({ type: 'markdown', data: { content } }, theme);
}

/**
 * Render an error message
 */
export function renderError(message: string, details?: string, theme?: Theme): string {
  return renderOutput({ type: 'error', data: { message, details } }, theme);
}

// ============================================================================
// EXPORTS
// ============================================================================

export {
  // Core components
  StatusCard,
  SearchResults,
  TaskList,
  WorkspaceStatus,
  SessionInfo,
  ResultBlock,
  ErrorDisplay,
  MarkdownContent,
  RenderableRouter,
  // Data visualization
  ProgressBar,
  Sparkline,
  Table,
  Tree,
  Divider,
  BoxedSection,
  MetricsRow,
  Score,
};
