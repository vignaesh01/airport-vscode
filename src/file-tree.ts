import { readdir } from 'node:fs/promises'
import { join } from 'node:path'

export interface FileEntry {
  name: string
  fsPath: string
  isDirectory: boolean
}

/** Reads one directory level, directories first, both sections alphabetical. */
export async function listDirectory(dir: string): Promise<FileEntry[]> {
  const entries = await readdir(dir, { withFileTypes: true })
  return entries
    .map((e) => ({ name: e.name, fsPath: join(dir, e.name), isDirectory: e.isDirectory() }))
    .sort((a, b) => {
      if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1
      return a.name.localeCompare(b.name)
    })
}
