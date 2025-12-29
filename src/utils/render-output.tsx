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

import React from 'react';
import { render, Box, Text } from 'ink';
import Gradient from 'ink-gradient';
import { PassThrough } from 'stream';
import {
  Theme,
  RenderableResult,
  StatusCardProps,
  SearchResultProps,
  TaskItemProps,
  WorkspaceStatusProps,
  SessionInfoProps,
  ResultBlockProps,
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
  StatusCard,
  SearchResults,
  TaskList,
  WorkspaceStatus,
  SessionInfo,
  ResultBlock,
  ErrorDisplay,
  MarkdownContent,
  RenderableRouter,
};
