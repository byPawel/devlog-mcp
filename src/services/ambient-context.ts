/**
 * Ambient Context Service
 *
 * Auto-detects project context from git state and surfaces relevant
 * devlog entries. Uses execFileSync (not execSync) for shell safety.
 */
import { execFileSync } from 'node:child_process';
import * as path from 'node:path';

const STOP_WORDS = new Set([
  'feat', 'fix', 'chore', 'docs', 'refactor', 'test', 'style', 'perf',
  'ci', 'build', 'revert', 'merge', 'add', 'update', 'remove', 'delete',
  'the', 'and', 'for', 'with', 'from', 'into', 'this', 'that', 'src',
  'index', 'main', 'master', 'dev', 'develop', 'tests', 'spec',
]);

export interface GitContext {
  branch: string;
  recentCommits: string[];
  changedFiles: string[];
}

export class AmbientContextService {
  static getGitContext(cwd: string): GitContext | null {
    try {
      const branch = execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], {
        cwd,
        encoding: 'utf-8',
      }).trim();

      const commits = execFileSync('git', ['log', '--oneline', '-5', '--format=%s'], {
        cwd,
        encoding: 'utf-8',
      }).trim().split('\n').filter(Boolean);

      let changedFiles: string[] = [];
      try {
        changedFiles = execFileSync('git', ['diff', '--name-only', 'HEAD~5..HEAD'], {
          cwd,
          encoding: 'utf-8',
        }).trim().split('\n').filter(Boolean);
      } catch {
        changedFiles = execFileSync('git', ['diff', '--name-only'], {
          cwd,
          encoding: 'utf-8',
        }).trim().split('\n').filter(Boolean);
      }

      return { branch, recentCommits: commits, changedFiles };
    } catch {
      return null;
    }
  }

  static branchToKeywords(branch: string): string[] {
    return branch
      .replace(/[/_-]/g, ' ')
      .split(/\s+/)
      .map(w => w.toLowerCase())
      .filter(w => w.length > 2 && !STOP_WORDS.has(w));
  }

  static commitsToKeywords(commits: string[]): string[] {
    const words = commits
      .join(' ')
      .replace(/[^a-zA-Z\s]/g, ' ')
      .split(/\s+/)
      .map(w => w.toLowerCase())
      .filter(w => w.length > 2 && !STOP_WORDS.has(w));

    const freq = new Map<string, number>();
    for (const w of words) {
      freq.set(w, (freq.get(w) || 0) + 1);
    }

    return Array.from(freq.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([w]) => w);
  }

  static filesToKeywords(files: string[]): string[] {
    const segments = files.flatMap(f =>
      path.basename(f, path.extname(f))
        .replace(/[._-]/g, ' ')
        .split(/\s+/)
        .concat(path.dirname(f).split('/'))
    )
      .map(w => w.toLowerCase())
      .filter(w => w.length > 2 && !STOP_WORDS.has(w));

    return [...new Set(segments)].slice(0, 15);
  }

  static buildSearchQuery(ctx: GitContext): string {
    const all = [
      ...this.branchToKeywords(ctx.branch),
      ...this.branchToKeywords(ctx.branch), // double weight for branch
      ...this.commitsToKeywords(ctx.recentCommits),
      ...this.filesToKeywords(ctx.changedFiles),
    ];

    return [...new Set(all)].slice(0, 12).join(' ');
  }
}
