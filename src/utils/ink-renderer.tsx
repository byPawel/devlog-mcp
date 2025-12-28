/**
 * Ink-to-String Renderer for DevLog MCP
 * Ported from tachibot-mcp
 *
 * Renders React Ink components to ANSI strings for MCP tool responses.
 */

import React from 'react';
import { render, Box, Text } from 'ink';
import Gradient from 'ink-gradient';
import gradientString from 'gradient-string';
import { PassThrough } from 'stream';
import { icon, Icon } from './icons.js';

// Force colors in non-TTY environment (MCP uses stdio)
process.env.FORCE_COLOR = '3';

// ============================================================================
// TYPES
// ============================================================================

export type GradientPreset =
  | 'rainbow' | 'cristal' | 'teen' | 'mind' | 'morning'
  | 'vice' | 'passion' | 'fruit' | 'atlas' | 'retro';

export type BorderStyle = 'single' | 'double' | 'round' | 'bold' | 'classic';

export interface StatusCardProps {
  title: string;
  status: 'success' | 'error' | 'warning' | 'info' | 'active';
  message: string;
  details?: Record<string, string>;
}

export interface ResultBlockProps {
  title: string;
  content: string;
  borderColor?: string;
  gradient?: GradientPreset;
}

// ============================================================================
// BORDER CHARACTERS
// ============================================================================

export const borderChars = {
  single:  { h: '─', v: '│', tl: '┌', tr: '┐', bl: '└', br: '┘' },
  double:  { h: '═', v: '║', tl: '╔', tr: '╗', bl: '╚', br: '╝' },
  round:   { h: '─', v: '│', tl: '╭', tr: '╮', bl: '╰', br: '╯' },
  bold:    { h: '━', v: '┃', tl: '┏', tr: '┓', bl: '┗', br: '┛' },
  classic: { h: '-', v: '|', tl: '+', tr: '+', bl: '+', br: '+' },
} as const;

// ============================================================================
// RENDER TO STRING
// ============================================================================

/**
 * Render an Ink component to an ANSI string
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
// GRADIENT UTILITIES
// ============================================================================

/**
 * Render text with gradient colors
 */
export function renderGradientText(text: string, preset: GradientPreset = 'rainbow'): string {
  const gradient = (gradientString as any)[preset] || gradientString.rainbow;
  return gradient(text);
}

/**
 * Create a gradient divider line
 */
export function renderGradientDivider(width: number = 60, preset: GradientPreset = 'vice'): string {
  const line = '─'.repeat(width);
  return renderGradientText(line, preset);
}

/**
 * Create a gradient box border with title
 */
export function renderGradientBoxTop(title: string, width: number = 60, preset: GradientPreset = 'cristal'): string {
  const paddedTitle = ` ${title} `;
  const leftWidth = Math.floor((width - paddedTitle.length - 2) / 2);
  const rightWidth = width - paddedTitle.length - leftWidth - 2;
  const line = '╭' + '─'.repeat(leftWidth) + paddedTitle + '─'.repeat(rightWidth) + '╮';
  return renderGradientText(line, preset);
}

// ============================================================================
// INK COMPONENTS
// ============================================================================

/**
 * Status Badge component
 */
const StatusBadge: React.FC<{ status: StatusCardProps['status'] }> = ({ status }) => {
  const colors: Record<string, string> = {
    success: 'green',
    error: 'red',
    warning: 'yellow',
    info: 'cyan',
    active: 'magenta',
  };

  return (
    <Text color={colors[status]} bold>
      {icon(status)} {status.toUpperCase()}
    </Text>
  );
};

/**
 * Status Card with gradient header
 */
export const StatusCard: React.FC<StatusCardProps> = ({
  title,
  status,
  message,
  details,
}) => {
  return (
    <Box flexDirection="column" borderStyle="round" borderColor="gray" padding={1}>
      <Box justifyContent="space-between" marginBottom={1}>
        <Gradient name="morning">
          <Text bold>{title}</Text>
        </Gradient>
      </Box>

      <Box marginBottom={1}>
        <StatusBadge status={status} />
      </Box>

      <Box borderStyle="single" borderColor="dim" paddingX={1} marginBottom={1}>
        <Text>{message}</Text>
      </Box>

      {details && Object.keys(details).length > 0 && (
        <Box flexDirection="row" flexWrap="wrap">
          {Object.entries(details).map(([key, value]) => (
            <Box key={key} marginRight={2}>
              <Text color="gray">{key}: </Text>
              <Text color="white">{value}</Text>
            </Box>
          ))}
        </Box>
      )}
    </Box>
  );
};

/**
 * Result Block with optional gradient border
 */
export const ResultBlock: React.FC<ResultBlockProps> = ({
  title,
  content,
  borderColor = 'cyan',
}) => {
  return (
    <Box flexDirection="column" borderStyle="round" borderColor={borderColor} padding={1}>
      <Box marginBottom={1}>
        <Gradient name="pastel">
          <Text bold underline>{title}</Text>
        </Gradient>
      </Box>
      <Text>{content}</Text>
    </Box>
  );
};

/**
 * Session Info component
 */
export const SessionInfo: React.FC<{
  task: string;
  duration: string;
  status: 'active' | 'paused' | 'completed';
}> = ({ task, duration, status }) => {
  const statusColors = { active: 'green', paused: 'yellow', completed: 'cyan' };

  return (
    <Box flexDirection="column" borderStyle="round" borderColor={statusColors[status]} padding={1}>
      <Box marginBottom={1}>
        <Gradient name="cristal">
          <Text bold>{Icon.workspace} DevLog Session</Text>
        </Gradient>
      </Box>
      <Box>
        <Text color="gray">Task: </Text>
        <Text color="white" bold>{task}</Text>
      </Box>
      <Box>
        <Text color="gray">Duration: </Text>
        <Text color="cyan">{duration}</Text>
      </Box>
      <Box>
        <Text color="gray">Status: </Text>
        <Text color={statusColors[status]} bold>{icon(status)} {status}</Text>
      </Box>
    </Box>
  );
};

/**
 * Task List component
 */
export const TaskList: React.FC<{
  title: string;
  tasks: Array<{ name: string; status: 'pending' | 'active' | 'completed' | 'paused' }>;
}> = ({ title, tasks }) => {
  const statusIcons = {
    pending: { icon: 'pending', color: 'gray' },
    active: { icon: 'active', color: 'yellow' },
    completed: { icon: 'completed', color: 'green' },
    paused: { icon: 'paused', color: 'cyan' },
  };

  return (
    <Box flexDirection="column" borderStyle="round" borderColor="gray" padding={1}>
      <Box marginBottom={1}>
        <Gradient name="teen">
          <Text bold>{Icon.task} {title}</Text>
        </Gradient>
      </Box>
      {tasks.map((task, idx) => {
        const s = statusIcons[task.status];
        return (
          <Box key={idx}>
            <Text color={s.color}>{icon(s.icon)} </Text>
            <Text color={task.status === 'completed' ? 'gray' : 'white'}>{task.name}</Text>
          </Box>
        );
      })}
    </Box>
  );
};

// ============================================================================
// HIGH-LEVEL RENDER FUNCTIONS
// ============================================================================

export function renderStatusCard(props: StatusCardProps): string {
  return renderInkToString(<StatusCard {...props} />);
}

export function renderResultBlock(props: ResultBlockProps): string {
  return renderInkToString(<ResultBlock {...props} />);
}

export function renderSessionInfo(task: string, duration: string, status: 'active' | 'paused' | 'completed'): string {
  return renderInkToString(<SessionInfo task={task} duration={duration} status={status} />);
}

export function renderTaskList(title: string, tasks: Array<{ name: string; status: 'pending' | 'active' | 'completed' | 'paused' }>): string {
  return renderInkToString(<TaskList title={title} tasks={tasks} />);
}

// ============================================================================
// SIMPLE BOX UTILITIES (Pure string, no React)
// ============================================================================

/**
 * Draw a simple ASCII box
 */
export function drawBox(
  lines: string[],
  style: BorderStyle = 'round',
  title?: string
): string {
  const chars = borderChars[style];
  const maxLen = Math.max(...lines.map(l => l.length), title?.length ?? 0);
  const width = maxLen + 4;

  const output: string[] = [];

  // Top border
  if (title) {
    const pad = width - title.length - 4;
    output.push(`${chars.tl}${chars.h} ${title} ${chars.h.repeat(pad)}${chars.tr}`);
  } else {
    output.push(`${chars.tl}${chars.h.repeat(width - 2)}${chars.tr}`);
  }

  // Content
  for (const line of lines) {
    const padded = line.padEnd(maxLen);
    output.push(`${chars.v} ${padded} ${chars.v}`);
  }

  // Bottom border
  output.push(`${chars.bl}${chars.h.repeat(width - 2)}${chars.br}`);

  return output.join('\n');
}

/**
 * Draw a gradient border box (pure string)
 */
export function renderGradientBox(
  content: string,
  title?: string,
  gradient: GradientPreset = 'cristal',
  width: number = 60
): string {
  const chars = borderChars.round;
  const innerWidth = width - 2;
  const gradFn = (gradientString as any)[gradient] || gradientString.cristal;

  const topBorder = title
    ? `${chars.tl}${chars.h} ${title} ${chars.h.repeat(Math.max(0, innerWidth - title.length - 3))}${chars.tr}`
    : `${chars.tl}${chars.h.repeat(innerWidth)}${chars.tr}`;
  const bottomBorder = `${chars.bl}${chars.h.repeat(innerWidth)}${chars.br}`;

  const contentLines = content.split('\n');
  const lines: string[] = [gradFn(topBorder)];

  for (const line of contentLines) {
    const paddedLine = line.padEnd(innerWidth - 2);
    lines.push(`${gradFn(chars.v)} ${paddedLine} ${gradFn(chars.v)}`);
  }

  lines.push(gradFn(bottomBorder));
  return lines.join('\n');
}

// ============================================================================
// ASCII FLOWCHARTS (Mermaid alternative for terminals)
// ============================================================================

export interface FlowNode {
  id: string;
  label: string;
  type?: 'start' | 'end' | 'process' | 'decision' | 'io';
}

export interface FlowEdge {
  from: string;
  to: string;
  label?: string;
}

function renderNodeBox(label: string, type: FlowNode['type'] = 'process'): string[] {
  const width = Math.max(label.length + 4, 10);
  const pad = (s: string, w: number) => {
    const left = Math.floor((w - s.length) / 2);
    const right = w - s.length - left;
    return ' '.repeat(left) + s + ' '.repeat(right);
  };

  switch (type) {
    case 'start':
    case 'end':
      return [
        '╭' + '─'.repeat(width) + '╮',
        '│' + pad(label, width) + '│',
        '╰' + '─'.repeat(width) + '╯',
      ];
    case 'decision':
      const half = Math.floor(width / 2);
      return [
        ' '.repeat(half) + '◇' + ' '.repeat(half),
        '◁' + pad(label, width) + '▷',
        ' '.repeat(half) + '◇' + ' '.repeat(half),
      ];
    case 'io':
      return [
        '╱' + '─'.repeat(width) + '╲',
        '│' + pad(label, width) + '│',
        '╲' + '─'.repeat(width) + '╱',
      ];
    default:
      return [
        '┌' + '─'.repeat(width) + '┐',
        '│' + pad(label, width) + '│',
        '└' + '─'.repeat(width) + '┘',
      ];
  }
}

/**
 * ASCII Flowchart component
 */
export const AsciiFlowchart: React.FC<{ nodes: FlowNode[]; edges: FlowEdge[]; title?: string }> = ({
  nodes,
  edges,
  title = 'Flowchart',
}) => {
  const nodeMap = new Map(nodes.map(n => [n.id, n]));
  const visited = new Set<string>();
  const orderedNodes: FlowNode[] = [];

  const startNode = nodes.find(n => n.type === 'start') || nodes[0];
  if (startNode) {
    let current: string | undefined = startNode.id;
    while (current && !visited.has(current)) {
      visited.add(current);
      const node = nodeMap.get(current);
      if (node) orderedNodes.push(node);
      const edge = edges.find(e => e.from === current);
      current = edge?.to;
    }
  }

  nodes.forEach(n => {
    if (!visited.has(n.id)) orderedNodes.push(n);
  });

  return (
    <Box flexDirection="column" borderStyle="round" borderColor="cyan" padding={1}>
      <Gradient name="cristal">
        <Text bold>{Icon.chart} {title}</Text>
      </Gradient>

      <Box marginTop={1} flexDirection="column">
        {orderedNodes.map((node, idx) => {
          const box = renderNodeBox(node.label, node.type);
          const edge = edges.find(e => e.from === node.id);
          const nodeColor = node.type === 'start' ? 'green' :
                           node.type === 'end' ? 'red' :
                           node.type === 'decision' ? 'yellow' : 'white';

          return (
            <Box key={node.id} flexDirection="column" alignItems="center">
              {box.map((line, i) => (
                <Text key={i} color={nodeColor}>{line}</Text>
              ))}
              {idx < orderedNodes.length - 1 && (
                <Box flexDirection="column" alignItems="center">
                  <Text color="cyan">│</Text>
                  {edge?.label && <Text color="gray">{edge.label}</Text>}
                  <Text color="cyan">▼</Text>
                </Box>
              )}
            </Box>
          );
        })}
      </Box>
    </Box>
  );
};

/**
 * Render ASCII flowchart to string
 */
export function renderAsciiFlowchart(nodes: FlowNode[], edges: FlowEdge[], title?: string): string {
  return renderInkToString(<AsciiFlowchart nodes={nodes} edges={edges} title={title} />);
}

/**
 * Quick flowchart from simple array of steps
 * @example renderQuickFlow(['Start', 'Process A', 'Decision?', 'End'])
 */
export function renderQuickFlow(steps: string[], title?: string): string {
  const nodes: FlowNode[] = steps.map((label, i) => ({
    id: `n${i}`,
    label,
    type: i === 0 ? 'start' : i === steps.length - 1 ? 'end' :
          label.includes('?') ? 'decision' : 'process',
  }));

  const edges: FlowEdge[] = steps.slice(0, -1).map((_, i) => ({
    from: `n${i}`,
    to: `n${i + 1}`,
  }));

  return renderAsciiFlowchart(nodes, edges, title);
}

// Re-export icon utilities
export { icon, Icon, hasNerdFontSupport } from './icons.js';
