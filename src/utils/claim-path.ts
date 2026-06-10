/**
 * Canonical claim-path normalization.
 *
 * A "claim" identifies a single file under a workspace root. The same file
 * can be spelled many ways (relative vs absolute, `./` prefixes, backslash
 * separators, NFC vs NFD Unicode, different letter case on case-insensitive
 * filesystems such as APFS). Normalizing every spelling to one canonical
 * `claimKey` guarantees one file = one claim identity in the database.
 */

import path from 'path';

/** Successful normalization result. */
export interface ClaimPathOk {
  ok: true;
  /**
   * Canonical root-relative path: POSIX separators (`/`), Unicode
   * NFC-normalized, no leading `./`, no trailing slash. Preserves the
   * caller's letter case for display.
   */
  relPath: string;
  /**
   * Casefolded DB identity key: `relPath.toLowerCase()`. On case-insensitive
   * filesystems (e.g. APFS) `Notes/Todo.MD` and `notes/todo.md` are the same
   * file, so both must map to the same claim row.
   */
  claimKey: string;
}

/** Failed normalization result. */
export interface ClaimPathError {
  ok: false;
  error: string;
}

export type ClaimPathResult = ClaimPathOk | ClaimPathError;

/**
 * Resolve `input` (absolute, or relative to `root`) to a canonical
 * root-relative claim path and its casefolded `claimKey`.
 *
 * Rejects (never throws): empty input, paths that resolve outside `root`
 * (including `..` escapes and absolute paths elsewhere — checked with a
 * trailing-separator comparison so `/root/foobar` is not treated as inside
 * `/root/foo`), and the root itself (empty relative path).
 */
export function normalizeClaimPath(input: string, root: string): ClaimPathResult {
  if (typeof input !== 'string' || input.trim() === '') {
    return { ok: false, error: 'Claim path is empty' };
  }

  // Normalize Unicode early so containment checks and outputs agree, and
  // convert backslash separators to POSIX before resolving.
  const posixInput = input.normalize('NFC').split('\\').join('/');
  const resolvedRoot = path.resolve(root.normalize('NFC'));

  const absPath = path.isAbsolute(posixInput)
    ? path.resolve(posixInput)
    : path.resolve(resolvedRoot, posixInput);

  if (absPath === resolvedRoot) {
    return { ok: false, error: `Claim path resolves to the workspace root itself: ${input}` };
  }

  // Boundary-safe containment: compare against root WITH a trailing
  // separator so a sibling like `/root/foobar` never matches `/root/foo`.
  const rootWithSep = resolvedRoot.endsWith(path.sep) ? resolvedRoot : resolvedRoot + path.sep;
  if (!absPath.startsWith(rootWithSep)) {
    return { ok: false, error: `Claim path escapes the workspace root: ${input}` };
  }

  const relPath = absPath
    .slice(rootWithSep.length)
    .split(path.sep)
    .join('/')
    .normalize('NFC');

  return { ok: true, relPath, claimKey: relPath.toLowerCase() };
}
