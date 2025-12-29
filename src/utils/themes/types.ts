/**
 * Theme Types for DevLog MCP - React Ink Edition
 *
 * Provides type definitions for React Ink component theming.
 * Uses Ink's native styling (Box borderStyle, Text color props).
 */

// ============================================================================
// CORE TYPES
// ============================================================================

export type ThemeName = 'nebula' | 'cyberpunk' | 'minimal' | 'ocean';

// Ink gradient-string presets (from gradient-string package)
export type GradientPreset =
  | 'rainbow' | 'cristal' | 'teen' | 'mind' | 'morning'
  | 'vice' | 'passion' | 'fruit' | 'atlas' | 'retro';

// Ink Box borderStyle values
export type InkBorderStyle =
  | 'single' | 'double' | 'round' | 'bold'
  | 'singleDouble' | 'doubleSingle' | 'classic';

// ============================================================================
// THEME INTERFACE (React Ink compatible)
// ============================================================================

export interface Theme {
  name: ThemeName;
  description: string;

  // Semantic colors (hex strings for Ink Text/Box color props)
  colors: {
    primary: string;
    secondary: string;
    accent: string;
    success: string;
    warning: string;
    error: string;
    info: string;
    muted: string;
  };

  // Status colors (for StatusCard, badges)
  status: {
    success: { bg: string; fg: string };
    error: { bg: string; fg: string };
    warning: { bg: string; fg: string };
    info: { bg: string; fg: string };
    active: { bg: string; fg: string };
  };

  // Typography colors
  text: {
    heading: string;
    body: string;
    code: string;
    link: string;
    muted: string;
  };

  // Ink Box border styles
  borders: {
    default: InkBorderStyle;
    card: InkBorderStyle;
    code: InkBorderStyle;
    blockquote: InkBorderStyle;
  };

  // Border colors
  borderColors: {
    default: string;
    success: string;
    error: string;
    warning: string;
    info: string;
    muted: string;
  };

  // Bullets/icons for lists
  bullets: {
    level1: { char: string; color: string };
    level2: { char: string; color: string };
    level3: { char: string; color: string };
  };

  // Gradient presets for decorative elements
  gradients: {
    header: GradientPreset;
    divider: GradientPreset;
    accent: GradientPreset;
  };

  // Model badge styles (for multi-model tools)
  modelBadges: Record<string, ModelBadgeStyle>;
}

export interface ModelBadgeStyle {
  bg: string;      // Background color (hex)
  fg: string;      // Foreground color (hex)
  icon: string;    // Icon character
}

// ============================================================================
// COMPONENT PROPS (for React Ink components)
// ============================================================================

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

export interface SearchResultProps {
  file: string;
  title?: string;
  excerpt: string;
  relevance?: number;
  tags?: Record<string, unknown>;
  lastModified?: Date;
}

export interface TaskItemProps {
  content: string;
  status: 'pending' | 'in_progress' | 'completed';
  activeForm?: string;
}

export interface WorkspaceStatusProps {
  workspaceId: string;
  isLocked: boolean;
  lockedBy?: string;
  task?: string;
  sessionDuration?: string;
  entries?: number;
}

export interface SessionInfoProps {
  sessionId: string;
  startTime: Date;
  task: string;
  entriesCount: number;
  duration?: string;
}

// ============================================================================
// DATA VISUALIZATION PROPS
// ============================================================================

export interface ProgressBarProps {
  percent: number;
  width?: number;
  label?: string;
  showPercent?: boolean;
}

export interface SparklineProps {
  data: number[];
  label?: string;
  showMinMax?: boolean;
}

export interface TableProps {
  headers: string[];
  rows: string[][];
}

export interface TreeProps {
  items: Array<{ text: string; level?: number }>;
}

export interface DividerProps {
  style?: 'thin' | 'thick' | 'double' | 'gradient' | 'rainbow' | 'decorative';
  width?: number;
  decorativeStyle?: 'stars' | 'circuit' | 'waves' | 'diamonds' | 'arrows';
}

export interface BoxedSectionProps {
  title: string;
  content: string;
  style?: 'rounded' | 'sharp' | 'double' | 'bold';
}

export interface MetricsRowProps {
  model?: string;
  durationMs?: number;
  tokenCount?: number;
  costAmount?: number;
}

export interface ScoreProps {
  value: number;
  max?: number;
  label?: string;
  showImprovement?: { from: number };
}

// ============================================================================
// RENDERABLE RESULT TYPES (for tool output routing)
// ============================================================================

export type RenderableResult =
  | { type: 'status-card'; data: StatusCardProps }
  | { type: 'search-results'; data: SearchResultProps[] }
  | { type: 'task-list'; data: TaskItemProps[] }
  | { type: 'workspace-status'; data: WorkspaceStatusProps }
  | { type: 'session-info'; data: SessionInfoProps }
  | { type: 'result-block'; data: ResultBlockProps }
  | { type: 'markdown'; data: { content: string } }
  | { type: 'text'; data: { text: string } }
  | { type: 'error'; data: { message: string; details?: string } }
  // Data visualization
  | { type: 'progress-bar'; data: ProgressBarProps }
  | { type: 'sparkline'; data: SparklineProps }
  | { type: 'table'; data: TableProps }
  | { type: 'tree'; data: TreeProps }
  | { type: 'divider'; data: DividerProps }
  | { type: 'boxed-section'; data: BoxedSectionProps }
  | { type: 'metrics-row'; data: MetricsRowProps }
  | { type: 'score'; data: ScoreProps };

// ============================================================================
// JSON THEME INTERFACE (for external theme files)
// ============================================================================

export interface JsonTheme {
  name: string;
  description?: string;
  extends?: ThemeName;
  colors?: Partial<Theme['colors']>;
  status?: Partial<Theme['status']>;
  text?: Partial<Theme['text']>;
  borders?: Partial<Theme['borders']>;
  borderColors?: Partial<Theme['borderColors']>;
  bullets?: Partial<Theme['bullets']>;
  gradients?: Partial<Theme['gradients']>;
  modelBadges?: Record<string, Partial<ModelBadgeStyle>>;
}
