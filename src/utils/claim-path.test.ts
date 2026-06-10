import { normalizeClaimPath } from './claim-path.js';

const ROOT = '/tmp/claim-root';

describe('normalizeClaimPath', () => {
  it('normalizes a relative path against the root', () => {
    const r = normalizeClaimPath('notes/todo.md', ROOT);
    expect(r).toEqual({ ok: true, relPath: 'notes/todo.md', claimKey: 'notes/todo.md' });
  });

  it('converts an absolute path inside the root to a relative path', () => {
    const r = normalizeClaimPath(`${ROOT}/sub/File.MD`, ROOT);
    expect(r).toEqual({ ok: true, relPath: 'sub/File.MD', claimKey: 'sub/file.md' });
  });

  it('rejects ../ escapes above the root', () => {
    const r = normalizeClaimPath('../escape.md', ROOT);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBeTruthy();
  });

  it('rejects nested ../ escapes that resolve outside the root', () => {
    const r = normalizeClaimPath('sub/../../escape.md', ROOT);
    expect(r.ok).toBe(false);
  });

  it('rejects absolute paths outside the root', () => {
    const r = normalizeClaimPath('/elsewhere/file.md', ROOT);
    expect(r.ok).toBe(false);
  });

  it('is boundary-safe: /root/foobar is not inside /root/foo', () => {
    const rejected = normalizeClaimPath('/tmp/claim-root/foobar/x.md', '/tmp/claim-root/foo');
    expect(rejected.ok).toBe(false);
    const accepted = normalizeClaimPath('/tmp/claim-root/foo/x.md', '/tmp/claim-root/foo');
    expect(accepted).toEqual({ ok: true, relPath: 'x.md', claimKey: 'x.md' });
  });

  it('converts backslash separators to POSIX in relPath and claimKey', () => {
    const r = normalizeClaimPath('sub\\dir\\File.md', ROOT);
    expect(r).toEqual({ ok: true, relPath: 'sub/dir/File.md', claimKey: 'sub/dir/file.md' });
  });

  it('normalizes NFD input equal to NFC input (café.md)', () => {
    const nfd = normalizeClaimPath('cafe\u0301.md', ROOT); // 'e' + combining acute (NFD)
    const nfc = normalizeClaimPath('caf\u00e9.md', ROOT); // precomposed e-acute (NFC)
    expect(nfd).toEqual(nfc);
    if (nfd.ok) {
      expect(nfd.relPath).toBe('caf\u00e9.md');
      expect(nfd.claimKey).toBe('caf\u00e9.md');
    } else {
      throw new Error('expected ok result');
    }
  });

  it('casefolds claimKey but preserves display case in relPath', () => {
    const upper = normalizeClaimPath('Notes/Todo.MD', ROOT);
    const lower = normalizeClaimPath('notes/todo.md', ROOT);
    if (!upper.ok || !lower.ok) throw new Error('expected ok results');
    expect(upper.claimKey).toBe(lower.claimKey);
    expect(upper.relPath).toBe('Notes/Todo.MD');
    expect(lower.relPath).toBe('notes/todo.md');
  });

  it('casefolds non-ASCII NFC uppercase in claimKey (CAFÉ.MD)', () => {
    const r = normalizeClaimPath('CAF\u00c9.MD', ROOT); // precomposed E-acute (NFC uppercase)
    if (!r.ok) throw new Error('expected ok result');
    expect(r.claimKey).toBe('caf\u00e9.md');
    expect(r.relPath).toBe('CAF\u00c9.MD');
  });

  it('strips trailing slashes and leading ./ from relPath', () => {
    expect(normalizeClaimPath('./sub/dir/', ROOT)).toEqual({
      ok: true,
      relPath: 'sub/dir',
      claimKey: 'sub/dir',
    });
  });

  it('rejects empty and whitespace-only input', () => {
    expect(normalizeClaimPath('', ROOT).ok).toBe(false);
    expect(normalizeClaimPath('   ', ROOT).ok).toBe(false);
  });

  it('rejects the root itself (empty relPath)', () => {
    expect(normalizeClaimPath(ROOT, ROOT).ok).toBe(false);
    expect(normalizeClaimPath('.', ROOT).ok).toBe(false);
    expect(normalizeClaimPath(`${ROOT}/`, ROOT).ok).toBe(false);
  });
});
