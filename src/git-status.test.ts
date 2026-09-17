import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import simpleGit from 'simple-git'
import { buildAncestorCodes, getGitStatus, normalizePath, statusCode } from './git-status'

describe('statusCode', () => {
  it('joins the index and worktree columns', () => {
    expect(statusCode('M', ' ')).toBe('M ')
    expect(statusCode(' ', 'M')).toBe(' M')
    expect(statusCode('?', '?')).toBe('??')
  })
})

describe('buildAncestorCodes', () => {
  const root = normalizePath(join(tmpdir(), 'airport-ancestor-codes-fake-root'))

  it('marks every ancestor directory up to, but not including, the root', () => {
    const codes = new Map([[normalizePath(join(root, 'a', 'b', 'c.txt')), ' M']])
    const ancestors = buildAncestorCodes(root, codes)
    expect(ancestors.get(normalizePath(join(root, 'a', 'b')))).toBe(' M')
    expect(ancestors.get(normalizePath(join(root, 'a')))).toBe(' M')
    expect(ancestors.has(root)).toBe(false)
  })

  it('does not mark unrelated sibling directories', () => {
    const codes = new Map([[normalizePath(join(root, 'src', 'file.ts')), ' M']])
    const ancestors = buildAncestorCodes(root, codes)
    expect(ancestors.has(normalizePath(join(root, 'src2')))).toBe(false)
  })

  it('keeps the worst (most severe) code when descendants differ', () => {
    const codes = new Map([
      [normalizePath(join(root, 'a', 'modified.txt')), ' M'],
      [normalizePath(join(root, 'a', 'conflicted.txt')), 'UU']
    ])
    const ancestors = buildAncestorCodes(root, codes)
    expect(ancestors.get(normalizePath(join(root, 'a')))).toBe('UU')
  })
})

describe('getGitStatus', () => {
  let dir: string

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), 'airport-git-status-'))
    const git = simpleGit(dir)
    await git.init()
    await git.addConfig('user.email', 'test@example.com')
    await git.addConfig('user.name', 'Test')

    writeFileSync(join(dir, 'committed.txt'), 'v1')
    await git.add('committed.txt')
    await git.commit('initial')

    writeFileSync(join(dir, 'committed.txt'), 'v2') // unstaged modification
    writeFileSync(join(dir, 'staged.txt'), 'new') // staged addition
    await git.add('staged.txt')
    writeFileSync(join(dir, 'untracked.txt'), 'new') // untracked
  })

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('returns null for a non-repo folder', async () => {
    const other = mkdtempSync(join(tmpdir(), 'airport-not-a-repo-'))
    try {
      expect(await getGitStatus(other)).toBeNull()
    } finally {
      rmSync(other, { recursive: true, force: true })
    }
  })

  it('classifies unstaged, staged, and untracked files by absolute path', async () => {
    const status = await getGitStatus(dir)
    expect(status).not.toBeNull()
    // Keyed off status.root (not the raw `dir` used to open the repo) since on
    // Windows the OS temp dir can be reported in short (8.3) form while git
    // resolves the real long-form path — both point at the same directory.
    const root = status?.root ?? dir
    expect(status?.codes.get(normalizePath(join(root, 'committed.txt')))).toBe(' M')
    expect(status?.codes.get(normalizePath(join(root, 'staged.txt')))).toBe('A ')
    expect(status?.codes.get(normalizePath(join(root, 'untracked.txt')))).toBe('??')
  })

  it('resolves paths relative to the repo root even when called on a subfolder', async () => {
    const { mkdirSync } = await import('node:fs')
    const sub = join(dir, 'sub')
    mkdirSync(sub)
    writeFileSync(join(sub, 'nested.txt'), 'x')

    const [fromRoot, fromSub] = await Promise.all([getGitStatus(dir), getGitStatus(sub)])
    expect(fromSub?.root).toBe(fromRoot?.root)
    expect(fromSub?.codes.get(normalizePath(join(fromSub?.root ?? sub, 'sub', 'nested.txt')))).toBe('??')
  })

  it('matches even when the lookup path differs in slash direction or drive-letter case', async () => {
    const status = await getGitStatus(dir)
    const raw = join(status?.root ?? dir, 'staged.txt')
    const mixedSlashes = raw.replace(/\\/g, '/')
    const swappedCase = raw[0] === raw[0].toUpperCase() ? raw[0].toLowerCase() + raw.slice(1) : raw[0].toUpperCase() + raw.slice(1)
    expect(status?.codes.get(normalizePath(mixedSlashes))).toBe('A ')
    expect(status?.codes.get(normalizePath(swappedCase))).toBe('A ')
  })
})
