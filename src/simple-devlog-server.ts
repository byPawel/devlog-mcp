#!/usr/bin/env node
import { z } from 'zod';
import { promises as fs } from 'fs';
import path from 'path';
import { globSync } from 'glob';
import matter from 'gray-matter';
import { McpServer } from './server/mcp.js';
import { StdioServerTransport } from './server/stdio.js';
import { CallToolResult } from './types.js';
import { 
  generateActivityMatrix,
  calculateActiveHours,
  generateActiveHoursVisualization,
  generateActivityClock,
  generateTaskDistribution,
  generateConceptualDiagrams,
  generateCompressedFilename
} from './tools/compression-enhancements.js';
import { 
  generateAllCompressionDiagrams,
  CompressionVisualData
} from './tools/mermaid-compression-enhancement.js';
import { workspaceTools } from './tools/workspace-tools.js';
import { taskTrackingTools } from './tools/task-tracking-tools.js';
import { issueTrackingTools } from './tools/issue-tracking-tools.js';
import { featureTrackingTools } from './tools/feature-tracking-tools.js';
import { weeklyIntegrationTools } from './tools/weekly-integration-tools.js';
import { backupRecoveryTools } from './tools/backup-recovery-tools.js';
import { withToolTracking } from './utils/tool-tracker.js';

// Get devlog path from environment or use default
import { DEVLOG_PATH } from './shared/devlog-utils.js';

// Type definitions for productivity metrics
interface ProductivityMetrics {
  totalFiles: number;
  newFiles: number;
  updatedFiles: number;
  featuresCompleted: number;
  decisionsLogged: number;
  bugsFixed: number;
  dailySessions: number;
  avgSessionLength: number;
  mostActiveDay: string;
  productivity: 'HIGH' | 'MEDIUM' | 'LOW';
}

interface TimelineEvent {
  type: 'FEATURE' | 'DECISION' | 'POST' | 'MILESTONE';
  title: string;
  date: string;
  description?: string;
  file?: string;
  impact?: 'HIGH' | 'MEDIUM' | 'LOW';
}

interface VelocityData {
  metrics: ProductivityMetrics;
  period: string;
  startDate: string;
  endDate: string;
  recommendations: string[];
}

interface TimelineData {
  events: TimelineEvent[];
}

interface SessionData {
  file: string;
  date: Date;
  content: string;
  frontmatter: {
    tags?: {
      scope?: string | string[];
      [key: string]: unknown;
    };
    [key: string]: unknown;
  };
  completedTasks: string[];
  decisions: string[];
  insights: string[];
  summary: string;
  [key: string]: unknown;
}

interface TestCategories {
  unit: string[];
  integration: string[];
  e2e: string[];
  regression: string[];
  performance: string[];
  security: string[];
}

interface ResearchItem {
  source: string;
  content: string;
  findings: string[];
}

interface CodebaseAnalysis {
  checklist: string[];
  conflicts: {component: string; reason: string}[];
  components: string[];
  testScenarios: string[];
}


// interface VelocityData {
//   metrics: ProductivityMetrics;
//   period: string;
//   startDate: string;
//   endDate: string;
//   recommendations: string[];
// }

// interface TimelineData {
//   events: TimelineEvent[];
// }

// Filename generation helpers
// interface FilenameOptions {
//   type: 'session' | 'feature' | 'decision' | 'research' | 'analysis' | 'bugfix';
//   topic?: string;
//   date?: Date;
// }

// function generateDescriptiveFilename(options: FilenameOptions): string {
//   const now = options.date || new Date();
//   
//   // Date components
//   const year = now.getFullYear();
//   const month = String(now.getMonth() + 1).padStart(2, '0');
//   const day = String(now.getDate()).padStart(2, '0');
//   const hour = String(now.getHours()).padStart(2, '0');
//   const minute = String(now.getMinutes()).padStart(2, '0');
//   
//   // Day of week
//   const dayName = now.toLocaleDateString('en-US', { weekday: 'long' }).toLowerCase();
//   
//   // Build filename parts
//   const parts = [
//     `${year}-${month}-${day}`,
//     `${hour}h${minute}`,
//     dayName,
//     options.type
//   ];
//   
//   // Add topic if provided
//   if (options.topic) {
//     // Sanitize topic for filename
//     const sanitizedTopic = options.topic
//       .toLowerCase()
//       .replace(/[^a-z0-9]+/g, '-')
//       .replace(/^-+|-+$/g, '')
//       .substring(0, 50); // Limit length
//     
//     if (sanitizedTopic) {
//       parts.push(sanitizedTopic);
//     }
//   }
//   
//   return parts.join('-') + '.md';
// }
// 

// Helper functions for session dumps
// function detectScopes(content: string): string {
//   const scopes = new Set<string>();
//   const lowerContent = content.toLowerCase();
//   
//   if (lowerContent.includes('feature') || lowerContent.includes('implement')) {
//     scopes.add('feature');
//   }
//   if (lowerContent.includes('bug') || lowerContent.includes('fix')) {
//     scopes.add('bugfix');
//   }
//   if (lowerContent.includes('research') || lowerContent.includes('investigate')) {
//     scopes.add('research');
//   }
//   if (lowerContent.includes('refactor') || lowerContent.includes('cleanup')) {
//     scopes.add('refactoring');
//   }
//   if (lowerContent.includes('test') || lowerContent.includes('testing')) {
//     scopes.add('testing');
//   }
//   if (lowerContent.includes('document') || lowerContent.includes('docs')) {
//     scopes.add('documentation');
//   }
//   
//   return Array.from(scopes).join(', ') || 'general';
// }
// 
// function extractSessionSummary(content: string): string {
//   const lines = content.split('\n');
//   const completedItems: string[] = [];
//   const inProgressItems: string[] = [];
//   
//   for (const line of lines) {
//     if (line.includes('- [x]')) {
//       completedItems.push(line.replace(/- \[x\]\s*/, '').trim());
//     } else if (line.includes('✅')) {
//       completedItems.push(line.replace(/.*✅\s*/, '').trim());
//     } else if (line.includes('- [ ]') && !line.includes('Queue for later') && !line.includes('New task')) {
//       inProgressItems.push(line.replace(/- \[ \]\s*/, '').trim());
//     }
//   }
//   
//   let summary = '';
//   
//   if (completedItems.length > 0) {
//     summary += `### Completed\n${completedItems.map(item => `- ✅ ${item}`).join('\n')}\n\n`;
//   }
//   
//   if (inProgressItems.length > 0) {
//     summary += `### In Progress\n${inProgressItems.slice(0, 5).map(item => `- 🚧 ${item}`).join('\n')}`;
//     if (inProgressItems.length > 5) {
//       summary += `\n- ... and ${inProgressItems.length - 5} more items`;
//     }
//   }
//   
//   return summary || 'No specific tasks tracked in this session.';
// }
// 
// Agent management utilities
// async function generateAgentId(): Promise<string> {
//   const now = new Date();
//   
//   // High-precision timestamp (seconds-level)
//   const timestamp = now.toISOString()
//     .slice(2, 19)           // YY-MM-DDTHH:MM:SS
//     .replace(/[-:T]/g, '')  // YYMMDDHHMMSS
//     .slice(0, 10);          // YYMMDDHHMM (keep 10 chars for readability)
//   
//   // Add seconds for precision
//   const seconds = now.getSeconds().toString().padStart(2, '0');
//   let agentId = `agent-${timestamp}${seconds}`;
//   
//   // Collision detection and auto-increment
//   const workspace = await getCurrentWorkspace();
//   if (workspace.exists && workspace.content) {
//     const { agentId: currentAgent } = parseAgentFromContent(workspace.content);
//     
//     if (currentAgent && currentAgent.startsWith(agentId)) {
//       // Extract counter from existing agent ID (e.g., agent-250622025145-2 → 2)
//       const match = currentAgent.match(/agent-(\d{12})-?(\d+)?$/);
//       const counter = match?.[2] ? parseInt(match[2]) + 1 : 2;
//       agentId = `${agentId}-${counter}`;
//     }
//   }
//   
//   return agentId;
// }
// 


// function calculateSessionDuration(sessionStart: string | null, sessionEnd: Date): { 
//   durationMinutes: number, 
//   durationHours: number, 
//   formattedDuration: string 
// } {
//   if (!sessionStart) {
//     return { 
//       durationMinutes: 0, 
//       durationHours: 0, 
//       formattedDuration: 'Unknown duration (session start not tracked)' 
//     };
//   }
//   
//   try {
//     const startTime = new Date(sessionStart);
//     const durationMs = sessionEnd.getTime() - startTime.getTime();
//     const durationMinutes = Math.round(durationMs / (1000 * 60));
//     const durationHours = Math.round((durationMs / (1000 * 60 * 60)) * 100) / 100; // Round to 2 decimal places
//     
//     // Format duration nicely
//     const hours = Math.floor(durationMinutes / 60);
//     const minutes = durationMinutes % 60;
//     
//     let formattedDuration = '';
//     if (hours > 0) {
//       formattedDuration += `${hours}h`;
//     }
//     if (minutes > 0) {
//       if (hours > 0) formattedDuration += ' ';
//       formattedDuration += `${minutes}m`;
//     }
//     if (formattedDuration === '') {
//       formattedDuration = '< 1m';
//     }
//     
//     return { durationMinutes, durationHours, formattedDuration };
//   } catch {
//     return { 
//       durationMinutes: 0, 
//       durationHours: 0, 
//       formattedDuration: 'Invalid session start time' 
//     };
//   }
// }
// 
// Check if devlog exists
async function isDevlogInitialized(): Promise<boolean> {
  try {
    await fs.access(DEVLOG_PATH);
    const stats = await fs.stat(DEVLOG_PATH);
    return stats.isDirectory();
  } catch {
    return false;
  }
}

// Initialize the MCP server
const server = new McpServer({
  name: 'mcp-devlog',
  vendor: 'turbowizard',
  version: '3.0.0',
  description: 'DevLog MCP server for development insights'
}, {
  capabilities: {
    tools: {},
  },
});

// Helper to read devlog files
async function readDevlogFile(filePath: string) {
  try {
    return await fs.readFile(filePath, 'utf-8');
  } catch (error) {
    console.error(`Error reading file ${filePath}:`, error);
    return null;
  }
}

// Helper to parse frontmatter and extract tags
interface ParsedDevlog {
  content: string;
  data: Record<string, unknown>;
  tags: Record<string, unknown>;
  title?: string;
  date?: string;
}

function parseDevlogContent(content: string): ParsedDevlog {
  const parsed = matter(content);
  
  // Extract tags - handle both object and array formats
  let tags: Record<string, unknown> = {};
  if (parsed.data.tags) {
    if (typeof parsed.data.tags === 'object' && !Array.isArray(parsed.data.tags)) {
      tags = parsed.data.tags;
    } else if (Array.isArray(parsed.data.tags)) {
      tags = { tags: parsed.data.tags };
    }
  }
  
  return {
    content: parsed.content,
    data: parsed.data,
    tags,
    title: parsed.data.title,
    date: parsed.data.date
  };
}

// Helper to search devlog entries
async function searchDevlogs(query: string, type: string = 'all', tagFilters?: Record<string, unknown>) {
  const patterns: Record<string, string> = {
    posts: 'posts/**/*.md',
    ideas: 'ideas-to-verify/**/*.md',
    features: 'features_plan/**/*.md',
    insights: 'insights/**/*.md',
    decisions: 'decisions/**/*.md',
    daily: 'daily/**/*.md',
    current: 'current.md',
    all: '**/*.md',
  };
  
  const pattern = patterns[type] || patterns.all;
  const files = globSync(pattern, { cwd: DEVLOG_PATH });
  
  const results = [];
  for (const file of files) {
    const content = await readDevlogFile(path.join(DEVLOG_PATH, file));
    if (!content) continue;
    
    const parsed = parseDevlogContent(content);
    
    // Check text content match
    const contentMatch = !query || 
      parsed.content.toLowerCase().includes(query.toLowerCase()) ||
      (parsed.title && parsed.title.toLowerCase().includes(query.toLowerCase()));
    
    // Check tag filters
    let tagMatch = true;
    if (tagFilters && Object.keys(tagFilters).length > 0) {
      for (const [tagKey, tagValue] of Object.entries(tagFilters)) {
        if (!parsed.tags[tagKey]) {
          tagMatch = false;
          break;
        }
        
        // Handle array values
        const tagKeyValue = parsed.tags[tagKey];
        if (Array.isArray(tagKeyValue)) {
          if (Array.isArray(tagValue)) {
            tagMatch = tagValue.some(v => tagKeyValue.includes(v));
          } else {
            tagMatch = tagKeyValue.includes(tagValue);
          }
        } else if (typeof tagKeyValue === 'string') {
          if (Array.isArray(tagValue)) {
            tagMatch = tagValue.includes(tagKeyValue);
          } else {
            tagMatch = tagKeyValue.includes(tagValue as string);
          }
        } else {
          tagMatch = tagKeyValue === tagValue;
        }
        
        if (!tagMatch) break;
      }
    }
    
    if (contentMatch && tagMatch) {
      results.push({
        file,
        excerpt: parsed.content.substring(0, 200) + '...',
        lastModified: (await fs.stat(path.join(DEVLOG_PATH, file))).mtime,
        fullContent: content,
        parsedContent: parsed.content,
        title: parsed.title,
        date: parsed.date,
        tags: parsed.tags,
        frontmatter: parsed.data
      });
    }
  }
  
  return results.sort((a, b) => b.lastModified.getTime() - a.lastModified.getTime());
}

// Conflict detection logic
async function detectConflicts(featureName: string) {
  // Keywords that indicate potential conflicts
  const conflictKeywords = [
    'keybinding', 'shortcut', 'hotkey',
    'state management', 'redux', 'store',
    'authentication', 'auth', 'login',
    'routing', 'navigation', 'router',
    'styling', 'css', 'theme',
    'api', 'endpoint', 'request',
    'database', 'schema', 'migration',
    'component', 'hook', 'context'
  ];
  
  const results = await searchDevlogs(featureName, 'all');
  const conflicts = [];
  
  for (const result of results) {
    const content = result.fullContent?.toLowerCase() || '';
    
    // Check for conflict indicators
    const conflictScore = conflictKeywords.reduce((score, keyword) => {
      if (content.includes(keyword) && content.includes(featureName.toLowerCase())) {
        return score + 1;
      }
      return score;
    }, 0);
    
    // Check for known conflict patterns
    const hasBreakingChanges = content.includes('breaking') || content.includes('broke') || content.includes('conflict');
    const hasRegression = content.includes('regression') || content.includes('reverted') || content.includes('rollback');
    
    if (conflictScore > 0 || hasBreakingChanges || hasRegression) {
      let riskLevel = 'LOW';
      if (conflictScore > 2 || hasBreakingChanges) riskLevel = 'MEDIUM';
      if (conflictScore > 4 || hasRegression) riskLevel = 'HIGH';
      
      conflicts.push({
        file: result.file,
        riskLevel,
        conflictScore,
        hasBreakingChanges,
        hasRegression,
        excerpt: result.excerpt,
        lastModified: result.lastModified,
      });
    }
  }
  
  return conflicts.sort((a, b) => {
    const riskOrder = { HIGH: 3, MEDIUM: 2, LOW: 1 };
    return riskOrder[b.riskLevel as keyof typeof riskOrder] - riskOrder[a.riskLevel as keyof typeof riskOrder];
  });
}

// Check for duplicate work
async function checkDuplicateWork(description: string) {
  const results = await searchDevlogs(description, 'all');
  const duplicates = [];
  
  for (const result of results) {
    const content = result.fullContent?.toLowerCase() || '';
    
    // Calculate similarity score (basic implementation)
    const descWords = description.toLowerCase().split(' ');
    const matchingWords = descWords.filter(word => 
      word.length > 3 && content.includes(word)
    );
    
    const similarityScore = Math.round((matchingWords.length / descWords.length) * 100);
    
    if (similarityScore > 60) {
      const status = content.includes('completed') || content.includes('implemented') ? 'COMPLETED' : 
                   content.includes('in progress') || content.includes('working on') ? 'IN_PROGRESS' : 'UNKNOWN';
      
      duplicates.push({
        file: result.file,
        similarityScore,
        status,
        excerpt: result.excerpt,
        lastModified: result.lastModified,
      });
    }
  }
  
  return duplicates.sort((a, b) => b.similarityScore - a.similarityScore);
}

// Get feature status from devlog
async function getFeatureStatus(featureName: string) {
  // Check feature status files first
  const featureStatusPath = path.join(DEVLOG_PATH, 'features', featureName.toLowerCase().replace(/\s+/g, '-'), 'status.md');
  
  try {
    const statusContent = await readDevlogFile(featureStatusPath);
    if (statusContent) {
      const statusMatch = statusContent.match(/\*\*Status\*\*:\s*(.+)/);
      const versionMatch = statusContent.match(/\*\*Version\*\*:\s*(.+)/);
      const dateMatch = statusContent.match(/\*\*Implementation Date\*\*:\s*(.+)/);
      
      return {
        feature: featureName,
        status: statusMatch?.[1]?.trim() || 'UNKNOWN',
        version: versionMatch?.[1]?.trim() || 'N/A',
        implementationDate: dateMatch?.[1]?.trim() || 'N/A',
        statusFile: featureStatusPath,
        excerpt: statusContent.substring(0, 300) + '...',
      };
    }
  } catch {
    // Status file doesn't exist, search in general devlogs
  }
  
  const results = await searchDevlogs(featureName, 'all');
  if (results.length === 0) {
    return {
      feature: featureName,
      status: 'NOT_FOUND',
      version: 'N/A',
      implementationDate: 'N/A',
      statusFile: null,
      excerpt: 'No references found in devlogs',
    };
  }
  
  // Analyze the most recent entries
  const recentEntry = results[0];
  const content = recentEntry.fullContent?.toLowerCase() || '';
  
  let status = 'IN_PROGRESS';
  if (content.includes('completed') || content.includes('implemented') || content.includes('✅')) {
    status = 'COMPLETED';
  } else if (content.includes('planning') || content.includes('proposed')) {
    status = 'PLANNING';  
  } else if (content.includes('blocked') || content.includes('issue')) {
    status = 'BLOCKED';
  }
  
  return {
    feature: featureName,
    status,
    version: 'N/A',
    implementationDate: recentEntry.lastModified.toISOString().split('T')[0],
    statusFile: null,
    excerpt: recentEntry.excerpt,
  };
}

// Register test tool
server.registerTool(
  'test_connection',
  {
    title: 'Test Connection',
    description: 'Test if the MCP server is working',
    inputSchema: {},
  },
  async (): Promise<CallToolResult> => {
    return {
      content: [
        {
          type: 'text',
          text: `✅ MCP DevLog Server is working!\nDevLog Path: ${DEVLOG_PATH}`,
        },
      ],
    };
  }
);

// Register devlog init tool
server.registerTool(
  'devlog_init',
  {
    title: 'Initialize DevLog',
    description: 'Initialize devlog structure in a project (creates directories and initial files)',
    inputSchema: {
      projectPath: z.string().optional().describe('Project path (defaults to current directory)'),
      skipIfExists: z.boolean().optional().default(true).describe('Skip initialization if devlog already exists'),
    },
  },
  async ({ projectPath = process.cwd(), skipIfExists = true }): Promise<CallToolResult> => {
    const targetDevlogPath = path.join(projectPath, 'devlog');
    
    // Check if devlog already exists
    try {
      await fs.access(targetDevlogPath);
      if (skipIfExists) {
        return {
          content: [
            {
              type: 'text',
              text: `ℹ️ DevLog already exists at: ${targetDevlogPath}\nUse skipIfExists=false to reinitialize.`,
            },
          ],
        };
      }
    } catch {
      // Directory doesn't exist, good to proceed
    }
    
    try {
      // Create directory structure
      const directories = [
        'devlog',
        'devlog/daily',
        'devlog/features',
        'devlog/decisions',
        'devlog/insights',
        'devlog/research',
        'devlog/retrospective',
        'devlog/retrospective/weekly',
        'devlog/retrospective/monthly',
        'devlog/archive',
        'devlog/.mcp',
        'devlog/.config',
        'devlog/.tags',
      ];
      
      for (const dir of directories) {
        await fs.mkdir(path.join(projectPath, dir), { recursive: true });
      }
      
      // Create initial files
      const now = new Date();
      const dateStr = now.toISOString().split('T')[0];
      const timestamp = now.toISOString().slice(0, 10).replace(/-/g, '');
      
      // Create README.md
      const readmeContent = `# DevLog

This is the development log for tracking project progress, decisions, and insights.

## Structure

- **daily/** - Daily work sessions and progress
- **features/** - Feature planning and implementation tracking
- **decisions/** - Architectural and design decisions
- **insights/** - Research findings and analysis
- **research/** - Deep dives and explorations
- **retrospective/** - Weekly/monthly reviews and learnings
- **archive/** - Old content for reference

## Getting Started

1. Use \`devlog_workspace_claim\` to start a new session
2. Track progress with \`devlog_session_log\`
3. End sessions with \`devlog_workspace_dump\`

---
*Initialized: ${dateStr}*
`;
      
      await fs.writeFile(path.join(targetDevlogPath, 'README.md'), readmeContent);
      
      // Create current.md
      const currentContent = `---
title: "Current Workspace"
date: "${timestamp}"
agent_id: "agent-initial"
last_active: "${now.toISOString()}"
tags:
  type: session
  scope: [active-work]
  status: active
---

# Current Workspace

## 🎯 Today's Focus
- [ ] Set up development environment
- [ ] Review project requirements

## 🚧 In Progress
- [ ] DevLog initialization

## 💭 Quick Notes & Ideas
- DevLog initialized successfully

## ⏭️ Next Session
- [ ] Start feature planning

## 📥 Inbox (to process)
- Project setup tasks

---
*DevLog initialized: ${dateStr}*
`;
      
      await fs.writeFile(path.join(targetDevlogPath, 'current.md'), currentContent);
      
      // Create .gitignore
      const gitignoreContent = `# MCP metadata
.mcp/
.config/

# Temporary files
*.tmp
*.swp
.DS_Store

# Personal notes (if any)
personal/
private/
`;
      
      await fs.writeFile(path.join(targetDevlogPath, '.gitignore'), gitignoreContent);
      
      // Create search mode config
      await fs.writeFile(path.join(targetDevlogPath, '.config', 'search-mode'), 'auto');
      
      return {
        content: [
          {
            type: 'text',
            text: `✅ **DevLog Initialized Successfully!**

Created at: ${targetDevlogPath}

Structure created:
${directories.map(d => `  📁 ${d.replace('devlog/', '')}/`).join('\n')}

Files created:
  📄 README.md - Documentation and conventions
  📄 current.md - Active workspace
  📄 .gitignore - Git ignore rules
  📄 .config/search-mode - Search preferences

Next steps:
1. Run \`devlog_workspace_claim\` to start working
2. Use \`devlog_session_log\` to track progress
3. End with \`devlog_workspace_dump reason="session complete"\`

Happy coding! 🚀`,
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: `❌ Failed to initialize devlog: ${error}`,
          },
        ],
      };
    }
  }
);

// Register search tool
server.registerTool(
  'search_devlogs',
  {
    title: 'Search DevLogs',
    description: 'Search across all devlog entries with optional tag filtering',
    inputSchema: {
      query: z.string().describe('Search query (optional if using tags)').optional().default(''),
      type: z.enum(['insights', 'decisions', 'features', 'daily', 'current', 'all']).optional().default('all'),
      limit: z.number().optional().default(10),
      tags: z.record(z.any()).optional().describe('Tag filters as key-value pairs (e.g., {"type": "decision", "status": "implemented"})'),
    },
  },
  async ({ query, type, limit, tags }): Promise<CallToolResult> => {
    const results = await searchDevlogs(query || '', type, tags);
    const limited = results.slice(0, limit);
    
    return {
      content: [
        {
          type: 'text',
          text: `Found ${results.length} results${query ? ` for "${query}"` : ''}${tags ? ' with tag filters' : ''}:\n\n` +
            limited.map(r => {
              const tagStr = r.tags ? ` [${Object.entries(r.tags).map(([k, v]) => 
                Array.isArray(v) ? `${k}: ${v.join(', ')}` : `${k}: ${v}`
              ).join('; ')}]` : '';
              return `- ${r.file}${tagStr}\n  Modified: ${r.lastModified.toISOString()}\n  ${r.title ? `Title: ${r.title}\n  ` : ''}${r.excerpt}`;
            }).join('\n\n'),
        },
      ],
    };
  }
);

// Register list recent tool
server.registerTool(
  'list_recent_devlogs',
  {
    title: 'List Recent DevLogs',
    description: 'List recently modified devlog entries',
    inputSchema: {
      days: z.number().optional().default(7).describe('Number of days to look back'),
      type: z.enum(['insights', 'decisions', 'features', 'daily', 'current', 'all']).optional().default('all'),
    },
  },
  async ({ days, type }): Promise<CallToolResult> => {
    const patterns: Record<string, string> = {
      posts: 'posts/**/*.md',
      ideas: 'ideas-to-verify/**/*.md',
      features: 'features_plan/**/*.md',
      all: '**/*.md',
    };
    
    const pattern = patterns[type] || patterns.all;
    const files = globSync(pattern, { cwd: DEVLOG_PATH });
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - days);
    
    const recentFiles = [];
    for (const file of files) {
      const stats = await fs.stat(path.join(DEVLOG_PATH, file));
      if (stats.mtime > cutoffDate) {
        recentFiles.push({
          file,
          modified: stats.mtime,
        });
      }
    }
    
    recentFiles.sort((a, b) => b.modified.getTime() - a.modified.getTime());
    
    return {
      content: [
        {
          type: 'text',
          text: `Recent devlogs (last ${days} days):\n\n` +
            recentFiles.map(f => `- ${f.file} (${f.modified.toISOString()})`).join('\n'),
        },
      ],
    };
  }
);

// Register conflict detection tool
server.registerTool(
  'devlog_detect_conflicts',
  {
    title: 'Detect Conflicts',
    description: 'Find potential conflicts with existing features',
    inputSchema: {
      feature: z.string().describe('Feature name or description to check for conflicts'),
    },
  },
  async ({ feature }): Promise<CallToolResult> => {
    const conflicts = await detectConflicts(feature);
    
    if (conflicts.length === 0) {
      return {
        content: [
          {
            type: 'text',
            text: `✅ No conflicts detected for "${feature}"\n\nYou're clear to proceed with implementation.`,
          },
        ],
      };
    }
    
    const highRisk = conflicts.filter(c => c.riskLevel === 'HIGH');
    const mediumRisk = conflicts.filter(c => c.riskLevel === 'MEDIUM');
    const lowRisk = conflicts.filter(c => c.riskLevel === 'LOW');
    
    let result = `⚠️ Potential conflicts detected for "${feature}":\n\n`;
    
    if (highRisk.length > 0) {
      result += `🚨 HIGH RISK CONFLICTS (${highRisk.length}):\n`;
      highRisk.forEach(c => {
        result += `- ${c.file} (Score: ${c.conflictScore})\n`;
        result += `  ${c.excerpt}\n`;
        if (c.hasRegression) result += `  ⚠️ Previous regression detected\n`;
        if (c.hasBreakingChanges) result += `  ⚠️ Breaking changes history\n`;
        result += `\n`;
      });
    }
    
    if (mediumRisk.length > 0) {
      result += `⚠️ MEDIUM RISK CONFLICTS (${mediumRisk.length}):\n`;
      mediumRisk.slice(0, 3).forEach(c => {
        result += `- ${c.file} (Score: ${c.conflictScore})\n`;
        result += `  ${c.excerpt}\n\n`;
      });
    }
    
    if (lowRisk.length > 0) {
      result += `ℹ️ LOW RISK (${lowRisk.length} files) - Review recommended\n`;
    }
    
    return {
      content: [
        {
          type: 'text',
          text: result,
        },
      ],
    };
  }
);

// Register duplicate work checker
server.registerTool(
  'devlog_check_duplicate',
  {
    title: 'Check Duplicate Work',
    description: 'Check if feature has already been implemented',
    inputSchema: {
      description: z.string().describe('Feature description to check for duplicates'),
    },
  },
  async ({ description }): Promise<CallToolResult> => {
    const duplicates = await checkDuplicateWork(description);
    
    if (duplicates.length === 0) {
      return {
        content: [
          {
            type: 'text',
            text: `✅ No similar work found for "${description}"\n\nThis appears to be new work.`,
          },
        ],
      };
    }
    
    const completed = duplicates.filter(d => d.status === 'COMPLETED');
    const inProgress = duplicates.filter(d => d.status === 'IN_PROGRESS');
    
    let result = `🔍 Similar work found for "${description}":\n\n`;
    
    if (completed.length > 0) {
      result += `✅ ALREADY COMPLETED (${completed.length}):\n`;
      completed.slice(0, 3).forEach(d => {
        result += `- ${d.file} (${d.similarityScore}% match)\n`;
        result += `  ${d.excerpt}\n`;
        result += `  📅 ${d.lastModified.toISOString().split('T')[0]}\n\n`;
      });
      result += `⚠️ Consider reviewing existing implementation before proceeding.\n\n`;
    }
    
    if (inProgress.length > 0) {
      result += `🔄 IN PROGRESS (${inProgress.length}):\n`;
      inProgress.slice(0, 2).forEach(d => {
        result += `- ${d.file} (${d.similarityScore}% match)\n`;
        result += `  ${d.excerpt}\n\n`;
      });
      result += `⚠️ Check if this work is being done elsewhere.\n\n`;
    }
    
    const otherSimilar = duplicates.filter(d => d.status === 'UNKNOWN');
    if (otherSimilar.length > 0) {
      result += `❓ UNCLEAR STATUS (${otherSimilar.length}):\n`;
      otherSimilar.slice(0, 2).forEach(d => {
        result += `- ${d.file} (${d.similarityScore}% match)\n`;
      });
    }
    
    return {
      content: [
        {
          type: 'text',
          text: result,
        },
      ],
    };
  }
);

// Register feature status tool
server.registerTool(
  'devlog_feature_status',
  {
    title: 'Feature Status',
    description: 'Get current feature implementation status',
    inputSchema: {
      feature: z.string().describe('Feature name to check status'),
    },
  },
  async ({ feature }): Promise<CallToolResult> => {
    const status = await getFeatureStatus(feature);
    
    let result = `📊 Status for "${feature}":\n\n`;
    result += `**Status**: ${status.status}\n`;
    result += `**Version**: ${status.version}\n`;
    result += `**Implementation Date**: ${status.implementationDate}\n`;
    
    if (status.statusFile) {
      result += `**Status File**: ${status.statusFile}\n`;
    }
    
    result += `\n**Details**:\n${status.excerpt}`;
    
    // Add status indicator
    const statusIcon = {
      'COMPLETED': '✅',
      'IN_PROGRESS': '🔄', 
      'PLANNING': '📋',
      'BLOCKED': '🚫',
      'NOT_FOUND': '❓',
      'UNKNOWN': '❓'
    };
    
    const icon = statusIcon[status.status as keyof typeof statusIcon] || '❓';
    
    return {
      content: [
        {
          type: 'text',
          text: `${icon} ${result}`,
        },
      ],
    };
  }
);

// Regression tracking logic
async function trackRegressions(componentName: string) {
  const regressionKeywords = [
    'regression', 'broke', 'broken', 'breaking', 'failed', 'reverted', 'rollback',
    'bug', 'issue', 'problem', 'error', 'crash', 'fix', 'hotfix'
  ];
  
  const results = await searchDevlogs(componentName, 'all');
  const regressions = [];
  
  for (const result of results) {
    const content = result.fullContent?.toLowerCase() || '';
    
    // Check for regression indicators
    const regressionScore = regressionKeywords.reduce((score, keyword) => {
      if (content.includes(keyword) && content.includes(componentName.toLowerCase())) {
        return score + 1;
      }
      return score;
    }, 0);
    
    // Check for specific patterns
    const isFix = content.includes('fix') || content.includes('resolved');
    const isRegression = content.includes('regression') || content.includes('broke');
    const isRollback = content.includes('revert') || content.includes('rollback');
    
    if (regressionScore > 0) {
      let severity = 'LOW';
      if (regressionScore > 2 || isRollback) severity = 'MEDIUM';
      if (regressionScore > 4 || isRegression) severity = 'HIGH';
      
      let type = 'BUG';
      if (isFix) type = 'FIX';
      if (isRegression) type = 'REGRESSION';
      if (isRollback) type = 'ROLLBACK';
      
      regressions.push({
        file: result.file,
        severity,
        type,
        regressionScore,
        excerpt: result.excerpt,
        lastModified: result.lastModified,
        indicators: {
          isFix,
          isRegression,
          isRollback
        }
      });
    }
  }
  
  return regressions.sort((a, b) => {
    const severityOrder = { HIGH: 3, MEDIUM: 2, LOW: 1 };
    return severityOrder[b.severity as keyof typeof severityOrder] - severityOrder[a.severity as keyof typeof severityOrder];
  });
}

// Register regression tracking tool
server.registerTool(
  'devlog_regression_history',
  {
    title: 'Regression History',
    description: 'Track what broke before - prevent repeating failures',
    inputSchema: {
      component: z.string().describe('Component or feature name to check regression history'),
    },
  },
  async ({ component }): Promise<CallToolResult> => {
    const regressions = await trackRegressions(component);
    
    if (regressions.length === 0) {
      return {
        content: [
          {
            type: 'text',
            text: `✅ No regression history found for "${component}"\n\nThis component appears stable with no documented failures.`,
          },
        ],
      };
    }
    
    const high = regressions.filter(r => r.severity === 'HIGH');
    const medium = regressions.filter(r => r.severity === 'MEDIUM');
    const low = regressions.filter(r => r.severity === 'LOW');
    
    let result = `⚠️ Regression history for "${component}":\n\n`;
    
    if (high.length > 0) {
      result += `🚨 HIGH SEVERITY INCIDENTS (${high.length}):\n`;
      high.forEach(r => {
        result += `- ${r.file} (${r.type}) - ${r.lastModified.toISOString().split('T')[0]}\n`;
        result += `  ${r.excerpt}\n`;
        if (r.indicators.isRollback) result += `  🔄 Required rollback\n`;
        if (r.indicators.isRegression) result += `  🐛 Confirmed regression\n`;
        result += `\n`;
      });
    }
    
    if (medium.length > 0) {
      result += `⚠️ MEDIUM SEVERITY (${medium.length}):\n`;
      medium.slice(0, 3).forEach(r => {
        result += `- ${r.file} (${r.type}) - ${r.lastModified.toISOString().split('T')[0]}\n`;
        result += `  ${r.excerpt}\n\n`;
      });
    }
    
    if (low.length > 0) {
      result += `ℹ️ MINOR ISSUES (${low.length}) - Monitor for patterns\n`;
    }
    
    // Risk assessment
    const totalIssues = regressions.length;
    const recentIssues = regressions.filter(r => {
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
      return r.lastModified > thirtyDaysAgo;
    }).length;
    
    result += `\n📊 Risk Assessment:\n`;
    result += `- Total incidents: ${totalIssues}\n`;
    result += `- Recent (30 days): ${recentIssues}\n`;
    
    if (recentIssues > 2) {
      result += `- 🚨 HIGH RISK: Multiple recent failures\n`;
    } else if (recentIssues > 0) {
      result += `- ⚠️ MEDIUM RISK: Some recent activity\n`;
    } else {
      result += `- ✅ LOW RISK: No recent issues\n`;
    }
    
    result += `\n💡 Recommendations:\n`;
    if (high.length > 0) {
      result += `- Review high-severity incidents before making changes\n`;
    }
    if (recentIssues > 1) {
      result += `- Add extra testing for this component\n`;
    }
    result += `- Check existing tests cover the failure scenarios above\n`;
    
    return {
      content: [
        {
          type: 'text',
          text: result,
        },
      ],
    };
  }
);

// Pending work tracker
async function findPendingWork() {
  const patterns = ['posts/**/*.md', 'daily/**/*.md', 'features/**/*.md'];
  const pendingItems = [];
  
  for (const pattern of patterns) {
    const files = globSync(pattern, { cwd: DEVLOG_PATH });
    
    for (const file of files) {
      const content = await readDevlogFile(path.join(DEVLOG_PATH, file));
      if (!content) continue;
      
      const stats = await fs.stat(path.join(DEVLOG_PATH, file));
      const daysSinceModified = Math.floor((Date.now() - stats.mtime.getTime()) / (1000 * 60 * 60 * 24));
      
      // Look for pending indicators
      const pendingKeywords = [
        '- [ ]', 'TODO', 'FIXME', 'pending', 'in progress', 'blocked',
        'next steps', 'follow-up', 'continue', 'resume'
      ];
      
      const lines = content.split('\n');
      const pendingLines = lines.filter(line => 
        pendingKeywords.some(keyword => line.toLowerCase().includes(keyword.toLowerCase()))
      );
      
      if (pendingLines.length > 0) {
        let staleness = 'FRESH';
        if (daysSinceModified > 7) staleness = 'STALE';
        if (daysSinceModified > 14) staleness = 'VERY_STALE';
        
        pendingItems.push({
          file,
          staleness,
          daysSinceModified,
          pendingCount: pendingLines.length,
          pendingItems: pendingLines.slice(0, 3), // First 3 items
          lastModified: stats.mtime,
        });
      }
    }
  }
  
  return pendingItems.sort((a, b) => b.daysSinceModified - a.daysSinceModified);
}

// Register pending work tool
server.registerTool(
  'devlog_pending',
  {
    title: 'Pending Work',
    description: 'Find stale or incomplete work items',
    inputSchema: {
      staleness: z.enum(['all', 'stale', 'very_stale']).optional().default('all'),
    },
  },
  async ({ staleness }): Promise<CallToolResult> => {
    const pendingItems = await findPendingWork();
    
    let filtered = pendingItems;
    if (staleness === 'stale') {
      filtered = pendingItems.filter(p => p.staleness === 'STALE' || p.staleness === 'VERY_STALE');
    } else if (staleness === 'very_stale') {
      filtered = pendingItems.filter(p => p.staleness === 'VERY_STALE');
    }
    
    if (filtered.length === 0) {
      return {
        content: [
          {
            type: 'text',
            text: staleness === 'all' 
              ? `✅ No pending work found!\n\nAll tasks appear to be completed.`
              : `✅ No ${staleness.replace('_', ' ')} work found!\n\nGood job keeping things current.`,
          },
        ],
      };
    }
    
    const veryStale = filtered.filter(p => p.staleness === 'VERY_STALE');
    const stale = filtered.filter(p => p.staleness === 'STALE');
    const fresh = filtered.filter(p => p.staleness === 'FRESH');
    
    let result = `📋 Pending work found (${filtered.length} files):\n\n`;
    
    if (veryStale.length > 0) {
      result += `🚨 VERY STALE (${veryStale.length}) - Over 14 days old:\n`;
      veryStale.slice(0, 3).forEach(p => {
        result += `- ${p.file} (${p.daysSinceModified} days, ${p.pendingCount} items)\n`;
        p.pendingItems.forEach(item => {
          result += `  • ${item.trim()}\n`;
        });
        result += `\n`;
      });
    }
    
    if (stale.length > 0) {
      result += `⚠️ STALE (${stale.length}) - 7-14 days old:\n`;
      stale.slice(0, 3).forEach(p => {
        result += `- ${p.file} (${p.daysSinceModified} days, ${p.pendingCount} items)\n`;
        p.pendingItems.slice(0, 2).forEach(item => {
          result += `  • ${item.trim()}\n`;
        });
        result += `\n`;
      });
    }
    
    if (fresh.length > 0 && staleness === 'all') {
      result += `ℹ️ RECENT (${fresh.length}) - Under 7 days:\n`;
      fresh.slice(0, 2).forEach(p => {
        result += `- ${p.file} (${p.daysSinceModified} days, ${p.pendingCount} items)\n`;
      });
    }
    
    // Summary recommendations
    result += `\n💡 Recommendations:\n`;
    if (veryStale.length > 0) {
      result += `- Review very stale items - archive or update them\n`;
    }
    if (stale.length > 0) {
      result += `- Check stale items for continued relevance\n`;
    }
    if (filtered.length > 10) {
      result += `- Consider a cleanup session to reduce pending backlog\n`;
    }
    
    return {
      content: [
        {
          type: 'text',
          text: result,
        },
      ],
    };
  }
);

// Velocity insights logic
async function generateVelocityInsights(period: string = 'week') {
  const now = new Date();
  let startDate: Date;
  
  switch (period) {
    case 'day':
      startDate = new Date(now.getTime() - 24 * 60 * 60 * 1000);
      break;
    case 'week':
      startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      break;
    case 'month':
      startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
      break;
    default:
      startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  }
  
  const patterns = ['posts/**/*.md', 'daily/**/*.md', 'features/**/*.md', 'decisions/**/*.md'];
  const metrics = {
    totalFiles: 0,
    newFiles: 0,
    updatedFiles: 0,
    featuresCompleted: 0,
    decisionsLogged: 0,
    bugsFixed: 0,
    dailySessions: 0,
    avgSessionLength: 0,
    mostActiveDay: '',
    productivity: 'MEDIUM' as 'HIGH' | 'MEDIUM' | 'LOW'
  };
  
  const dailyActivity: Record<string, number> = {};
  
  for (const pattern of patterns) {
    const files = globSync(pattern, { cwd: DEVLOG_PATH });
    
    for (const file of files) {
      const filePath = path.join(DEVLOG_PATH, file);
      const stats = await fs.stat(filePath);
      const content = await readDevlogFile(filePath);
      
      if (!content) continue;
      
      metrics.totalFiles++;
      
      // Check if file was created or modified in period
      if (stats.birthtime > startDate) {
        metrics.newFiles++;
      } else if (stats.mtime > startDate) {
        metrics.updatedFiles++;
      }
      
      // Track daily activity
      const day = stats.mtime.toISOString().split('T')[0];
      dailyActivity[day] = (dailyActivity[day] || 0) + 1;
      
      // Analyze content for specific activities
      const lowerContent = content.toLowerCase();
      
      if (file.includes('posts/') && (lowerContent.includes('completed') || lowerContent.includes('implemented'))) {
        metrics.featuresCompleted++;
      }
      
      if (file.includes('decisions/')) {
        metrics.decisionsLogged++;
      }
      
      if (lowerContent.includes('fix') || lowerContent.includes('bug') || lowerContent.includes('resolved')) {
        metrics.bugsFixed++;
      }
      
      if (file.includes('daily/')) {
        metrics.dailySessions++;
      }
    }
  }
  
  // Calculate most active day
  const sortedDays = Object.entries(dailyActivity).sort((a, b) => b[1] - a[1]);
  if (sortedDays.length > 0) {
    metrics.mostActiveDay = sortedDays[0][0];
  }
  
  // Calculate productivity level
  const activityScore = metrics.newFiles + metrics.updatedFiles + metrics.featuresCompleted * 2 + metrics.decisionsLogged;
  if (activityScore > 20) metrics.productivity = 'HIGH';
  else if (activityScore < 5) metrics.productivity = 'LOW';
  
  return {
    period,
    startDate: startDate.toISOString().split('T')[0],
    endDate: now.toISOString().split('T')[0],
    metrics,
    dailyActivity,
    recommendations: generateProductivityRecommendations(metrics)
  };
}

function generateProductivityRecommendations(metrics: ProductivityMetrics): string[] {
  const recommendations = [];
  
  if (metrics.featuresCompleted === 0) {
    recommendations.push("Consider breaking large features into smaller, completable chunks");
  }
  
  if (metrics.decisionsLogged < 2) {
    recommendations.push("Document more architectural decisions as you make them");
  }
  
  if (metrics.dailySessions < 3) {
    recommendations.push("Try maintaining daily development logs for better tracking");
  }
  
  if (metrics.bugsFixed > metrics.featuresCompleted * 2) {
    recommendations.push("High bug-to-feature ratio - consider more upfront testing");
  }
  
  if (metrics.productivity === 'LOW') {
    recommendations.push("Consider using the MCP conflict detection tools before starting work");
  }
  
  if (recommendations.length === 0) {
    recommendations.push("Great development velocity! Keep up the consistent progress.");
  }
  
  return recommendations;
}

// Register velocity insights tool
server.registerTool(
  'devlog_velocity_insights',
  {
    title: 'Velocity Insights',
    description: 'Track development productivity patterns and metrics',
    inputSchema: {
      period: z.enum(['day', 'week', 'month']).optional().default('week'),
    },
  },
  async ({ period }): Promise<CallToolResult> => {
    const insights = await generateVelocityInsights(period);
    
    let result = `📊 Development Velocity Insights (${period}):\n`;
    result += `📅 Period: ${insights.startDate} to ${insights.endDate}\n\n`;
    
    // Productivity level
    const productivityIcon = {
      HIGH: '🚀',
      MEDIUM: '⚡',
      LOW: '🐌'
    };
    result += `${productivityIcon[insights.metrics.productivity]} **Productivity**: ${insights.metrics.productivity}\n\n`;
    
    // Key metrics
    result += `📈 **Key Metrics**:\n`;
    result += `- Files created: ${insights.metrics.newFiles}\n`;
    result += `- Files updated: ${insights.metrics.updatedFiles}\n`;
    result += `- Features completed: ${insights.metrics.featuresCompleted}\n`;
    result += `- Decisions logged: ${insights.metrics.decisionsLogged}\n`;
    result += `- Bugs fixed: ${insights.metrics.bugsFixed}\n`;
    result += `- Daily sessions: ${insights.metrics.dailySessions}\n`;
    
    if (insights.metrics.mostActiveDay) {
      result += `- Most active day: ${insights.metrics.mostActiveDay}\n`;
    }
    
    // Daily activity breakdown
    result += `\n📅 **Daily Activity**:\n`;
    const sortedActivity = Object.entries(insights.dailyActivity)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5);
    
    sortedActivity.forEach(([day, count]) => {
      const bar = '█'.repeat(Math.min(count, 10));
      result += `${day}: ${bar} (${count} files)\n`;
    });
    
    // Recommendations
    result += `\n💡 **Recommendations**:\n`;
    insights.recommendations.forEach(rec => {
      result += `- ${rec}\n`;
    });
    
    // Velocity trends
    const totalActivity = insights.metrics.newFiles + insights.metrics.updatedFiles;
    const dailyAverage = Math.round((totalActivity / (period === 'day' ? 1 : period === 'week' ? 7 : 30)) * 10) / 10;
    
    result += `\n📊 **Velocity Analysis**:\n`;
    result += `- Average files per day: ${dailyAverage}\n`;
    result += `- Feature completion rate: ${insights.metrics.featuresCompleted} per ${period}\n`;
    
    if (insights.metrics.productivity === 'HIGH') {
      result += `- 🎯 Excellent momentum! You're in a highly productive phase.\n`;
    } else if (insights.metrics.productivity === 'LOW') {
      result += `- 🎯 Consider using MCP conflict detection to reduce blocking issues.\n`;
    }
    
    return {
      content: [
        {
          type: 'text',
          text: result,
        },
      ],
    };
  }
);

// Timeline generation logic
async function generateTimeline(range: string = 'month', _format: string = 'text') {
  const now = new Date();
  let startDate: Date;
  
  switch (range) {
    case 'week':
      startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      break;
    case 'month':
      startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
      break;
    case 'quarter':
      startDate = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
      break;
    case 'all':
      startDate = new Date(2025, 0, 1); // Start of 2025
      break;
    default:
      startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  }
  
  // const patterns = ['posts/**/*.md', 'decisions/**/*.md', 'features/**/*.md'];
  const timelineEvents: Array<{
    date: string;
    type: 'FEATURE' | 'DECISION' | 'POST' | 'MILESTONE';
    title: string;
    file: string;
    description: string;
    impact: 'HIGH' | 'MEDIUM' | 'LOW';
  }> = [];
  
  // Scan feature directories (date-prefixed)
  const featurePattern = 'features/*/status.md';
  const featureFiles = globSync(featurePattern, { cwd: DEVLOG_PATH });
  
  for (const file of featureFiles) {
    const content = await readDevlogFile(path.join(DEVLOG_PATH, file));
    if (!content) continue;
    
    // Extract date from directory name
    const match = file.match(/features\/(\d{4}-\d{2}-\d{2})-([^/]+)/);
    if (match) {
      const [, dateStr, featureName] = match;
      const eventDate = new Date(dateStr);
      
      if (eventDate >= startDate) {
        const status = content.match(/\*\*Status\*\*:\s*(.+)/)?.[1]?.trim() || 'UNKNOWN';
        const isCompleted = status.includes('IMPLEMENTED') || status.includes('✅');
        
        timelineEvents.push({
          date: dateStr,
          type: 'FEATURE',
          title: featureName.replace(/-/g, ' '),
          file,
          description: `Feature implementation: ${status}`,
          impact: isCompleted ? 'HIGH' : 'MEDIUM'
        });
      }
    }
  }
  
  // Scan decision files
  const decisionFiles = globSync('decisions/**/*.md', { cwd: DEVLOG_PATH });
  for (const file of decisionFiles) {
    const stats = await fs.stat(path.join(DEVLOG_PATH, file));
    if (stats.mtime >= startDate) {
      const content = await readDevlogFile(path.join(DEVLOG_PATH, file));
      const title = content?.split('\n')[0]?.replace(/^#\s*/, '') || file;
      
      timelineEvents.push({
        date: stats.mtime.toISOString().split('T')[0],
        type: 'DECISION',
        title: title.substring(0, 50) + (title.length > 50 ? '...' : ''),
        file,
        description: 'Architectural decision logged',
        impact: 'MEDIUM'
      });
    }
  }
  
  // Scan post files
  const postFiles = globSync('posts/**/*.md', { cwd: DEVLOG_PATH });
  for (const file of postFiles) {
    const stats = await fs.stat(path.join(DEVLOG_PATH, file));
    if (stats.mtime >= startDate) {
      const content = await readDevlogFile(path.join(DEVLOG_PATH, file));
      const title = content?.split('\n')[0]?.replace(/^#\s*/, '') || file;
      
      let impact: 'HIGH' | 'MEDIUM' | 'LOW' = 'LOW';
      if (content?.toLowerCase().includes('completed') || content?.toLowerCase().includes('implemented')) {
        impact = 'HIGH';
      } else if (content?.toLowerCase().includes('fix') || content?.toLowerCase().includes('enhancement')) {
        impact = 'MEDIUM';
      }
      
      timelineEvents.push({
        date: stats.mtime.toISOString().split('T')[0],
        type: 'POST',
        title: title.substring(0, 50) + (title.length > 50 ? '...' : ''),
        file,
        description: 'DevLog post created',
        impact
      });
    }
  }
  
  // Sort by date
  timelineEvents.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  
  return {
    range,
    startDate: startDate.toISOString().split('T')[0],
    endDate: now.toISOString().split('T')[0],
    totalEvents: timelineEvents.length,
    events: timelineEvents,
    summary: generateTimelineSummary(timelineEvents)
  };
}

function generateTimelineSummary(events: TimelineEvent[]) {
  const features = events.filter(e => e.type === 'FEATURE');
  const decisions = events.filter(e => e.type === 'DECISION');
  const posts = events.filter(e => e.type === 'POST');
  const highImpact = events.filter(e => e.impact === 'HIGH');
  
  return {
    featuresImplemented: features.length,
    decisionsLogged: decisions.length,
    postsCreated: posts.length,
    highImpactEvents: highImpact.length,
    mostActiveType: features.length > decisions.length ? 'Implementation' : 'Planning'
  };
}

// Register timeline tool
server.registerTool(
  'devlog_timeline',
  {
    title: 'Development Timeline',
    description: 'Generate chronological development history',
    inputSchema: {
      range: z.enum(['week', 'month', 'quarter', 'all']).optional().default('month'),
      format: z.enum(['text', 'json']).optional().default('text'),
    },
  },
  async ({ range, format }): Promise<CallToolResult> => {
    const timeline = await generateTimeline(range, format);
    
    if (format === 'json') {
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(timeline, null, 2),
          },
        ],
      };
    }
    
    let result = `📅 Development Timeline (${range}):\n`;
    result += `🗓️ Period: ${timeline.startDate} to ${timeline.endDate}\n`;
    result += `📊 Total events: ${timeline.totalEvents}\n\n`;
    
    // Summary
    result += `📈 **Summary**:\n`;
    result += `- Features implemented: ${timeline.summary.featuresImplemented}\n`;
    result += `- Decisions logged: ${timeline.summary.decisionsLogged}\n`;
    result += `- Posts created: ${timeline.summary.postsCreated}\n`;
    result += `- High-impact events: ${timeline.summary.highImpactEvents}\n`;
    result += `- Focus area: ${timeline.summary.mostActiveType}\n\n`;
    
    if (timeline.events.length === 0) {
      result += `No events found in the specified ${range} period.\n`;
      return {
        content: [{ type: 'text', text: result }],
      };
    }
    
    // Timeline events
    result += `🕒 **Timeline**:\n`;
    
    const groupedByDate: Record<string, TimelineEvent[]> = {};
    timeline.events.forEach(event => {
      if (!groupedByDate[event.date]) {
        groupedByDate[event.date] = [];
      }
      groupedByDate[event.date].push(event);
    });
    
    const sortedDates = Object.keys(groupedByDate).sort().reverse(); // Most recent first
    
    sortedDates.forEach(date => {
      result += `\n**${date}**:\n`;
      groupedByDate[date].forEach(event => {
        const iconMap: Record<string, string> = {
          FEATURE: '🚀',
          DECISION: '🤔',
          POST: '📝',
          MILESTONE: '🎯'
        };
        const icon = iconMap[event.type] || '📝';
        
        const impactIconMap: Record<string, string> = {
          HIGH: '🔥',
          MEDIUM: '⚡',
          LOW: '💡'
        };
        const impactIcon = event.impact ? impactIconMap[event.impact] : '💡';
        
        result += `  ${icon} ${impactIcon} **${event.title}**\n`;
        result += `    📁 ${event.file}\n`;
        result += `    📝 ${event.description}\n`;
      });
    });
    
    // Recent activity insights
    if (timeline.events.length > 0) {
      const recentDays = 7;
      const recentEvents = timeline.events.filter(e => {
        const eventDate = new Date(e.date);
        const cutoff = new Date();
        cutoff.setDate(cutoff.getDate() - recentDays);
        return eventDate >= cutoff;
      });
      
      if (recentEvents.length > 0) {
        result += `\n🔥 **Recent Activity** (last ${recentDays} days):\n`;
        result += `- ${recentEvents.length} events\n`;
        
        const recentTypes = recentEvents.reduce((acc: Record<string, number>, e) => {
          acc[e.type] = (acc[e.type] || 0) + 1;
          return acc;
        }, {});
        
        Object.entries(recentTypes).forEach(([type, count]) => {
          result += `- ${type.toLowerCase()}: ${count}\n`;
        });
      }
    }
    
    return {
      content: [
        {
          type: 'text',
          text: result,
        },
      ],
    };
  }
);

// Devlog compression tool
server.registerTool(
  'devlog_compress_week',
  {
    title: 'Compress Weekly Sessions with Analysis',
    description: 'Compress daily session files into analytical weekly summary with velocity insights, timeline, and patterns',
    inputSchema: {
      weekNumber: z.number().optional().describe('Week number to compress (defaults to last week)'),
      year: z.number().optional().describe('Year (defaults to current year)'),
      dryRun: z.boolean().optional().default(false).describe('Preview without making changes'),
      useEnhanced: z.boolean().optional().default(true).describe('Use enhanced analysis (default: true)'),
    },
  },
  async ({ weekNumber, year, dryRun = false, useEnhanced: _useEnhanced = true }): Promise<CallToolResult> => {
    // For now, always use enhanced compression with integrated analysis
    const now = new Date();
    const currentYear = year || now.getFullYear();
    
    // Calculate week number if not provided
    if (!weekNumber) {
      const oneWeekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      weekNumber = getWeekNumber(oneWeekAgo);
    }
    
    try {
      // Find daily files for the week
      const weekDates = getWeekDates(currentYear, weekNumber);
      const dailyPattern = path.join(DEVLOG_PATH, 'daily', '*.md');
      const allDailyFiles = globSync(dailyPattern);
      
      const dailyFiles = allDailyFiles.filter(file => {
        const match = path.basename(file).match(/^(\d{4}-\d{2}-\d{2})/);
        if (!match) return false;
        
        const fileDate = new Date(match[1]);
        return fileDate >= weekDates.start && fileDate <= weekDates.end;
      });
      
      if (dailyFiles.length === 0) {
        return {
          content: [{
            type: 'text',
            text: `No daily files found for week ${weekNumber} of ${currentYear}`
          }]
        };
      }
      
      // Extract data from each session
      const sessions: SessionData[] = [];
      for (const file of dailyFiles) {
        const content = await readDevlogFile(file);
        if (!content) continue;
        
        const parsed = parseDevlogContent(content);
        const fileDate = new Date(path.basename(file).substring(0, 10));
        
        const session = {
          file,
          date: fileDate,
          content: parsed.content,
          frontmatter: parsed.data,
          completedTasks: (content.match(/- \[x\] .+/g) || []).map(m => m.replace(/- \[x\] /, '')),
          decisions: content.match(/(?:decision|decided|chose):.+/gi) || [],
          insights: content.match(/(?:insight|learned|discovered):.+/gi) || [],
          summary: ''
        };
        
        const summaryMatch = content.match(/## Summary\n([\s\S]+?)(?=\n##|$)/);
        if (summaryMatch) {
          session.summary = summaryMatch[1].trim();
        }
        
        sessions.push(session);
      }
      
      sessions.sort((a, b) => a.date.getTime() - b.date.getTime());
      
      // Get velocity insights for the week
      const velocityData = await generateVelocityInsights('week');
      
      // Get timeline for the week
      const timelineData = await generateTimeline('week');
      
      // Generate enhanced weekly summary with analysis
      const weeklySummary = await generateEnhancedWeeklySummary(
        sessions, weekNumber, currentYear, weekDates, velocityData, timelineData
      );
      
      // Paths for new files with better naming
      const compressedFilename = generateCompressedFilename(currentYear, weekNumber, weekDates);
      const weeklyFile = path.join(DEVLOG_PATH, 'retrospective', 'weekly', compressedFilename);
      const archiveDir = path.join(DEVLOG_PATH, 'archive', 'daily', 
        `${currentYear}-W${String(weekNumber).padStart(2, '0')}`);
      
      if (dryRun) {
        return {
          content: [{
            type: 'text',
            text: `🔍 **Dry Run - Week ${weekNumber} Compression**\n\n` +
              `Files to compress: ${dailyFiles.length}\n` +
              `- ${dailyFiles.map(f => path.basename(f)).join('\n- ')}\n\n` +
              `Weekly summary would be saved to:\n${weeklyFile}\n\n` +
              `Daily files would be moved to:\n${archiveDir}/\n\n` +
              `**Summary Preview:**\n${weeklySummary.substring(0, 500)}...`
          }]
        };
      }
      
      // Create directories
      await fs.mkdir(path.dirname(weeklyFile), { recursive: true });
      await fs.mkdir(archiveDir, { recursive: true });
      
      // Write weekly summary
      await fs.writeFile(weeklyFile, weeklySummary);
      
      // Move daily files to archive
      for (const file of dailyFiles) {
        const basename = path.basename(file);
        const archivePath = path.join(archiveDir, basename);
        await fs.rename(file, archivePath);
      }
      
      return {
        content: [{
          type: 'text',
          text: `✅ **Week ${weekNumber} Compressed Successfully!**\n\n` +
            `📊 Statistics:\n` +
            `- Sessions compressed: ${sessions.length}\n` +
            `- Tasks completed: ${sessions.flatMap((s: SessionData) => s.completedTasks).length}\n` +
            `- Decisions made: ${sessions.flatMap((s: SessionData) => s.decisions).length}\n` +
            `- Insights captured: ${sessions.flatMap((s: SessionData) => s.insights).length}\n\n` +
            `📁 Files:\n` +
            `- Weekly summary: ${path.relative(DEVLOG_PATH, weeklyFile)}\n` +
            `- Archived to: ${path.relative(DEVLOG_PATH, archiveDir)}/\n\n` +
            `🔄 ChromaDB Update:\n` +
            `Run: python scripts/chromadb-smart-index.py --reindex\n\n` +
            `💡 The weekly summary is now the primary search target.\n` +
            `Original files are preserved in archive for reference.`
        }]
      };
    } catch (error) {
      return {
        content: [{
          type: 'text',
          text: `❌ Compression failed: ${error}`
        }]
      };
    }
  }
);

// Helper functions for compression
function getWeekNumber(date: Date): number {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil((((d.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
}

function getWeekDates(year: number, weekNumber: number) {
  // Find the first Thursday of the year (ISO week date standard)
  const jan4 = new Date(year, 0, 4);
  const jan4DayOfWeek = jan4.getDay() || 7; // Convert Sunday from 0 to 7
  
  // Find the Monday of the week containing January 4th
  const firstMondayOfYear = new Date(jan4);
  firstMondayOfYear.setDate(4 - jan4DayOfWeek + 1);
  
  // Calculate the start of the requested week
  const weekStart = new Date(firstMondayOfYear);
  weekStart.setDate(firstMondayOfYear.getDate() + (weekNumber - 1) * 7);
  
  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekStart.getDate() + 6);
  
  return { start: weekStart, end: weekEnd };
}

async function generateEnhancedWeeklySummary(
  sessions: SessionData[], 
  weekNumber: number, 
  year: number,
  weekDates: { start: Date; end: Date },
  velocityData: VelocityData,
  timelineData: TimelineData
): Promise<string> {
  const allCompleted = sessions.flatMap(s => s.completedTasks);
  const allDecisions = sessions.flatMap(s => s.decisions);
  const allInsights = sessions.flatMap(s => s.insights);
  
  // Extract unique focus areas
  const focusAreas = new Set<string>();
  sessions.forEach(s => {
    if (s.frontmatter.tags?.scope) {
      const scopes = Array.isArray(s.frontmatter.tags.scope) 
        ? s.frontmatter.tags.scope 
        : [s.frontmatter.tags.scope];
      scopes.forEach((scope: string) => focusAreas.add(scope));
    }
  });
  
  // const totalHours = sessions.length * 2.5; // Rough estimate
  
  // Extract metrics from velocity data
  const metrics = velocityData.metrics || {};
  const productivity = metrics.productivity || 'MEDIUM';
  
  // Group timeline events by date
  const eventsByDate: Record<string, TimelineEvent[]> = {};
  if (timelineData && timelineData.events) {
    timelineData.events.forEach((event) => {
      if (!eventsByDate[event.date]) eventsByDate[event.date] = [];
      eventsByDate[event.date].push(event);
    });
  }
  
  const summary = `---
title: "Week ${weekNumber} Analytical Summary - ${year}"
date: "${new Date().toISOString()}"
week: ${weekNumber}
year: ${year}
dateRange: "${weekDates.start.toISOString().split('T')[0]} to ${weekDates.end.toISOString().split('T')[0]}"
sessions: ${sessions.length}
tags:
  type: weekly-analysis
  scope: [${Array.from(focusAreas).join(', ')}]
  status: consolidated
  productivity: ${productivity.toLowerCase()}
  index_priority: high
metrics:
  filesCreated: ${metrics.newFiles || 0}
  tasksCompleted: ${allCompleted.length}
  decisionsLogged: ${metrics.decisionsLogged || 0}
  featuresCompleted: ${metrics.featuresCompleted || 0}
  bugsFixed: ${metrics.bugsFixed || 0}
---

# Week ${weekNumber} (${weekDates.start.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} - ${weekDates.end.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })})

## 📊 Velocity Analysis

**Productivity Level**: ${productivity} ${productivity === 'HIGH' ? '🚀' : productivity === 'LOW' ? '🐌' : '➡️'}

### Key Metrics
- **Files Created**: ${metrics.newFiles || 0} (${((metrics.newFiles || 0) / 7).toFixed(1)}/day avg)
- **Tasks Completed**: ${allCompleted.length}
- **Features Delivered**: ${metrics.featuresCompleted || 0}
- **Decisions Made**: ${metrics.decisionsLogged || 0}
- **Bugs Fixed**: ${metrics.bugsFixed || 0}
- **Most Active Day**: ${metrics.mostActiveDay || 'N/A'}

## 📅 Week Timeline

${Object.entries(eventsByDate).length > 0 ? 
  Object.entries(eventsByDate).map(([date, events]) => {
    const dayName = new Date(date).toLocaleDateString('en-US', { weekday: 'long' });
    return `### ${dayName}, ${date}
${events.map((e) => {
  const icon = e.type === 'FEATURE' ? '🚀' : 
               e.type === 'DECISION' ? '🤔' : 
               e.type === 'POST' ? '📝' : '📋';
  const impactIcon = e.impact === 'HIGH' ? ' 🔥' : '';
  return `- ${icon}${impactIcon} **${e.title}**
  - 📁 \`${e.file}\`
  - ${e.description || e.type.toLowerCase()}`;
}).join('\n\n')}`;
  }).join('\n\n') :
  'No significant timeline events recorded'
}

## 🎯 Major Accomplishments

${allCompleted.length > 0 ? allCompleted.slice(0, 10).map((task, i) => `${i + 1}. ✅ ${task}`).join('\n') : '- No completed tasks recorded'}
${allCompleted.length > 10 ? `\n*... and ${allCompleted.length - 10} more tasks*` : ''}

## 🤔 Key Decisions

${allDecisions.length > 0 ? allDecisions.slice(0, 5).map(d => `- 📋 ${d}`).join('\n') : '- No major decisions recorded'}

## 💡 Insights & Learnings

${allInsights.length > 0 ? allInsights.slice(0, 5).map(i => `- 💡 ${i}`).join('\n') : '- No insights recorded'}

## 📅 Daily Breakdown

${sessions.map(s => {
  const dayName = s.date.toLocaleDateString('en-US', { weekday: 'long' });
  const dateStr = s.date.toISOString().split('T')[0];
  return `### ${dayName}, ${dateStr}
${s.summary || 'No summary available'}
- Completed: ${s.completedTasks.length} tasks
- File: archive/daily/${year}-W${String(weekNumber).padStart(2, '0')}/${path.basename(s.file)}`;
}).join('\n\n')}

## 📊 Visual Analytics

${generateActivityClock(sessions)}

${generateActivityMatrix(sessions)}

${(() => {
  const activeHours = calculateActiveHours(sessions);
  return generateActiveHoursVisualization(activeHours);
})()}

${generateTaskDistribution(allCompleted, allDecisions, metrics.bugsFixed || 0, metrics.featuresCompleted || 0)}

## 🔍 Analysis & Insights

### Productivity Patterns
- **Average tasks/session**: ${sessions.length > 0 ? (allCompleted.length / sessions.length).toFixed(1) : '0'}
- **Most productive day**: ${getMostProductiveDay(sessions)}
- **Decision density**: ${sessions.length > 0 ? (metrics.decisionsLogged / sessions.length).toFixed(1) : '0'} decisions/session
- **Primary focus**: ${Array.from(focusAreas)[0] || 'General development'}

### Weekly Trends
${velocityData.recommendations ? velocityData.recommendations : 
  productivity === 'HIGH' ? 
  '- Excellent momentum! Continue current practices\n- Consider documenting successful patterns' :
  productivity === 'LOW' ?
  '- Review blockers from this week\n- Consider breaking tasks into smaller chunks' :
  '- Steady progress maintained\n- Look for optimization opportunities'
}

### Recommendations for Next Week
1. **Continue**: Building on ${Array.from(focusAreas)[0] || 'current'} momentum
2. **Address**: Any incomplete items from daily sessions
3. **Focus**: ${metrics.newFiles > 10 ? 'Documentation and consolidation' : 'Feature development'}

## 🎨 Conceptual Diagrams

${(() => {
  // Extract decision titles for better diagram generation
  const decisionTitles = allDecisions.map((d: string | {title?: string}) => typeof d === 'string' ? d : d.title || '').filter(Boolean);
  
  if (decisionTitles.length > 0) {
    // Generate enhanced Mermaid diagrams using our new functions
    const visualData: CompressionVisualData = {
      weekNumber,
      year,
      taskDistribution: {
        features: Math.round((timelineData?.events?.filter((e) => e.type === 'FEATURE').length || 0) / Math.max(allCompleted.length, 1) * 100),
        bugs: Math.round((allCompleted.filter((t: string) => t.toLowerCase().includes('fix') || t.toLowerCase().includes('bug')).length) / Math.max(allCompleted.length, 1) * 100),
        research: Math.round((allCompleted.filter((t: string) => t.toLowerCase().includes('research')).length) / Math.max(allCompleted.length, 1) * 100),
        planning: Math.round((allCompleted.filter((t: string) => t.toLowerCase().includes('plan')).length) / Math.max(allCompleted.length, 1) * 100),
        other: 0
      },
      activeHours: calculateActiveHours(sessions),
      productivityScore: productivity as 'HIGH' | 'MEDIUM' | 'LOW',
      velocity: Math.round(allCompleted.length / Math.max(sessions.length, 1)),
      decisions: decisionTitles.slice(0, 10),
      timeline: timelineData?.events?.map(event => ({
        task: event.title,
        completed: true
      })) || []
    };
    
    const diagrams = generateAllCompressionDiagrams(visualData);
    
    return [
      '### Decision Flow Analysis',
      '```mermaid',
      diagrams.decisionFlow,
      '```',
      '',
      '### Task Distribution Overview', 
      '```mermaid',
      diagrams.taskDistribution,
      '```',
      '',
      '### Weekly Overview',
      '```mermaid', 
      diagrams.overview,
      '```'
    ].join('\n');
  } else {
    // Fallback to basic conceptual diagrams if no decisions
    const conceptualDiagrams = generateConceptualDiagrams(
      { week: weekNumber },
      allDecisions,
      timelineData?.events?.filter((e) => e.type === 'FEATURE').map((e) => e.title) || []
    );
    return conceptualDiagrams.length > 0 ? conceptualDiagrams.join('\n\n') : 
      '> No significant architectural changes or feature relationships to visualize this week.';
  }
})()}

---
*Generated from ${sessions.length} daily sessions with integrated velocity and timeline analysis*
*Original files archived to: archive/daily/${year}-W${String(weekNumber).padStart(2, '0')}/*
`;
  
  return summary;
}

function getMostProductiveDay(sessions: SessionData[]): string {
  if (sessions.length === 0) return 'N/A';
  
  const mostProductive = sessions.reduce((best: SessionData, current: SessionData) => {
    return current.completedTasks.length > best.completedTasks.length ? current : best;
  });
  
  return mostProductive.date.toLocaleDateString('en-US', { 
    weekday: 'long', 
    month: 'short', 
    day: 'numeric' 
  });
}

// Test checklist generation logic
async function generateTestChecklist(feature: string) {
  // Analyze feature for regression patterns
  const regressions = await trackRegressions(feature);
  const conflicts = await detectConflicts(feature);
  
  // Base test categories
  const testCategories = {
    unit: [] as string[],
    integration: [] as string[],
    e2e: [] as string[],
    regression: [] as string[],
    performance: [] as string[],
    security: [] as string[]
  };
  
  // Generate basic tests based on feature type
  const featureLower = feature.toLowerCase();
  
  // Unit tests
  testCategories.unit.push(`Test ${feature} component renders correctly`);
  testCategories.unit.push(`Test ${feature} handles invalid input gracefully`);
  testCategories.unit.push(`Test ${feature} state management functions`);
  
  // Feature-specific tests
  if (featureLower.includes('auth') || featureLower.includes('login')) {
    testCategories.unit.push('Test authentication token validation');
    testCategories.security.push('Test unauthorized access prevention');
    testCategories.security.push('Test password strength validation');
    testCategories.e2e.push('Test complete login/logout flow');
  }
  
  if (featureLower.includes('api') || featureLower.includes('endpoint')) {
    testCategories.integration.push('Test API response format');
    testCategories.integration.push('Test error handling for invalid requests');
    testCategories.performance.push('Test API response time under load');
    testCategories.security.push('Test input sanitization');
  }
  
  if (featureLower.includes('ui') || featureLower.includes('component')) {
    testCategories.unit.push('Test component prop handling');
    testCategories.e2e.push('Test user interaction flows');
    testCategories.unit.push('Test accessibility compliance');
  }
  
  if (featureLower.includes('database') || featureLower.includes('data')) {
    testCategories.integration.push('Test data persistence');
    testCategories.integration.push('Test database transaction rollback');
    testCategories.performance.push('Test query performance');
  }
  
  if (featureLower.includes('template') || featureLower.includes('form')) {
    testCategories.unit.push('Test form validation');
    testCategories.e2e.push('Test form submission flow');
    testCategories.unit.push('Test template rendering with various data');
  }
  
  // Add regression tests based on history
  regressions.forEach(regression => {
    if (regression.severity === 'HIGH' || regression.severity === 'MEDIUM') {
      testCategories.regression.push(
        `Test prevention of: ${regression.excerpt.substring(0, 60)}...`
      );
    }
  });
  
  // Add conflict prevention tests
  conflicts.forEach(conflict => {
    if (conflict.riskLevel === 'HIGH' || conflict.riskLevel === 'MEDIUM') {
      testCategories.integration.push(
        `Test compatibility with: ${conflict.file.split('/').pop()?.replace('.md', '')}`
      );
    }
  });
  
  // Performance tests for all features
  testCategories.performance.push(`Test ${feature} memory usage`);
  testCategories.performance.push(`Test ${feature} rendering performance`);
  
  return {
    feature,
    testCategories,
    totalTests: Object.values(testCategories).flat().length,
    priorityTests: generatePriorityTests(testCategories),
    estimatedTime: calculateTestingTime(testCategories)
  };
}

function generatePriorityTests(testCategories: TestCategories) {
  const priority = [];
  
  // High priority: regression and security
  if (testCategories.regression.length > 0) {
    priority.push(...testCategories.regression.slice(0, 2));
  }
  if (testCategories.security.length > 0) {
    priority.push(...testCategories.security.slice(0, 2));
  }
  
  // Medium priority: core functionality
  priority.push(...testCategories.unit.slice(0, 3));
  priority.push(...testCategories.integration.slice(0, 2));
  
  return priority;
}

function calculateTestingTime(testCategories: TestCategories) {
  const timeEstimates = {
    unit: 0.5, // 30 minutes per unit test
    integration: 1, // 1 hour per integration test
    e2e: 2, // 2 hours per e2e test
    regression: 1, // 1 hour per regression test
    performance: 1.5, // 1.5 hours per performance test
    security: 1 // 1 hour per security test
  };
  
  let totalHours = 0;
  Object.entries(testCategories).forEach(([category, tests]) => {
    totalHours += tests.length * (timeEstimates[category as keyof typeof timeEstimates] || 1);
  });
  
  return {
    totalHours: Math.round(totalHours * 10) / 10,
    totalDays: Math.round((totalHours / 8) * 10) / 10,
    breakdown: Object.entries(testCategories).map(([category, tests]) => ({
      category,
      count: tests.length,
      hours: Math.round(tests.length * (timeEstimates[category as keyof typeof timeEstimates] || 1) * 10) / 10
    }))
  };
}

// Register test checklist tool
server.registerTool(
  'devlog_test_checklist',
  {
    title: 'Test Checklist Generator',
    description: 'Generate automated test suggestions based on feature and regression history',
    inputSchema: {
      feature: z.string().describe('Feature name to generate test checklist for'),
      format: z.enum(['checklist', 'detailed', 'json']).optional().default('checklist'),
    },
  },
  async ({ feature, format }): Promise<CallToolResult> => {
    const checklist = await generateTestChecklist(feature);
    
    if (format === 'json') {
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(checklist, null, 2),
          },
        ],
      };
    }
    
    let result = `🧪 Test Checklist for "${feature}":\n\n`;
    result += `📊 **Overview**:\n`;
    result += `- Total tests suggested: ${checklist.totalTests}\n`;
    result += `- Estimated time: ${checklist.estimatedTime.totalHours} hours (${checklist.estimatedTime.totalDays} days)\n\n`;
    
    if (format === 'detailed') {
      result += `⏱️ **Time Breakdown**:\n`;
      checklist.estimatedTime.breakdown.forEach(item => {
        if (item.count > 0) {
          result += `- ${item.category}: ${item.count} tests (${item.hours}h)\n`;
        }
      });
      result += `\n`;
    }
    
    // Priority tests first
    if (checklist.priorityTests.length > 0) {
      result += `🔥 **Priority Tests** (Start Here):\n`;
      checklist.priorityTests.forEach((test, index) => {
        result += `${index + 1}. [ ] ${test}\n`;
      });
      result += `\n`;
    }
    
    // All test categories
    const categoryIcons = {
      unit: '🔬',
      integration: '🔗',
      e2e: '🎭',
      regression: '🔄',
      performance: '⚡',
      security: '🔐'
    };
    
    Object.entries(checklist.testCategories).forEach(([category, tests]) => {
      if (tests.length > 0) {
        const icon = categoryIcons[category as keyof typeof categoryIcons] || '📝';
        result += `${icon} **${category.toUpperCase()} TESTS**:\n`;
        tests.forEach((test: string, index: number) => {
          result += `${index + 1}. [ ] ${test}\n`;
        });
        result += `\n`;
      }
    });
    
    // Additional recommendations
    result += `💡 **Testing Recommendations**:\n`;
    result += `- Start with priority tests to catch critical issues early\n`;
    result += `- Run regression tests after any changes to this feature\n`;
    result += `- Include performance tests in CI/CD pipeline\n`;
    
    if (checklist.testCategories.security.length > 0) {
      result += `- Security tests should be reviewed by security team\n`;
    }
    
    if (checklist.testCategories.regression.length > 0) {
      result += `- Regression tests prevent issues that occurred before\n`;
    }
    
    result += `- Consider adding property-based tests for complex logic\n`;
    
    return {
      content: [
        {
          type: 'text',
          text: result,
        },
      ],
    };
  }
);

// Register multi-agent workspace tools
// REMOVED: Now handled by workspace-tools.ts
/* server.registerTool(
  'devlog_workspace_status',
  {
    title: 'Workspace Status',
    description: 'Check current workspace and detect multi-agent conflicts',
    inputSchema: {},
  },
  async (): Promise<CallToolResult> => {
    const workspace = await getCurrentWorkspace();
    
    if (!workspace.exists) {
      return {
        content: [
          {
            type: 'text',
            text: '❌ No current workspace found. Use devlog_workspace_claim to create one.',
          },
        ],
      };
    }
    
    const { agentId, lastActive, sessionStart } = parseAgentFromContent(workspace.content!);
    const currentAgent = await generateAgentId();
    
    let result = '📊 **Workspace Status**\n\n';
    result += `- **Current Agent**: ${agentId || 'Unknown'}\n`;
    result += `- **Last Active**: ${lastActive || 'Unknown'}\n`;
    result += `- **Session Start**: ${sessionStart || 'Unknown'}\n`;
    result += `- **Requesting Agent**: ${currentAgent}\n`;
    
    // Calculate current session duration if available
    if (sessionStart) {
      const duration = calculateSessionDuration(sessionStart, new Date());
      result += `- **Current Session Duration**: ${duration.formattedDuration}\n`;
    }
    
    if (agentId && agentId !== currentAgent) {
      // Check if workspace is stale (older than 30 minutes)
      const lastActiveTime = lastActive ? new Date(lastActive.replace(/h/, ':')) : new Date(0);
      const now = new Date();
      const diffMinutes = (now.getTime() - lastActiveTime.getTime()) / (1000 * 60);
      
      if (diffMinutes > 30) {
        result += `\n⚠️ **STALE WORKSPACE** (${Math.round(diffMinutes)} minutes old)\n`;
        result += `- Workspace appears abandoned\n`;
        result += `- Safe to claim with devlog_workspace_claim\n`;
      } else {
        result += `\n🚨 **ACTIVE CONFLICT**\n`;
        result += `- Another agent is actively using this workspace\n`;
        result += `- Consider using devlog_workspace_claim with force=true\n`;
      }
    } else {
      result += `\n✅ **SAFE TO USE**\n`;
      result += `- Workspace available or owned by you\n`;
    }
    
    return {
      content: [
        {
          type: 'text',
          text: result,
        },
      ],
    };
  }
); */

/* server.registerTool(
  'devlog_workspace_claim',
  {
    title: 'Claim Workspace',
    description: 'Claim the current workspace for this agent',
    inputSchema: {
      force: z.boolean().optional().describe('Force claim even if another agent is active'),
      sessionId: z.string().optional().describe('Optional session identifier'),
    },
  },
  async ({ force = false, sessionId }): Promise<CallToolResult> => {
    const workspace = await getCurrentWorkspace();
    const currentAgent = await generateAgentId();
    const now = new Date();
    const timestamp = `${now.getFullYear()}-${(now.getMonth() + 1).toString().padStart(2, '0')}-${now.getDate().toString().padStart(2, '0')}-${now.getHours().toString().padStart(2, '0')}h${now.getMinutes().toString().padStart(2, '0')}`;
    const sessionStartTime = now.toISOString();
    
    if (workspace.exists && workspace.content) {
      const { agentId, lastActive, sessionStart } = parseAgentFromContent(workspace.content);
      
      if (agentId && agentId !== currentAgent && !force) {
        const lastActiveTime = lastActive ? new Date(lastActive.replace(/h/, ':')) : new Date(0);
        const diffMinutes = (new Date().getTime() - lastActiveTime.getTime()) / (1000 * 60);
        
        if (diffMinutes <= 30) {
          const currentDuration = sessionStart ? calculateSessionDuration(sessionStart, new Date()) : null;
          return {
            content: [
              {
                type: 'text',
                text: `🚨 **WORKSPACE CONFLICT**\n\nAgent ${agentId} is still active (${Math.round(diffMinutes)} minutes ago).\n${currentDuration ? `Current session duration: ${currentDuration.formattedDuration}\n` : ''}Use force=true to override.`,
              },
            ],
          };
        }
      }
      
      // Update existing workspace with session start time
      let updatedContent = workspace.content
        .replace(/agent_id:\s*"?[^"\n]+"?/, `agent_id: "${currentAgent}"`)
        .replace(/last_active:\s*"?[^"\n]+"?/, `last_active: "${timestamp}"`);
      
      // Add session start time if not present
      if (!updatedContent.includes('session_start:')) {
        updatedContent = updatedContent.replace(
          /last_active:\s*"?[^"\n]+"?/,
          `last_active: "${timestamp}"\nsession_start: "${sessionStartTime}"`
        );
      } else {
        updatedContent = updatedContent.replace(
          /session_start:\s*"?[^"\n]+"?/,
          `session_start: "${sessionStartTime}"`
        );
      }
      
      await fs.writeFile(workspace.path, updatedContent);
      
      return {
        content: [
          {
            type: 'text',
            text: `✅ **WORKSPACE CLAIMED**\n\nAgent: ${currentAgent}\nTimestamp: ${timestamp}\nSession Start: ${sessionStartTime}\n${sessionId ? `Session: ${sessionId}` : ''}`,
          },
        ],
      };
    }
    
    // Create new workspace
    const newWorkspace = `---
title: "Current Workspace"
date: "${timestamp}"
agent_id: "${currentAgent}"
last_active: "${timestamp}"
session_start: "${sessionStartTime}"
${sessionId ? `session_id: "${sessionId}"` : ''}
tags:
  type: session
  scope: [active-work]
  status: active
  multi_agent: true
---

# Current Workspace - ${timestamp} (Agent: ${currentAgent})

## 🎯 Today's Focus
- [ ] New task

## 🚧 In Progress  
- [ ] Active work item

## 💭 Quick Notes & Ideas
- Notes and ideas

## ⏭️ Next Session
- [ ] Queue for later

## 📥 Inbox (to process)
- Items to process

## 🤖 Multi-Agent Status
- **Current Agent**: ${currentAgent}
- **Session Start**: ${sessionStartTime}
- **Active Tasks**: [List active tasks]
- **Conflicts**: None detected

---
*Last Update: ${timestamp} by ${currentAgent}*
`;
    
    await fs.writeFile(workspace.path, newWorkspace);
    
    return {
      content: [
        {
          type: 'text',
          text: `✅ **NEW WORKSPACE CREATED**\n\nAgent: ${currentAgent}\nTimestamp: ${timestamp}\nSession Start: ${sessionStartTime}`,
        },
      ],
    };
  }
); */

/* server.registerTool(
  'devlog_workspace_dump',
  {
    title: 'Dump Workspace',
    description: 'Save current workspace to daily session and create clean workspace',
    inputSchema: {
      reason: z.string().describe('Reason for dumping workspace'),
    },
  },
  async ({ reason }): Promise<CallToolResult> => {
    const workspace = await getCurrentWorkspace();
    
    if (!workspace.exists || !workspace.content) {
      return {
        content: [
          {
            type: 'text',
            text: '❌ No workspace to dump. Create one first with devlog_workspace_claim.',
          },
        ],
      };
    }
    
    const { agentId, sessionStart } = parseAgentFromContent(workspace.content);
    const now = new Date();
    
    // Calculate session duration
    const duration = calculateSessionDuration(sessionStart, now);
    
    // Extract main focus from current workspace
    const mainFocus = await extractMainFocusFromContent(workspace.content) || 'general-work';
    
    // Generate descriptive filename with day of week
    const sessionFile = generateDescriptiveFilename({
      type: 'session',
      topic: mainFocus,
      date: now
    });
    const sessionPath = path.join(DEVLOG_PATH, 'daily', sessionFile);
    
    // Ensure daily directory exists
    await fs.mkdir(path.dirname(sessionPath), { recursive: true });
    
    // Create session dump
    const dateStr = now.toISOString().split('T')[0];
    const dayName = now.toLocaleDateString('en-US', { weekday: 'long' });
    const startTimeStr = sessionStart ? new Date(sessionStart).toTimeString().slice(0, 5) : 'Unknown';
    const endTimeStr = now.toTimeString().slice(0, 5);
    
    const sessionContent = `---
title: "Session: ${mainFocus}"
date: "${now.toISOString()}"
agent_id: "${agentId}"
dump_reason: "${reason}"
session_start: "${sessionStart || 'Unknown'}"
session_end: "${now.toISOString()}"
duration_minutes: ${duration.durationMinutes}
duration_hours: ${duration.durationHours}
tags:
  type: session
  scope: [${detectScopes(workspace.content)}]
  status: completed
  focus: "${mainFocus}"
  duration: "${duration.formattedDuration}"
---

# Session: ${mainFocus}

**Date**: ${dateStr} (${dayName})
**Start Time**: ${startTimeStr}
**End Time**: ${endTimeStr}
**Duration**: ${duration.formattedDuration}
**Agent**: ${agentId}
**Reason**: ${reason}

## Session Timing
- **Started**: ${sessionStart || 'Unknown'}
- **Ended**: ${now.toISOString()}
- **Duration**: ${duration.formattedDuration} (${duration.durationMinutes} minutes / ${duration.durationHours} hours)

## Summary
${extractSessionSummary(workspace.content)}

## Workspace Content at Time of Dump

${workspace.content}

---
*Dumped by ${agentId} at ${now.toISOString()} (Duration: ${duration.formattedDuration})*
`;
    
    await fs.writeFile(sessionPath, sessionContent);
    
    // Create clean workspace
    const newTimestamp = now.toISOString().slice(0, 10).replace(/-/g, '');
    const newSessionStart = now.toISOString();
    const cleanWorkspace = `---
title: "Current Workspace"
date: "${newTimestamp}"
agent_id: "${agentId}"
last_active: "${now.toISOString()}"
session_start: "${newSessionStart}"
tags:
  type: session
  scope: [active-work]
  status: active
  multi_agent: true
---

# Current Workspace - ${newTimestamp} (Agent: ${agentId})

## 🎯 Today's Focus
- [ ] New task

## 🚧 In Progress  
- [ ] Active work item

## 💭 Quick Notes & Ideas
- Previous session dumped: ${reason} (Duration: ${duration.formattedDuration})

## ⏭️ Next Session
- [ ] Queue for later

## 📥 Inbox (to process)
- Items to process

## 🤖 Multi-Agent Status
- **Current Agent**: ${agentId}
- **Session Start**: ${newSessionStart}
- **Previous Session**: Dumped to ${sessionFile} (${duration.formattedDuration})
- **Conflicts**: None detected

---
*Last Update: ${newTimestamp} by ${agentId}*
`;
    
    await fs.writeFile(workspace.path, cleanWorkspace);
    
    return {
      content: [
        {
          type: 'text',
          text: `✅ **WORKSPACE DUMPED**\n\nSession saved to: daily/${sessionFile}\nDuration: ${duration.formattedDuration} (${duration.durationMinutes} minutes)\nReason: ${reason}\nNew clean workspace created with fresh session timer.`,
        },
      ],
    };
  }
); */

// Register tag query tool
server.registerTool(
  'devlog_query_by_tags',
  {
    title: 'Query by Tags',
    description: 'Find devlog entries by specific tag combinations',
    inputSchema: {
      tags: z.record(z.any()).describe('Tag filters as key-value pairs (e.g., {"type": "decision", "status": "implemented", "impact": ["ux", "functionality"]})'),
      limit: z.number().optional().default(20),
    },
  },
  async ({ tags, limit }): Promise<CallToolResult> => {
    const results = await searchDevlogs('', 'all', tags);
    const limited = results.slice(0, limit);
    
    if (limited.length === 0) {
      return {
        content: [
          {
            type: 'text',
            text: `No entries found matching tags: ${JSON.stringify(tags, null, 2)}`,
          },
        ],
      };
    }
    
    return {
      content: [
        {
          type: 'text',
          text: `📋 Found ${results.length} entries matching tags:\n${JSON.stringify(tags, null, 2)}\n\n` +
            limited.map((r, i) => {
              const tagStr = Object.entries(r.tags).map(([k, v]) => 
                Array.isArray(v) ? `${k}: [${v.join(', ')}]` : `${k}: ${v}`
              ).join('\n  ');
              return `${i + 1}. **${r.title || r.file}**\n  File: ${r.file}\n  Date: ${r.date || r.lastModified.toISOString().split('T')[0]}\n  Tags:\n  ${tagStr}\n  Preview: ${r.excerpt}`;
            }).join('\n\n'),
        },
      ],
    };
  }
);

// Register tag statistics tool
server.registerTool(
  'devlog_tag_stats',
  {
    title: 'Tag Statistics',
    description: 'Get statistics about tag usage across devlogs',
    inputSchema: {
      tagKey: z.string().optional().describe('Specific tag key to analyze (e.g., "type", "status", "priority")'),
    },
  },
  async ({ tagKey }): Promise<CallToolResult> => {
    const results = await searchDevlogs('', 'all');
    const tagStats: Record<string, Record<string, number>> = {};
    
    // Collect tag statistics
    for (const result of results) {
      if (!result.tags) continue;
      
      for (const [key, value] of Object.entries(result.tags)) {
        if (tagKey && key !== tagKey) continue;
        
        if (!tagStats[key]) tagStats[key] = {};
        
        if (Array.isArray(value)) {
          for (const v of value) {
            const vStr = String(v);
            tagStats[key][vStr] = (tagStats[key][vStr] || 0) + 1;
          }
        } else {
          const valueStr = String(value);
          tagStats[key][valueStr] = (tagStats[key][valueStr] || 0) + 1;
        }
      }
    }
    
    let report = `📊 Tag Statistics from ${results.length} files:\n\n`;
    
    for (const [key, values] of Object.entries(tagStats)) {
      const sorted = Object.entries(values).sort((a, b) => b[1] - a[1]);
      report += `**${key}**:\n`;
      for (const [value, count] of sorted) {
        report += `  - ${value}: ${count} occurrences\n`;
      }
      report += '\n';
    }
    
    return {
      content: [
        {
          type: 'text',
          text: report,
        },
      ],
    };
  }
);

// Register tag values tool
server.registerTool(
  'devlog_list_tag_values',
  {
    title: 'List Tag Values',
    description: 'List all unique values for a specific tag key',
    inputSchema: {
      tagKey: z.string().describe('Tag key to list values for (e.g., "type", "status", "scope")'),
    },
  },
  async ({ tagKey }): Promise<CallToolResult> => {
    const results = await searchDevlogs('', 'all');
    const values = new Set<string>();
    
    for (const result of results) {
      if (!result.tags || !result.tags[tagKey]) continue;
      
      const tagValue = result.tags[tagKey];
      if (Array.isArray(tagValue)) {
        tagValue.forEach((v) => values.add(String(v)));
      } else {
        values.add(String(tagValue));
      }
    }
    
    const sortedValues = Array.from(values).sort();
    
    return {
      content: [
        {
          type: 'text',
          text: `📋 Unique values for tag "${tagKey}":\n\n${sortedValues.map(v => `- ${v}`).join('\n')}\n\nTotal: ${sortedValues.length} unique values`,
        },
      ],
    };
  }
);

// Register feature planning tool with research options
server.registerTool(
  'devlog_plan_feature',
  {
    title: 'Plan Feature',
    description: 'Create a comprehensive feature plan with optional research',
    inputSchema: {
      feature: z.string().describe('Feature name or description'),
      approach: z.enum(['use_existing_research', 'do_new_research', 'plan_only', 'use_docs']).describe('Planning approach'),
      research_query: z.string().optional().describe('Query for new research (if do_new_research)'),
      doc_links: z.array(z.string()).optional().describe('Documentation links to analyze (if use_docs)'),
      context: z.string().optional().describe('Additional context or requirements'),
    },
  },
  async ({ feature, approach, research_query, doc_links, context }): Promise<CallToolResult> => {
    let researchData: ResearchItem[] | null = null;
    let planContent = '';
    
    // Step 1: Gather research based on approach
    if (approach === 'use_existing_research') {
      // Search for existing research in devlogs
      const existingResearch = await searchDevlogs(feature, 'all', { type: 'research' });
      if (existingResearch.length > 0) {
        researchData = existingResearch.map(r => ({
          source: r.file,
          content: r.parsedContent || r.fullContent,
          findings: (r.tags?.key_findings as string[]) || []
        }));
        planContent += `📚 Found ${existingResearch.length} existing research entries\n\n`;
      } else {
        planContent += `⚠️ No existing research found for "${feature}"\n\n`;
      }
    } else if (approach === 'do_new_research') {
      planContent += `🔍 Research Approach Selected\n`;
      planContent += `Query: "${research_query || feature}"\n\n`;
      planContent += `**Suggested Research Steps**:\n`;
      planContent += `1. Use Perplexity MCP for current best practices:\n`;
      planContent += `   mcp: perplexity_ask "${research_query || feature} best practices 2024"\n\n`;
      planContent += `2. Search for implementation examples:\n`;
      planContent += `   mcp: perplexity_ask "${feature} implementation tutorial React TypeScript"\n\n`;
      planContent += `3. Check for Forge/Jira specific constraints:\n`;
      planContent += `   mcp: perplexity_ask "Atlassian Forge ${feature} limitations API"\n\n`;
      planContent += `4. After research, run: mcp: devlog_capture_research\n\n`;
      return { content: [{ type: 'text', text: planContent }] };
    } else if (approach === 'use_docs' && doc_links) {
      planContent += `📖 Documentation Analysis Requested\n`;
      planContent += `Links to analyze: ${doc_links.length}\n\n`;
      // In real implementation, would fetch and analyze docs
    }
    
    // Step 2: Analyze codebase for patterns and conflicts
    const codebaseAnalysis = await analyzeCodebaseForFeature(feature);
    
    // Step 3: Generate comprehensive plan
    planContent += `# 📋 Feature Plan: ${feature}\n\n`;
    
    planContent += `## 🎯 Overview\n`;
    planContent += `Feature: ${feature}\n`;
    if (context) planContent += `Context: ${context}\n`;
    planContent += `\n`;
    
    // Add research summary if available
    if (researchData) {
      planContent += `## 📚 Research Summary\n`;
      researchData.forEach((r: ResearchItem) => {
        planContent += `- ${r.source}: ${r.findings.slice(0, 3).join(', ')}\n`;
      });
      planContent += `\n`;
    }
    
    planContent += `## 🏗️ Implementation Checklist\n`;
    planContent += codebaseAnalysis.checklist.map((item: string) => `- [ ] ${item}`).join('\n');
    planContent += `\n\n`;
    
    planContent += `## ⚠️ Potential Conflicts\n`;
    if (codebaseAnalysis.conflicts.length > 0) {
      planContent += codebaseAnalysis.conflicts.map((c) => `- ${c.component}: ${c.reason}`).join('\n');
    } else {
      planContent += `- No conflicts detected\n`;
    }
    planContent += `\n`;
    
    planContent += `## 🔗 Related Components\n`;
    planContent += codebaseAnalysis.components.map((c: string) => `- ${c}`).join('\n');
    planContent += `\n`;
    
    planContent += `## 🧪 Test Scenarios\n`;
    planContent += codebaseAnalysis.testScenarios.map((t: string) => `- ${t}`).join('\n');
    planContent += `\n`;
    
    planContent += `## 📝 Next Steps\n`;
    planContent += `1. Review this plan\n`;
    planContent += `2. Run: mcp: devlog_create_feature "${feature}"\n`;
    planContent += `3. Start implementation with first checklist item\n`;
    
    return {
      content: [
        {
          type: 'text',
          text: planContent,
        },
      ],
    };
  }
);

// Helper function to analyze codebase
async function analyzeCodebaseForFeature(feature: string): Promise<CodebaseAnalysis> {
  // Search for similar patterns, potential conflicts, etc.
  const featureLower = feature.toLowerCase();
  const checklist = [];
  const conflicts = [];
  const components = [];
  const testScenarios = [];
  
  // Basic heuristics for common features
  if (featureLower.includes('export')) {
    checklist.push(
      'Add export button to UI',
      'Create export service',
      'Handle different export formats (CSV, JSON)',
      'Add progress indicator',
      'Test with large datasets',
      'Add error handling'
    );
    components.push('TaskDataGrid.tsx', 'exportService.ts', 'forge/resolvers/exportResolver.ts');
    testScenarios.push('Export with filters', 'Export 1000+ items', 'Export with custom fields');
  }
  
  if (featureLower.includes('bulk')) {
    checklist.push(
      'Implement batch processing',
      'Add progress tracking',
      'Handle rate limits',
      'Implement rollback on failure'
    );
    conflicts.push({ component: 'API rate limits', reason: 'Forge has strict rate limits' });
  }
  
  if (featureLower.includes('permission') || featureLower.includes('auth')) {
    checklist.push(
      'Define permission model',
      'Add permission checks to API',
      'Update UI based on permissions',
      'Add permission management UI',
      'Test all permission combinations'
    );
    components.push('authService.ts', 'permissionMiddleware.ts', 'UserContext.tsx');
  }
  
  // Search for existing similar features
  const similarFeatures = await searchDevlogs(feature, 'features');
  if (similarFeatures.length > 0) {
    conflicts.push({ 
      component: 'Similar features exist', 
      reason: `Found ${similarFeatures.length} similar implementations` 
    });
  }
  
  return { checklist, conflicts, components, testScenarios };
}

// Register research capture tool
server.registerTool(
  'devlog_capture_research',
  {
    title: 'Capture Research',
    description: 'Save research findings from Perplexity, Claude, or other sources',
    inputSchema: {
      feature: z.string().describe('Feature being researched'),
      sources: z.array(z.object({
        tool: z.string().describe('Tool used (perplexity, claude, web, etc)'),
        query: z.string().describe('Search query used'),
        key_findings: z.array(z.string()).describe('Important findings'),
        links: z.array(z.string()).optional().describe('Useful links found'),
        code_snippets: z.array(z.string()).optional().describe('Code examples found'),
        warnings: z.array(z.string()).optional().describe('Gotchas or limitations discovered'),
      })).describe('Research sources and findings'),
      synthesis: z.string().optional().describe('Overall synthesis of research'),
    },
  },
  async ({ feature, sources, synthesis }): Promise<CallToolResult> => {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 16).replace('T', '-').replace(/-/g, (m, i) => i === 10 ? 'h' : '-') + 'm';
    const filename = `research-${feature.toLowerCase().replace(/\s+/g, '-')}.md`;
    const filepath = path.join(DEVLOG_PATH, 'research', `${timestamp}-${filename}`);
    
    let content = `---
title: "${feature} Research"
date: "${timestamp}"
tags:
  type: research
  scope: [${feature.toLowerCase().replace(/\s+/g, '-')}]
  priority: high
  status: completed
  tools_used: [${sources.map(s => s.tool).join(', ')}]
  research_iterations: ${sources.length}
  confidence: high
---

# ${feature} Research - ${new Date().toISOString().split('T')[0]}

## Research Summary

`;
    
    sources.forEach((source, idx) => {
      content += `### ${idx + 1}. ${source.tool}: "${source.query}"\n\n`;
      content += `**Key Findings**:\n`;
      source.key_findings.forEach(f => content += `- ${f}\n`);
      content += `\n`;
      
      if (source.links && source.links.length > 0) {
        content += `**Useful Links**:\n`;
        source.links.forEach(l => content += `- ${l}\n`);
        content += `\n`;
      }
      
      if (source.code_snippets && source.code_snippets.length > 0) {
        content += `**Code Examples**:\n`;
        source.code_snippets.forEach(c => content += `\`\`\`javascript\n${c}\n\`\`\`\n`);
        content += `\n`;
      }
      
      if (source.warnings && source.warnings.length > 0) {
        content += `**⚠️ Warnings**:\n`;
        source.warnings.forEach(w => content += `- ${w}\n`);
        content += `\n`;
      }
    });
    
    if (synthesis) {
      content += `## 🎯 Synthesis\n\n${synthesis}\n`;
    }
    
    // Create research directory if it doesn't exist
    await fs.mkdir(path.dirname(filepath), { recursive: true });
    await fs.writeFile(filepath, content);
    
    return {
      content: [
        {
          type: 'text',
          text: `✅ Research captured successfully!\n\nSaved to: ${filepath}\n\nNext steps:\n1. Run: mcp: devlog_synthesize_plan "${feature}"\n2. Or: mcp: devlog_plan_feature "${feature}" approach="use_existing_research"`,
        },
      ],
    };
  }
);

// Register what's next tool
server.registerTool(
  'devlog_whats_next',
  {
    title: "What's Next",
    description: 'Get prioritized list of next tasks based on current state',
    inputSchema: {
      context: z.string().optional().describe('Current context or time available'),
    },
  },
  async ({ context }): Promise<CallToolResult> => {
    // Get all incomplete work
    const pending = await searchDevlogs('', 'all', { status: ['planned', 'in-progress', 'blocked'] });
    // const features = await searchDevlogs('', 'features');
    
    // Analyze current workspace
    // const workspace = await getCurrentWorkspace();
    
    let suggestions = `# 🎯 What's Next?\n\n`;
    
    if (context) {
      suggestions += `Context: ${context}\n\n`;
    }
    
    // Check for in-progress work
    const inProgress = pending.filter(p => p.tags?.status === 'in-progress');
    if (inProgress.length > 0) {
      suggestions += `## 🚧 Continue In-Progress Work\n`;
      inProgress.forEach(item => {
        suggestions += `- **${item.title || item.file}**\n`;
        suggestions += `  Last updated: ${item.lastModified.toISOString().split('T')[0]}\n`;
        if (item.tags?.checklist_progress) {
          suggestions += `  Progress: ${item.tags.checklist_progress}\n`;
        }
        suggestions += `  Next: mcp: devlog_feature_progress "${item.title}"\n\n`;
      });
    }
    
    // Suggest high-priority planned work
    const highPriority = pending.filter(p => 
      p.tags?.status === 'planned' && 
      p.tags?.priority === 'high'
    );
    
    if (highPriority.length > 0) {
      suggestions += `## 🔥 High Priority Items\n`;
      highPriority.forEach(item => {
        suggestions += `- **${item.title || item.file}**\n`;
        if (item.tags?.estimated_effort) {
          suggestions += `  Estimated: ${item.tags.estimated_effort}\n`;
        }
        suggestions += `  Start: mcp: devlog_plan_feature "${item.title}" approach="use_existing_research"\n\n`;
      });
    }
    
    // Check for blockers that might be resolved
    const blocked = pending.filter(p => p.tags?.status === 'blocked');
    if (blocked.length > 0) {
      suggestions += `## 🚫 Blocked Items (check if unblocked)\n`;
      blocked.forEach(item => {
        suggestions += `- **${item.title}** - ${item.tags?.blocked_reason || 'Unknown reason'}\n`;
      });
      suggestions += `\n`;
    }
    
    // Quick wins
    const quickWins = pending.filter(p => 
      p.tags?.estimated_effort === '1h' || 
      p.tags?.size === 'small'
    );
    
    if (quickWins.length > 0) {
      suggestions += `## ⚡ Quick Wins (< 1 hour)\n`;
      quickWins.forEach(item => {
        suggestions += `- ${item.title || item.file}\n`;
      });
      suggestions += `\n`;
    }
    
    suggestions += `## 🔧 Useful Commands\n`;
    suggestions += `- See all pending: mcp: search_devlogs "" tags={"status": "planned"}\n`;
    suggestions += `- Check regressions: mcp: devlog_regression_history "component"\n`;
    suggestions += `- Start new feature: mcp: devlog_plan_feature "feature-name" approach="do_new_research"\n`;
    
    return {
      content: [
        {
          type: 'text',
          text: suggestions,
        },
      ],
    };
  }
);

// Register workspace tools with tracking
workspaceTools.forEach(tool => {
  server.registerTool(
    tool.name,
    {
      title: tool.title,
      description: tool.description,
      inputSchema: tool.inputSchema,
    },
    withToolTracking(tool.name, tool.handler)
  );
});

// Register task tracking tools
taskTrackingTools.forEach(tool => {
  server.registerTool(
    tool.name,
    {
      title: tool.title,
      description: tool.description,
      inputSchema: tool.inputSchema,
    },
    withToolTracking(tool.name, tool.handler)
  );
});

// Register issue tracking tools
issueTrackingTools.forEach(tool => {
  server.registerTool(
    tool.name,
    {
      title: tool.title,
      description: tool.description,
      inputSchema: tool.inputSchema,
    },
    withToolTracking(tool.name, tool.handler)
  );
});

// Register feature tracking tools
featureTrackingTools.forEach(tool => {
  server.registerTool(
    tool.name,
    {
      title: tool.title,
      description: tool.description,
      inputSchema: tool.inputSchema,
    },
    withToolTracking(tool.name, tool.handler)
  );
});

// Register weekly integration tools
weeklyIntegrationTools.forEach(tool => {
  server.registerTool(
    tool.name,
    {
      title: tool.title,
      description: tool.description,
      inputSchema: tool.inputSchema,
    },
    withToolTracking(tool.name, tool.handler)
  );
});

// Register backup recovery tools
backupRecoveryTools.forEach(tool => {
  server.registerTool(
    tool.name,
    {
      title: tool.title,
      description: tool.description,
      inputSchema: tool.inputSchema,
    },
    withToolTracking(tool.name, tool.handler)
  );
});

// Start the server
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  
  // Check if devlog is initialized
  const devlogExists = await isDevlogInitialized();
  
  if (!devlogExists) {
    console.error('⚠️  DevLog not initialized in this project!');
    console.error('   Run "devlog_init" to create devlog structure.');
    console.error('   Current path:', DEVLOG_PATH);
  } else {
    console.error('✅ DevLog MCP Server v3.0 running with time tracking...');
    console.error('   DevLog path:', DEVLOG_PATH);
  }
}

main().catch((error) => {
  console.error('Server error:', error);
  process.exit(1);
});