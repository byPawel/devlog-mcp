/**
 * Enhanced compression helper that integrates existing devlog analysis tools
 * Reuses velocity insights, timeline generation, and pattern analysis
 */

import { promises as fs } from 'fs';
import path from 'path';
import { CallToolResult } from '../types.js';
import { DEVLOG_PATH } from '../types/devlog.js';
import matter from 'gray-matter';
import { globSync } from 'glob';

interface CompressionParams {
  weekNumber?: number;
  year?: number;
  dryRun?: boolean;
}

interface SessionData {
  file: string;
  date: Date;
  content: string;
  frontmatter: Record<string, unknown>;
  summary?: string;
  completedTasks: string[];
  decisions: string[];
  insights: string[];
  title?: string;
}

// These would normally be imported, but we'll define the interface
interface VelocityMetrics {
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
  date: string;
  type: string;
  title: string;
  file: string;
  description: string;
  impact: string;
}

interface TimelineData {
  range: string;
  totalEvents: number;
  events: TimelineEvent[];
  summary: {
    featuresImplemented: number;
    decisionsLogged: number;
    postsCreated: number;
    highImpactEvents: number;
    mostActiveType: string;
  };
}

// Helper to extract title from frontmatter or content
function extractTitle(parsed: { data: Record<string, unknown>; content: string }): string {
  if (parsed.data.title && typeof parsed.data.title === 'string') return parsed.data.title;
  
  const titleMatch = parsed.content.match(/^#\s+(.+)$/m);
  return titleMatch ? titleMatch[1].trim() : '---';
}

// Reuse the week calculation logic
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

// Call existing velocity insights function
async function getWeeklyVelocity(weekStart: Date, weekEnd: Date): Promise<VelocityMetrics> {
  // This would normally call the existing generateVelocityInsights
  // For now, we'll implement a simplified version that matches the format
  
  const patterns = ['posts/**/*.md', 'daily/**/*.md', 'features/**/*.md', 'decisions/**/*.md'];
  const metrics: VelocityMetrics = {
    totalFiles: 0,
    newFiles: 0,
    updatedFiles: 0,
    featuresCompleted: 0,
    decisionsLogged: 0,
    bugsFixed: 0,
    dailySessions: 0,
    avgSessionLength: 0,
    mostActiveDay: '',
    productivity: 'MEDIUM'
  };
  
  const dailyActivity: Record<string, number> = {};
  
  for (const pattern of patterns) {
    const files = globSync(pattern, { cwd: DEVLOG_PATH });
    
    for (const file of files) {
      const filePath = path.join(DEVLOG_PATH, file);
      const stats = await fs.stat(filePath);
      
      metrics.totalFiles++;
      
      if (stats.birthtime >= weekStart && stats.birthtime <= weekEnd) {
        metrics.newFiles++;
        
        const day = stats.birthtime.toISOString().split('T')[0];
        dailyActivity[day] = (dailyActivity[day] || 0) + 1;
        
        if (file.includes('features/')) metrics.featuresCompleted++;
        if (file.includes('decisions/')) metrics.decisionsLogged++;
        if (file.includes('daily/')) metrics.dailySessions++;
      }
    }
  }
  
  // Find most active day
  const sortedDays = Object.entries(dailyActivity).sort(([,a], [,b]) => b - a);
  metrics.mostActiveDay = sortedDays[0]?.[0] || 'N/A';
  
  // Calculate productivity
  const avgFiles = metrics.newFiles / 7;
  if (avgFiles > 5) metrics.productivity = 'HIGH';
  else if (avgFiles < 2) metrics.productivity = 'LOW';
  
  return metrics;
}

// Call existing timeline function
async function getWeeklyTimeline(weekStart: Date, weekEnd: Date): Promise<TimelineData> {
  // This would normally call the existing generateDevlogTimeline
  // Simplified implementation
  
  const events: TimelineEvent[] = [];
  const folders = ['features', 'decisions', 'posts'];
  
  for (const folder of folders) {
    const pattern = path.join(DEVLOG_PATH, folder, '**/*.md');
    const files = globSync(pattern);
    
    for (const file of files) {
      const content = await fs.readFile(file, 'utf-8');
      const parsed = matter(content);
      
      const dateMatch = path.basename(file).match(/^(\d{4}-\d{2}-\d{2})/);
      if (!dateMatch) continue;
      
      const eventDate = new Date(dateMatch[1]);
      if (eventDate >= weekStart && eventDate <= weekEnd) {
        events.push({
          date: dateMatch[1],
          type: folder.toUpperCase(),
          title: extractTitle(parsed) || 'Untitled Session',
          file: path.relative(DEVLOG_PATH, file),
          description: folder === 'decisions' ? 'Architectural decision logged' : 
                      folder === 'features' ? 'Feature implemented' : 'DevLog post created',
          impact: parsed.data.priority || parsed.data.impact || 'MEDIUM'
        });
      }
    }
  }
  
  return {
    range: 'week',
    totalEvents: events.length,
    events: events.sort((a, b) => a.date.localeCompare(b.date)),
    summary: {
      featuresImplemented: events.filter(e => e.type === 'FEATURES').length,
      decisionsLogged: events.filter(e => e.type === 'DECISIONS').length,
      postsCreated: events.filter(e => e.type === 'POSTS').length,
      highImpactEvents: events.filter(e => e.impact === 'HIGH' || e.impact === 'high').length,
      mostActiveType: 'Planning'
    }
  };
}

// Extract session data with proper date handling
async function extractSessionData(files: string[]): Promise<SessionData[]> {
  const sessions: SessionData[] = [];
  
  for (const file of files) {
    const content = await fs.readFile(file, 'utf-8');
    const parsed = matter(content);
    
    // Parse date from filename (more reliable)
    const filenameMatch = path.basename(file).match(/^(\d{4}-\d{2}-\d{2})/);
    let sessionDate: Date;
    
    if (filenameMatch) {
      sessionDate = new Date(filenameMatch[1]);
    } else {
      sessionDate = new Date();
    }
    
    const session: SessionData = {
      file,
      date: sessionDate,
      content: parsed.content,
      frontmatter: parsed.data,
      title: extractTitle(parsed) || 'Untitled Session',
      completedTasks: [],
      decisions: [],
      insights: []
    };
    
    // Extract completed tasks
    const completedMatches = parsed.content.match(/- \[x\] .+/g) || [];
    session.completedTasks = completedMatches.map(m => m.replace(/- \[x\] /, ''));
    
    // Extract decisions (look for decision sections)
    if (parsed.content.includes('decision') || parsed.content.includes('Decision')) {
      session.decisions.push(session.title || 'Decision made');
    }
    
    // Extract insights
    const insightMatches = parsed.content.match(/(?:💡|learned|discovered|insight):\s*(.+)/gi) || [];
    session.insights = insightMatches.map(m => m.replace(/(?:💡|learned|discovered|insight):\s*/i, ''));
    
    sessions.push(session);
  }
  
  return sessions.sort((a, b) => a.date.getTime() - b.date.getTime());
}

// Generate the enhanced summary with analysis
async function generateAnalyticalSummary(
  sessions: SessionData[],
  weekNumber: number,
  year: number,
  velocity: VelocityMetrics,
  timeline: TimelineData,
  weekDates: { start: Date; end: Date }
): Promise<string> {
  const allCompleted = sessions.flatMap(s => s.completedTasks);
  const allInsights = sessions.flatMap(s => s.insights);
  
  // Extract focus areas
  const focusAreas = new Set<string>();
  sessions.forEach(s => {
    const tags = s.frontmatter.tags as { scope?: string | string[]; [key: string]: unknown } | undefined;
    if (tags?.scope) {
      const scopes = Array.isArray(tags.scope) 
        ? tags.scope 
        : [tags.scope];
      scopes.forEach((scope: string) => focusAreas.add(scope));
    }
  });
  
  // Group timeline events by date for better display
  const eventsByDate: Record<string, TimelineEvent[]> = {};
  timeline.events.forEach(event => {
    if (!eventsByDate[event.date]) eventsByDate[event.date] = [];
    eventsByDate[event.date].push(event);
  });
  
  return `---
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
  productivity: ${velocity.productivity.toLowerCase()}
  index_priority: high
metrics:
  filesCreated: ${velocity.newFiles}
  tasksCompleted: ${allCompleted.length}
  decisionsLogged: ${velocity.decisionsLogged}
  featuresDelivered: ${velocity.featuresCompleted}
  bugsFixed: ${velocity.bugsFixed}
---

# Week ${weekNumber} (${weekDates.start.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} - ${weekDates.end.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })})

## 📊 Velocity Analysis

**Productivity Level**: ${velocity.productivity} ${velocity.productivity === 'HIGH' ? '🚀' : velocity.productivity === 'LOW' ? '🐌' : '➡️'}

### Key Metrics
- **Files Created**: ${velocity.newFiles} (${(velocity.newFiles / 7).toFixed(1)}/day avg)
- **Tasks Completed**: ${allCompleted.length}
- **Features Delivered**: ${velocity.featuresCompleted}
- **Decisions Made**: ${velocity.decisionsLogged}
- **Bugs Fixed**: ${velocity.bugsFixed}
- **Most Active Day**: ${velocity.mostActiveDay ? new Date(velocity.mostActiveDay).toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' }) : 'N/A'}

## 📅 Week Timeline

${Object.entries(eventsByDate).map(([date, events]) => {
  const dayName = new Date(date).toLocaleDateString('en-US', { weekday: 'long' });
  return `### ${dayName}, ${date}
${events.map(e => {
  const icon = e.type === 'FEATURES' ? '🚀' : 
               e.type === 'DECISIONS' ? '🤔' : 
               e.type === 'POSTS' ? '📝' : '📋';
  const impactIcon = e.impact === 'HIGH' || e.impact === 'high' ? ' 🔥' : '';
  return `- ${icon}${impactIcon} **${e.title}**
  - 📁 \`${e.file}\`
  - ${e.description}`;
}).join('\n\n')}`;
}).join('\n\n')}

## 🎯 Major Accomplishments

${allCompleted.length > 0 ? allCompleted.slice(0, 10).map((task, i) => 
  `${i + 1}. ✅ ${task}`
).join('\n') : '- No completed tasks recorded'}
${allCompleted.length > 10 ? `\n*... and ${allCompleted.length - 10} more tasks*` : ''}

## 🤔 Key Decisions

${timeline.events.filter(e => e.type === 'DECISIONS').length > 0 ?
  timeline.events.filter(e => e.type === 'DECISIONS')
    .map(e => `- **${e.title}** (${e.date})`)
    .join('\n') :
  '- No major decisions recorded this week'}

## 💡 Insights & Learnings

${allInsights.length > 0 ? 
  allInsights.slice(0, 5).map(i => `- ${i}`).join('\n') :
  '- No specific insights captured'}

## 📈 Daily Breakdown

${sessions.map(s => {
  const dayName = s.date.toLocaleDateString('en-US', { weekday: 'long' });
  const dateStr = s.date.toISOString().split('T')[0];
  return `### ${dayName}, ${dateStr}
**${s.title || 'Daily Session'}**
- Tasks completed: ${s.completedTasks.length}
- Archive: \`archive/daily/${year}-W${String(weekNumber).padStart(2, '0')}/${path.basename(s.file)}\``;
}).join('\n\n')}

## 🔍 Week Analysis

### Productivity Insights
- **Average tasks/session**: ${sessions.length > 0 ? (allCompleted.length / sessions.length).toFixed(1) : '0'}
- **Decision density**: ${sessions.length > 0 ? (velocity.decisionsLogged / sessions.length).toFixed(1) : '0'} decisions/session
- **Primary focus**: ${Array.from(focusAreas)[0] || 'General development'}

### Recommendations
${velocity.productivity === 'HIGH' ? 
  '- Excellent momentum! Continue current practices\n- Consider documenting successful patterns' :
  velocity.productivity === 'LOW' ?
  '- Review blockers from this week\n- Consider breaking tasks into smaller chunks' :
  '- Steady progress maintained\n- Look for optimization opportunities'}

---
*Generated from ${sessions.length} daily sessions | Original files: archive/daily/${year}-W${String(weekNumber).padStart(2, '0')}/*`;
}

// Main compression function that integrates analysis
export async function compressWeekWithAnalysis(params: CompressionParams): Promise<CallToolResult> {
  const { weekNumber: inputWeekNumber, year, dryRun = false } = params;
  
  const now = new Date();
  const currentYear = year || now.getFullYear();
  
  // Calculate week number if not provided
  const weekNumber = inputWeekNumber || getWeekNumber(new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000));
  
  try {
    // Get week dates
    const weekDates = getWeekDates(currentYear, weekNumber);
    
    // Find daily files for the week
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
    
    // Extract session data
    const sessions = await extractSessionData(dailyFiles);
    
    // Get velocity metrics for the week
    const velocity = await getWeeklyVelocity(weekDates.start, weekDates.end);
    
    // Get timeline for the week
    const timeline = await getWeeklyTimeline(weekDates.start, weekDates.end);
    
    // Generate analytical summary
    const summary = await generateAnalyticalSummary(
      sessions,
      weekNumber,
      currentYear,
      velocity,
      timeline,
      weekDates
    );
    
    // File paths
    const weeklyFile = path.join(DEVLOG_PATH, 'retrospective', 'weekly', 
      `${currentYear}-W${String(weekNumber).padStart(2, '0')}-consolidated.md`);
    const archiveDir = path.join(DEVLOG_PATH, 'archive', 'daily', 
      `${currentYear}-W${String(weekNumber).padStart(2, '0')}`);
    
    if (dryRun) {
      return {
        content: [{
          type: 'text',
          text: `🔍 **Enhanced Compression Preview - Week ${weekNumber} (${weekDates.start.toDateString()} - ${weekDates.end.toDateString()})**

📁 **Files to compress**: ${dailyFiles.length}
${dailyFiles.map(f => `- ${path.basename(f)}`).join('\n')}

📊 **Velocity Analysis**:
- Productivity: ${velocity.productivity}
- Files created: ${velocity.newFiles}
- Features: ${velocity.featuresCompleted}
- Decisions: ${velocity.decisionsLogged}
- Most active: ${velocity.mostActiveDay}

📅 **Timeline**: ${timeline.totalEvents} significant events
${timeline.events.slice(0, 3).map(e => `- ${e.date}: ${e.title}`).join('\n')}
${timeline.totalEvents > 3 ? `... and ${timeline.totalEvents - 3} more events` : ''}

📈 **Session Analysis**:
- Total sessions: ${sessions.length}
- Tasks completed: ${sessions.flatMap(s => s.completedTasks).length}
- Average tasks/session: ${(sessions.flatMap(s => s.completedTasks).length / sessions.length).toFixed(1)}

📍 **Output**:
- Weekly summary: ${path.relative(process.cwd(), weeklyFile)}
- Archive to: ${path.relative(process.cwd(), archiveDir)}/

Run without --dryRun to execute compression.`
        }]
      };
    }
    
    // Create directories
    await fs.mkdir(path.dirname(weeklyFile), { recursive: true });
    await fs.mkdir(archiveDir, { recursive: true });
    
    // Write analytical summary
    await fs.writeFile(weeklyFile, summary);
    
    // Move daily files to archive
    for (const file of dailyFiles) {
      const basename = path.basename(file);
      const archivePath = path.join(archiveDir, basename);
      await fs.rename(file, archivePath);
    }
    
    return {
      content: [{
        type: 'text',
        text: `✅ **Week ${weekNumber} Compressed with Analysis!**

📊 **Velocity Metrics**:
- Productivity: ${velocity.productivity}
- Files created: ${velocity.newFiles}
- Features completed: ${velocity.featuresCompleted}
- Decisions logged: ${velocity.decisionsLogged}

📅 **Timeline Summary**:
- Total events: ${timeline.totalEvents}
- High-impact: ${timeline.summary.highImpactEvents}

📈 **Compression Results**:
- Sessions compressed: ${sessions.length}
- Tasks analyzed: ${sessions.flatMap(s => s.completedTasks).length}
- Insights captured: ${sessions.flatMap(s => s.insights).length}

📁 **Files**:
- Analytical summary: ${path.relative(DEVLOG_PATH, weeklyFile)}
- Archived to: ${path.relative(DEVLOG_PATH, archiveDir)}/

🔄 **Next Steps**:
1. Review the analytical summary
2. Run: python scripts/chromadb-smart-index.py --reindex
3. Use velocity insights for planning`
      }]
    };
  } catch (error) {
    return {
      content: [{
        type: 'text',
        text: `❌ Enhanced compression failed: ${error}`
      }]
    };
  }
}