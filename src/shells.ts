import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import type { ShellOption } from './shell'

const execFileAsync = promisify(execFile)

async function which(command: string): Promise<string | null> {
  try {
    const finder = process.platform === 'win32' ? 'where' : 'which'
    const { stdout } = await execFileAsync(finder, [command])
    const first = stdout.split(/\r?\n/).find((line) => line.trim().length > 0)
    return first?.trim() ?? null
  } catch {
    return null
  }
}

interface Candidate {
  id: string
  label: string
  command: string
}

const WIN32_CANDIDATES: Candidate[] = [
  { id: 'cmd', label: 'Command Prompt', command: 'cmd.exe' },
  { id: 'powershell', label: 'Windows PowerShell', command: 'powershell.exe' },
  { id: 'pwsh', label: 'PowerShell 7', command: 'pwsh.exe' },
  { id: 'gitbash', label: 'Git Bash', command: 'bash.exe' },
  { id: 'wsl', label: 'WSL', command: 'wsl.exe' }
]

const POSIX_CANDIDATES: Candidate[] = [
  { id: 'bash', label: 'Bash', command: 'bash' },
  { id: 'zsh', label: 'Zsh', command: 'zsh' },
  { id: 'fish', label: 'Fish', command: 'fish' },
  { id: 'sh', label: 'sh', command: 'sh' }
]

export async function listShells(
  platform: NodeJS.Platform = process.platform,
  env: Partial<NodeJS.ProcessEnv> = process.env,
  resolve: (command: string) => Promise<string | null> = which
): Promise<ShellOption[]> {
  const candidates = platform === 'win32' ? WIN32_CANDIDATES : POSIX_CANDIDATES

  // COMSPEC always points at a real cmd.exe on Windows — no PATH lookup needed for it.
  const comspec = platform === 'win32' ? env.COMSPEC : null

  const results = await Promise.all(
    candidates.map(async (c): Promise<ShellOption | null> => {
      const resolved = c.id === 'cmd' && comspec ? comspec : await resolve(c.command)
      return resolved ? { id: c.id, label: c.label, path: resolved } : null
    })
  )

  return results.filter((s): s is ShellOption => s !== null)
}
