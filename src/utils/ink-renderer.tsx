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

// ============================================================================
// MODEL GRADIENTS
// ============================================================================

const modelGradients: Record<string, GradientPreset> = {
  gemini: 'cristal',
  grok: 'passion',
  openai: 'teen',
  perplexity: 'mind',
  claude: 'fruit',
  kimi: 'atlas',
  qwen: 'morning',
};

// ============================================================================
// WORKFLOW CASCADE
// ============================================================================

export interface WorkflowStep {
  name: string;
  model: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  duration?: number;
  output?: string;
}

export const WorkflowCascade: React.FC<{ steps: WorkflowStep[]; title?: string }> = ({
  steps,
  title = 'Workflow'
}) => {
  const getStatusIcon = (status: WorkflowStep['status']) => {
    const icons = { pending: '○', running: '◉', completed: '●', failed: '✗' };
    return icons[status];
  };

  const getStatusColor = (status: WorkflowStep['status']) => {
    const colors = { pending: 'gray', running: 'yellow', completed: 'green', failed: 'red' };
    return colors[status];
  };

  return (
    <Box flexDirection="column" borderStyle="round" borderColor="gray" padding={1}>
      <Gradient name="morning">
        <Text bold>◆ {title}</Text>
      </Gradient>
      <Box marginTop={1} flexDirection="column">
        {steps.map((step, idx) => (
          <Box key={idx} flexDirection="column">
            <Box>
              <Text color={getStatusColor(step.status)}>{getStatusIcon(step.status)} </Text>
              <Text color="white" bold>{step.name}</Text>
              <Text color="gray"> → </Text>
              <Gradient name={modelGradients[step.model.toLowerCase()] || 'rainbow' as any}>
                <Text>{step.model}</Text>
              </Gradient>
              {step.duration && <Text color="gray"> ({step.duration}ms)</Text>}
            </Box>
            {idx < steps.length - 1 && (
              <Box marginLeft={1}>
                <Text color="cyan">↓</Text>
              </Box>
            )}
          </Box>
        ))}
      </Box>
    </Box>
  );
};

export function renderWorkflowCascade(steps: WorkflowStep[], title?: string): string {
  return renderInkToString(<WorkflowCascade steps={steps} title={title} />);
}

// ============================================================================
// MODEL CHORUS
// ============================================================================

export interface ModelResponse {
  model: string;
  response: string;
  confidence?: number;
  tokens?: number;
}

export const ModelChorus: React.FC<{ responses: ModelResponse[]; title?: string }> = ({
  responses,
  title = 'Model Chorus'
}) => {
  return (
    <Box flexDirection="column" borderStyle="round" borderColor="gray" padding={1}>
      <Gradient name="vice">
        <Text bold>♫ {title}</Text>
      </Gradient>
      <Box marginTop={1} flexDirection="column">
        {responses.map((r, idx) => (
          <Box key={idx} flexDirection="column" marginBottom={1}>
            <Box>
              <Gradient name={modelGradients[r.model.toLowerCase()] || 'rainbow' as any}>
                <Text bold> {r.model.toUpperCase()} </Text>
              </Gradient>
              {r.confidence !== undefined && (
                <Text color="gray"> [{Math.round(r.confidence * 100)}% conf]</Text>
              )}
              {r.tokens && <Text color="gray"> {r.tokens} tok</Text>}
            </Box>
            <Box borderStyle="single" borderColor="dim" paddingX={1} marginTop={0}>
              <Text wrap="wrap">{r.response.slice(0, 200)}{r.response.length > 200 ? '...' : ''}</Text>
            </Box>
          </Box>
        ))}
      </Box>
    </Box>
  );
};

export function renderModelChorus(responses: ModelResponse[], title?: string): string {
  return renderInkToString(<ModelChorus responses={responses} title={title} />);
}

// ============================================================================
// PROGRESS REEL
// ============================================================================

export interface ProgressPhase {
  name: string;
  status: 'pending' | 'active' | 'completed';
  elapsed?: number;
}

export const ProgressReel: React.FC<{ phases: ProgressPhase[]; title?: string }> = ({
  phases,
  title = 'Progress'
}) => {
  const phaseColors: Record<string, string> = {
    pending: 'gray',
    active: 'yellow',
    completed: 'green',
  };

  return (
    <Box flexDirection="column">
      {title && (
        <Gradient name="teen">
          <Text bold>{title}</Text>
        </Gradient>
      )}
      <Box marginTop={1} flexDirection="row">
        {phases.map((phase, idx) => (
          <Box key={idx} flexDirection="row">
            <Box
              borderStyle="round"
              borderColor={phaseColors[phase.status]}
              paddingX={1}
            >
              <Text color={phaseColors[phase.status]} bold={phase.status === 'active'}>
                {phase.name}
              </Text>
              {phase.elapsed && (
                <Text color="gray"> {phase.elapsed}ms</Text>
              )}
            </Box>
            {idx < phases.length - 1 && (
              <Text color="cyan"> → </Text>
            )}
          </Box>
        ))}
      </Box>
    </Box>
  );
};

export function renderProgressReel(phases: ProgressPhase[], title?: string): string {
  return renderInkToString(<ProgressReel phases={phases} title={title} />);
}

// ============================================================================
// SPARKLINES GRID
// ============================================================================

export interface SparklineData {
  label: string;
  values: number[];
  unit?: string;
}

function asciiSparkline(values: number[], width: number = 20): string {
  if (values.length === 0) return '─'.repeat(width);

  const chars = '▁▂▃▄▅▆▇█';
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;

  const step = values.length / width;
  const result: string[] = [];

  for (let i = 0; i < width; i++) {
    const idx = Math.floor(i * step);
    const val = values[Math.min(idx, values.length - 1)];
    const normalized = (val - min) / range;
    const charIdx = Math.floor(normalized * (chars.length - 1));
    result.push(chars[charIdx]);
  }

  return result.join('');
}

export const SparklinesGrid: React.FC<{ data: SparklineData[]; title?: string }> = ({
  data,
  title = 'Metrics'
}) => {
  return (
    <Box flexDirection="column" borderStyle="round" borderColor="gray" padding={1}>
      <Gradient name="cristal">
        <Text bold>{Icon.chart} {title}</Text>
      </Gradient>
      <Box marginTop={1} flexDirection="column">
        {data.map((d, idx) => {
          const latest = d.values[d.values.length - 1];
          const trend = d.values.length > 1
            ? (latest > d.values[d.values.length - 2] ? '↑' : latest < d.values[d.values.length - 2] ? '↓' : '→')
            : '→';
          const trendColor = trend === '↑' ? 'green' : trend === '↓' ? 'red' : 'gray';

          return (
            <Box key={idx} marginBottom={idx < data.length - 1 ? 1 : 0}>
              <Text color="gray">{d.label.padEnd(12)}</Text>
              <Text color="cyan">{asciiSparkline(d.values, 15)}</Text>
              <Text color={trendColor}> {trend}</Text>
              <Text color="white"> {latest?.toFixed(1)}</Text>
              {d.unit && <Text color="gray">{d.unit}</Text>}
            </Box>
          );
        })}
      </Box>
    </Box>
  );
};

export function renderSparklinesGrid(data: SparklineData[], title?: string): string {
  return renderInkToString(<SparklinesGrid data={data} title={title} />);
}

// ============================================================================
// THINKING CHAIN ARBOR
// ============================================================================

export interface ThinkingStep {
  thought: string;
  model?: string;
  isRevision?: boolean;
  isBranch?: boolean;
}

export const ThinkingChainArbor: React.FC<{ steps: ThinkingStep[]; title?: string }> = ({
  steps,
  title = 'Thinking Chain'
}) => {
  return (
    <Box flexDirection="column" borderStyle="round" borderColor="gray" padding={1}>
      <Gradient name="fruit">
        <Text bold>🌳 {title}</Text>
      </Gradient>
      <Box marginTop={1} flexDirection="column">
        {steps.map((step, idx) => {
          const prefix = step.isBranch ? '├─⎇' : step.isRevision ? '├─↺' : '├──';
          const prefixColor = step.isBranch ? 'yellow' : step.isRevision ? 'magenta' : 'cyan';

          return (
            <Box key={idx} flexDirection="column">
              <Box>
                <Text color={prefixColor}>{idx === steps.length - 1 ? prefix.replace('├', '└') : prefix} </Text>
                <Text color="white">{step.thought.slice(0, 60)}{step.thought.length > 60 ? '...' : ''}</Text>
              </Box>
              {step.model && (
                <Box marginLeft={4}>
                  <Gradient name={modelGradients[step.model.toLowerCase()] || 'rainbow' as any}>
                    <Text dimColor>[{step.model}]</Text>
                  </Gradient>
                </Box>
              )}
            </Box>
          );
        })}
      </Box>
    </Box>
  );
};

export function renderThinkingChainArbor(steps: ThinkingStep[], title?: string): string {
  return renderInkToString(<ThinkingChainArbor steps={steps} title={title} />);
}

// ============================================================================
// FOCUS SESSION HORIZON
// ============================================================================

export interface FocusSessionSummary {
  objective: string;
  models: string[];
  rounds: number;
  totalTokens: number;
  totalDuration: number;
  status: 'running' | 'completed' | 'failed';
}

export const FocusSessionHorizon: React.FC<FocusSessionSummary> = (session) => {
  const statusColors = { running: 'yellow', completed: 'green', failed: 'red' };
  const statusIcons = { running: '◉', completed: '✓', failed: '✗' };

  return (
    <Box flexDirection="column" borderStyle="double" borderColor={statusColors[session.status]} padding={1}>
      <Box marginBottom={1}>
        <Gradient name="morning">
          <Text bold>{'▁▂▃▄▅▆▇█'.repeat(8)}</Text>
        </Gradient>
      </Box>

      <Box justifyContent="space-between">
        <Box>
          <Text color={statusColors[session.status]} bold>
            {statusIcons[session.status]} {session.status.toUpperCase()}
          </Text>
        </Box>
        <Box>
          <Text color="gray">Rounds: </Text>
          <Text color="cyan">{session.rounds}</Text>
        </Box>
      </Box>

      <Box marginTop={1}>
        <Text color="white" bold wrap="wrap">{session.objective}</Text>
      </Box>

      <Box marginTop={1} flexDirection="row" flexWrap="wrap">
        {session.models.map((model, idx) => (
          <Box key={idx} marginRight={1}>
            <Gradient name={modelGradients[model.toLowerCase()] || 'rainbow' as any}>
              <Text>{model}</Text>
            </Gradient>
          </Box>
        ))}
      </Box>

      <Box marginTop={1} justifyContent="space-between">
        <Text color="gray">{session.totalTokens} tokens</Text>
        <Text color="gray">{(session.totalDuration / 1000).toFixed(1)}s</Text>
      </Box>
    </Box>
  );
};

export function renderFocusSessionHorizon(session: FocusSessionSummary): string {
  return renderInkToString(<FocusSessionHorizon {...session} />);
}

// ============================================================================
// RECEIPT PRINTER
// ============================================================================

export interface ReceiptData {
  model: string;
  inputTokens: number;
  outputTokens: number;
  cachedTokens?: number;
  inputCostPer1k?: number;
  outputCostPer1k?: number;
  duration?: number;
}

export const ReceiptPrinter: React.FC<ReceiptData> = ({
  model,
  inputTokens,
  outputTokens,
  cachedTokens = 0,
  inputCostPer1k = 0.001,
  outputCostPer1k = 0.002,
  duration,
}) => {
  const inputCost = (inputTokens / 1000) * inputCostPer1k;
  const outputCost = (outputTokens / 1000) * outputCostPer1k;
  const cachedSavings = (cachedTokens / 1000) * inputCostPer1k * 0.9;
  const totalCost = inputCost + outputCost - cachedSavings;

  const formatCost = (n: number) => `$${n.toFixed(4)}`;
  const formatNum = (n: number) => n.toLocaleString();

  return (
    <Box flexDirection="column" borderStyle="single" borderColor="gray" paddingX={2} paddingY={1}>
      <Box justifyContent="center">
        <Text bold>═══ COMPUTE RECEIPT ═══</Text>
      </Box>

      <Box justifyContent="center" marginTop={1}>
        <Gradient name={modelGradients[model.toLowerCase()] || 'rainbow' as any}>
          <Text>{model.toUpperCase()}</Text>
        </Gradient>
      </Box>

      <Text color="gray">{'─'.repeat(28)}</Text>

      <Box justifyContent="space-between">
        <Text>Input ({formatNum(inputTokens)} tok)</Text>
        <Text>{formatCost(inputCost)}</Text>
      </Box>

      <Box justifyContent="space-between">
        <Text>Output ({formatNum(outputTokens)} tok)</Text>
        <Text>{formatCost(outputCost)}</Text>
      </Box>

      {cachedTokens > 0 && (
        <Box justifyContent="space-between">
          <Text color="green">{Icon.success} Cached ({formatNum(cachedTokens)})</Text>
          <Text color="green">-{formatCost(cachedSavings)}</Text>
        </Box>
      )}

      <Text color="gray">{'─'.repeat(28)}</Text>

      <Box justifyContent="space-between">
        <Text bold>TOTAL</Text>
        <Text bold color={totalCost > 0.01 ? 'yellow' : 'green'}>
          {formatCost(totalCost)}
        </Text>
      </Box>

      {duration && (
        <Box justifyContent="center" marginTop={1}>
          <Text color="gray">{Icon.clock} {(duration / 1000).toFixed(2)}s</Text>
        </Box>
      )}

      <Box justifyContent="center" marginTop={1}>
        <Text dimColor>devlog-mcp</Text>
      </Box>
    </Box>
  );
};

export function renderReceipt(data: ReceiptData): string {
  return renderInkToString(<ReceiptPrinter {...data} />);
}

// ============================================================================
// WATERFALL TRACE
// ============================================================================

export interface WaterfallStep {
  name: string;
  startOffset: number;
  duration: number;
  status: 'success' | 'error' | 'running';
}

export const WaterfallTrace: React.FC<{ steps: WaterfallStep[]; title?: string; totalWidth?: number }> = ({
  steps,
  title = 'Execution Trace',
  totalWidth = 40,
}) => {
  if (steps.length === 0) return null;

  const maxEnd = Math.max(...steps.map(s => s.startOffset + s.duration));
  const scale = totalWidth / maxEnd;

  const statusColors: Record<string, string> = {
    success: 'green',
    error: 'red',
    running: 'yellow',
  };

  return (
    <Box flexDirection="column" borderStyle="round" borderColor="gray" padding={1}>
      <Gradient name="teen">
        <Text bold>{Icon.chart} {title}</Text>
      </Gradient>

      <Box marginTop={1} flexDirection="column">
        {steps.map((step, idx) => {
          const offset = Math.floor(step.startOffset * scale);
          const width = Math.max(1, Math.floor(step.duration * scale));
          const bar = '═'.repeat(width);

          return (
            <Box key={idx}>
              <Text color="gray">{step.name.padEnd(12).slice(0, 12)} </Text>
              <Text>{' '.repeat(offset)}</Text>
              <Text color={statusColors[step.status]}>{bar}</Text>
              <Text color="gray"> {step.duration}ms</Text>
            </Box>
          );
        })}
      </Box>

      <Box marginTop={1}>
        <Text color="gray">{'─'.repeat(12)} </Text>
        <Text color="gray">0</Text>
        <Text color="gray">{' '.repeat(Math.floor(totalWidth / 2) - 2)}</Text>
        <Text color="gray">{Math.floor(maxEnd / 2)}ms</Text>
        <Text color="gray">{' '.repeat(Math.floor(totalWidth / 2) - 4)}</Text>
        <Text color="gray">{maxEnd}ms</Text>
      </Box>
    </Box>
  );
};

export function renderWaterfallTrace(steps: WaterfallStep[], title?: string): string {
  return renderInkToString(<WaterfallTrace steps={steps} title={title} />);
}

// ============================================================================
// ERROR AUTOPSY
// ============================================================================

export interface ErrorDetails {
  type: string;
  message: string;
  model?: string;
  suggestion?: string;
  culprit?: string;
}

export const ErrorAutopsy: React.FC<ErrorDetails> = ({
  type,
  message,
  model,
  suggestion,
  culprit,
}) => {
  return (
    <Box flexDirection="column" borderStyle="round" borderColor="red" padding={1}>
      <Box>
        <Text backgroundColor="red" color="white" bold> {Icon.error} {type} </Text>
        {model && (
          <Text color="gray"> [{model}]</Text>
        )}
      </Box>

      <Box marginTop={1}>
        <Text color="yellow">{message}</Text>
      </Box>

      {culprit && (
        <Box marginTop={1} flexDirection="column">
          <Text color="gray">Culprit:</Text>
          <Box borderStyle="single" borderColor="red" paddingX={1}>
            <Text color="red">{culprit}</Text>
          </Box>
        </Box>
      )}

      {suggestion && (
        <Box marginTop={1}>
          <Text color="green">{Icon.sparkle} {suggestion}</Text>
        </Box>
      )}
    </Box>
  );
};

export function renderErrorAutopsy(error: ErrorDetails): string {
  return renderInkToString(<ErrorAutopsy {...error} />);
}

// ============================================================================
// SOURCE HEATMAP (for RAG)
// ============================================================================

export interface SourceCitation {
  title: string;
  url?: string;
  relevance: number;
  snippet?: string;
}

export const SourceHeatmap: React.FC<{ sources: SourceCitation[]; title?: string }> = ({
  sources,
  title = 'Sources',
}) => {
  const getRelevanceBar = (relevance: number) => {
    const filled = Math.round(relevance * 10);
    return '█'.repeat(filled) + '░'.repeat(10 - filled);
  };

  const getRelevanceColor = (relevance: number) => {
    if (relevance >= 0.8) return 'green';
    if (relevance >= 0.5) return 'yellow';
    return 'gray';
  };

  return (
    <Box flexDirection="column" borderStyle="round" borderColor="cyan" padding={1}>
      <Gradient name="cristal">
        <Text bold>{Icon.search} {title}</Text>
      </Gradient>

      <Box marginTop={1} flexDirection="column">
        {sources.map((source, idx) => (
          <Box key={idx} flexDirection="column" marginBottom={idx < sources.length - 1 ? 1 : 0}>
            <Box>
              <Text color={getRelevanceColor(source.relevance)}>
                {getRelevanceBar(source.relevance)}
              </Text>
              <Text color="gray"> {Math.round(source.relevance * 100)}%</Text>
            </Box>
            <Box>
              <Text color="white" bold>{source.title}</Text>
            </Box>
            {source.url && (
              <Text color="blue" dimColor>{source.url}</Text>
            )}
            {source.snippet && (
              <Text color="gray" wrap="wrap">"{source.snippet.slice(0, 80)}..."</Text>
            )}
          </Box>
        ))}
      </Box>
    </Box>
  );
};

export function renderSourceHeatmap(sources: SourceCitation[], title?: string): string {
  return renderInkToString(<SourceHeatmap sources={sources} title={title} />);
}

// Re-export icon utilities
export { icon, Icon, hasNerdFontSupport } from './icons.js';
