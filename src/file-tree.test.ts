import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { listDirectory } from './file-tree'

describe('listDirectory', () => {
  let dir: string

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'airport-file-tree-'))
    writeFileSync(join(dir, 'b.txt'), '')
    writeFileSync(join(dir, 'a.txt'), '')
    mkdirSync(join(dir, 'zeta'))
    mkdirSync(join(dir, 'alpha'))
  })

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('lists directories before files', async () => {
    const entries = await listDirectory(dir)
    const dirCount = entries.filter((e) => e.isDirectory).length
    expect(entries.slice(0, dirCount).every((e) => e.isDirectory)).toBe(true)
    expect(entries.slice(dirCount).every((e) => !e.isDirectory)).toBe(true)
  })

  it('sorts each section alphabetically', async () => {
    const entries = await listDirectory(dir)
    const dirs = entries.filter((e) => e.isDirectory).map((e) => e.name)
    const files = entries.filter((e) => !e.isDirectory).map((e) => e.name)
    expect(dirs).toEqual(['alpha', 'zeta'])
    expect(files).toEqual(['a.txt', 'b.txt'])
  })

  it('returns full fsPath for each entry', async () => {
    const entries = await listDirectory(dir)
    const alpha = entries.find((e) => e.name === 'alpha')
    expect(alpha?.fsPath).toBe(join(dir, 'alpha'))
  })
})
