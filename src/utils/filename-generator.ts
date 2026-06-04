/**
 * Filename generation utilities for dokoro
 * Generates descriptive filenames with day-of-week
 */

import * as path from 'path';
import * as fs from 'fs/promises';
import matter from 'gray-matter';

export interface FilenameOptions {
  type: 'session' | 'feature' | 'decision' | 'research' | 'analysis' | 'bugfix';
  topic?: string;
  date?: Date;
}

/**
 * Generate a descriptive filename with day-of-week
 * Format: YYYY-MM-DD-HHhMM-dayname-type-topic.md
 * Example: 2025-06-26-09h33-wednesday-feature-state-management.md
 */
export function generateFilename(options: FilenameOptions): string {
  const now = options.date || new Date();
  
  // Date components
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  const hour = String(now.getHours()).padStart(2, '0');
  const minute = String(now.getMinutes()).padStart(2, '0');
  
  // Day of week
  const dayName = now.toLocaleDateString('en-US', { weekday: 'long' }).toLowerCase();
  
  // Build filename parts
  const parts = [
    `${year}-${month}-${day}`,
    `${hour}h${minute}`,
    dayName,
    options.type
  ];
  
  // Add topic if provided
  if (options.topic) {
    // Sanitize topic for filename
    const sanitizedTopic = options.topic
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .substring(0, 50); // Limit length
    
    if (sanitizedTopic) {
      parts.push(sanitizedTopic);
    }
  }
  
  return parts.join('-') + '.md';
}

/**
 * Extract main focus from current.md to generate descriptive filename
 */
export async function extractMainFocus(dokoroPath: string): Promise<string | undefined> {
  try {
    const currentPath = path.join(dokoroPath, 'current.md');
    const content = await fs.readFile(currentPath, 'utf-8');
    const parsed = matter(content);
    
    // Try to extract from various sources
    // 1. From frontmatter task
    if (parsed.data.task) {
      return parsed.data.task;
    }
    
    // 2. From Current Focus section
    const focusMatch = content.match(/## 🎯 (?:Current Focus|Today's Focus)\s*\n+(?:- \[.\] )?(.+)/);
    if (focusMatch) {
      return focusMatch[1].trim();
    }
    
    // 3. From first In Progress item
    const progressMatch = content.match(/## 🚧 In Progress\s*\n+(?:- \[.\] )?(.+)/);
    if (progressMatch) {
      return progressMatch[1].trim();
    }
    
    // 4. From active todo items
    const todoMatch = content.match(/- \[x?\] (.+)/);
    if (todoMatch) {
      return todoMatch[1].trim();
    }
    
    return undefined;
  } catch {
    // No current.md or error reading it
    return undefined;
  }
}

/**
 * Generate session filename based on current work
 */
export async function generateSessionFilename(dokoroPath: string): Promise<string> {
  const mainFocus = await extractMainFocus(dokoroPath);
  
  return generateFilename({
    type: 'session',
    topic: mainFocus || 'general-work'
  });
}

/**
 * Detect the type of work from content
 */
export function detectWorkType(content: string): FilenameOptions['type'] {
  const lowerContent = content.toLowerCase();
  
  if (lowerContent.includes('bug') || lowerContent.includes('fix') || lowerContent.includes('issue')) {
    return 'bugfix';
  }
  
  if (lowerContent.includes('research') || lowerContent.includes('investigate') || lowerContent.includes('explore')) {
    return 'research';
  }
  
  if (lowerContent.includes('decision') || lowerContent.includes('chose') || lowerContent.includes('decided')) {
    return 'decision';
  }
  
  if (lowerContent.includes('analysis') || lowerContent.includes('analyze') || lowerContent.includes('review')) {
    return 'analysis';
  }
  
  if (lowerContent.includes('feature') || lowerContent.includes('implement') || lowerContent.includes('add')) {
    return 'feature';
  }
  
  return 'session';
}

/**
 * Migration helper: Add day-of-week to existing filename
 */
export function addDayToFilename(oldFilename: string): string | null {
  // Match pattern: YYYY-MM-DD-HHhMM-rest.md
  const match = oldFilename.match(/^(\d{4}-\d{2}-\d{2})-(\d{2}h\d{2})-(.+)\.md$/);
  
  if (!match) {
    return null; // Doesn't match expected pattern
  }
  
  const [, dateStr, timeStr, rest] = match;
  const date = new Date(dateStr);
  
  // Get day of week
  const dayName = date.toLocaleDateString('en-US', { weekday: 'long' }).toLowerCase();
  
  // Reconstruct filename
  return `${dateStr}-${timeStr}-${dayName}-${rest}.md`;
}