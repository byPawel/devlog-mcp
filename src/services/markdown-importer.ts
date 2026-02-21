/**
 * Markdown Importer
 *
 * Imports Markdown files (including OpenClaw MEMORY.md format) into
 * the devlog SQLite database. Supports:
 * - OpenClaw MEMORY.md -> research/decision docs
 * - OpenClaw daily logs (YYYY-MM-DD.md) -> session docs
 * - Generic markdown with YAML frontmatter -> auto-detected doc type
 */
import * as path from 'node:path';

type DocFormat = 'openclaw-memory' | 'openclaw-daily' | 'markdown';

interface Frontmatter {
  title?: string;
  status?: string;
  tags?: string[];
  docType?: string;
  priority?: string;
  [key: string]: unknown;
}

interface ParseResult {
  frontmatter: Frontmatter;
  content: string;
}

export function parseMarkdownFrontmatter(raw: string): ParseResult {
  const fmRegex = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/;
  const match = raw.match(fmRegex);
  if (!match) return { frontmatter: {}, content: raw };

  const yamlBlock = match[1];
  const content = match[2];
  const frontmatter: Frontmatter = {};

  for (const line of yamlBlock.split('\n')) {
    const kvMatch = line.match(/^(\w+):\s*(.+)$/);
    if (kvMatch) {
      const key = kvMatch[1];
      let value: unknown = kvMatch[2].trim();
      if (typeof value === 'string' && value.startsWith('[') && value.endsWith(']')) {
        value = value.slice(1, -1).split(',').map(s => s.trim());
      }
      frontmatter[key] = value;
    }
  }

  return { frontmatter, content };
}

export class MarkdownImporter {
  static detectFormat(_content: string, filename: string): DocFormat {
    const basename = path.basename(filename, path.extname(filename));
    if (['MEMORY', 'SOUL', 'USER', 'IDENTITY'].includes(basename.toUpperCase())) {
      return 'openclaw-memory';
    }
    if (/^\d{4}-\d{2}-\d{2}$/.test(basename)) {
      return 'openclaw-daily';
    }
    return 'markdown';
  }

  static docTypeFromFormat(format: DocFormat): string {
    switch (format) {
      case 'openclaw-memory': return 'research';
      case 'openclaw-daily': return 'session';
      case 'markdown': return 'note';
    }
  }

  static titleFromFilename(filename: string, content: string): string {
    const headerMatch = content.match(/^#\s+(.+)$/m);
    if (headerMatch) return headerMatch[1].trim();
    return path.basename(filename, path.extname(filename));
  }
}
