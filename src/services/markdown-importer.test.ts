import { MarkdownImporter, parseMarkdownFrontmatter } from './markdown-importer.js';

describe('parseMarkdownFrontmatter', () => {
  test('extracts YAML frontmatter', () => {
    const md = `---
title: My Document
status: active
tags: [auth, backend]
---

# Content here`;

    const result = parseMarkdownFrontmatter(md);
    expect(result.frontmatter.title).toBe('My Document');
    expect(result.frontmatter.status).toBe('active');
    expect(result.frontmatter.tags).toEqual(['auth', 'backend']);
    expect(result.content).toContain('# Content here');
  });

  test('handles no frontmatter', () => {
    const md = '# Just a title\n\nSome content.';
    const result = parseMarkdownFrontmatter(md);
    expect(result.frontmatter).toEqual({});
    expect(result.content).toBe(md);
  });
});

describe('MarkdownImporter', () => {
  test('detects OpenClaw memory format', () => {
    const content = '# MEMORY\n\n## User Preferences\n- Likes TypeScript';
    const detected = MarkdownImporter.detectFormat(content, 'MEMORY.md');
    expect(detected).toBe('openclaw-memory');
  });

  test('detects OpenClaw daily log format', () => {
    const detected = MarkdownImporter.detectFormat('# Daily Log', '2026-02-21.md');
    expect(detected).toBe('openclaw-daily');
  });

  test('detects generic markdown', () => {
    const detected = MarkdownImporter.detectFormat('# Random doc', 'notes.md');
    expect(detected).toBe('markdown');
  });
});
