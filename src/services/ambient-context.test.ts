import { AmbientContextService } from './ambient-context.js';

describe('AmbientContextService', () => {
  test('extracts keywords from branch name', () => {
    const keywords = AmbientContextService.branchToKeywords('feat/add-auth-system');
    expect(keywords).toContain('auth');
    expect(keywords).toContain('system');
    expect(keywords).not.toContain('feat');
    expect(keywords).not.toContain('add');
  });

  test('extracts keywords from commit messages', () => {
    const commits = ['fix: resolve login timeout issue', 'feat: add session management'];
    const keywords = AmbientContextService.commitsToKeywords(commits);
    expect(keywords).toContain('login');
    expect(keywords).toContain('timeout');
    expect(keywords).toContain('session');
  });

  test('extracts keywords from changed file paths', () => {
    const files = ['src/auth/login.ts', 'src/auth/session.ts'];
    const keywords = AmbientContextService.filesToKeywords(files);
    expect(keywords).toContain('auth');
    expect(keywords).toContain('login');
    expect(keywords).toContain('session');
  });

  test('builds search query from git context', () => {
    const ctx = {
      branch: 'feat/user-auth',
      recentCommits: ['add login page', 'fix session timeout'],
      changedFiles: ['src/auth/login.ts'],
    };
    const query = AmbientContextService.buildSearchQuery(ctx);
    expect(query.length).toBeGreaterThan(5);
    expect(query).toContain('auth');
  });
});
