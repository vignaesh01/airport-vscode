import simpleGit from 'simple-git'
import { dirname, join, resolve } from 'node:path'

/**
 * Two-letter git status code, same convention `git status --porcelain` uses:
 * index (staged) column first, worktree (unstaged) column second, ' ' for
 * unchanged. '??' is untracked, 'UU'-style codes are conflicts.
 */
export type FileGitCode = string

export interface GitStatusInfo {
  /** Repo root, used to resolve porcelain paths (which are root-relative, not cwd-relative). */
  root: string
  branch: string | null
  /** Absolute fsPath -> two-letter status code. Clean/committed files are absent. */
  codes: Map<string, FileGitCode>
  /**
   * Absolute fsPath -> worst status code among that directory's changed
   * descendants (any depth). Lets a folder like `src` show a color without
   * needing its children enumerated first — a tree view only calls
   * `getChildren` once a node is expanded, so relying on decoration
   * propagation from discovered children leaves collapsed folders uncolored
   * until first expand. Excludes the repo root itself, which the panel keeps
   * neutral (its label already carries the branch name).
   */
  ancestorCodes: Map<string, FileGitCode>
}

/**
 * Ranks codes worst-to-best for folder rollup: a folder shows the color of
 * its most "severe" changed descendant. Mirrors the priority order used to
 * pick a color for a single code (conflicted > untracked > added > deleted >
 * renamed > modified).
 */
function severity(code: FileGitCode): number {
  const [index, workingDir] = code
  if (code === '??') return 1
  if (index === 'U' || workingDir === 'U') return 0
  if (index === 'A' || workingDir === 'A') return 2
  if (index === 'D' || workingDir === 'D') return 3
  if (index === 'R' || workingDir === 'R') return 4
  return 5
}

/** Builds the ancestor rollup described on `GitStatusInfo.ancestorCodes`. */
export function buildAncestorCodes(root: string, codes: Map<string, FileGitCode>): Map<string, FileGitCode> {
  const rootKey = normalizePath(root)
  const ancestors = new Map<string, FileGitCode>()
  for (const [filePath, code] of codes) {
    let dir = dirname(filePath)
    // `dir.startsWith(rootKey)` (not just `dir !== rootKey`) makes termination
    // structural rather than dependent on exact string equality with rootKey
    // — protects against e.g. a trailing separator mismatch walking the loop
    // all the way up a drive.
    while (dir !== rootKey && dir.startsWith(rootKey)) {
      const existing = ancestors.get(dir)
      if (!existing || severity(code) < severity(existing)) ancestors.set(dir, code)
      const parent = dirname(dir)
      if (parent === dir) break // reached a filesystem root — never loop
      dir = parent
    }
  }
  return ancestors
}

/** Builds the two-letter porcelain-style code for one file from simple-git's parsed columns. */
export function statusCode(index: string, workingDir: string): FileGitCode {
  return `${index}${workingDir}`
}

/**
 * Normalizes a path for use as a `codes` map key/lookup. `root` comes from
 * `git rev-parse` while tree entries come from `fs.readdir` starting at the
 * terminal's own folder string — two independently-sourced strings for the
 * same directory that can differ in slash direction or drive-letter case on
 * Windows. Resolving + lower-casing (Windows only, where the filesystem is
 * case-insensitive) makes lookups match despite that.
 */
export function normalizePath(p: string): string {
  const resolved = resolve(p)
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved
}

/**
 * Reads git status for `folder`, which may be any directory (not necessarily a
 * workspace folder or the repo root) — this panel tracks the active terminal's
 * folder, which can point anywhere on disk. Returns null when `folder` isn't
 * inside a git repo.
 */
export async function getGitStatus(folder: string): Promise<GitStatusInfo | null> {
  try {
    const git = simpleGit(folder)
    if (!(await git.checkIsRepo())) return null
    const root = (await git.revparse(['--show-toplevel'])).trim()
    const status = await git.status()
    const codes = new Map<string, FileGitCode>()
    for (const file of status.files) {
      codes.set(normalizePath(join(root, file.path)), statusCode(file.index, file.working_dir))
    }
    return { root, branch: status.current ?? null, codes, ancestorCodes: buildAncestorCodes(root, codes) }
  } catch {
    return null
  }
}
