import { describe, it, expect } from 'vitest'
import { listShells } from './shells'

describe('listShells', () => {
  it('always includes cmd via COMSPEC on win32, skipping other unresolved shells', async () => {
    const resolve = async (): Promise<string | null> => null
    const result = await listShells('win32', { COMSPEC: 'C:\\Windows\\System32\\cmd.exe' }, resolve)
    expect(result).toEqual([{ id: 'cmd', label: 'Command Prompt', path: 'C:\\Windows\\System32\\cmd.exe' }])
  })

  it('includes every win32 shell that resolves', async () => {
    const resolve = async (command: string): Promise<string | null> => {
      if (command === 'powershell.exe') return 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe'
      if (command === 'pwsh.exe') return 'C:\\Program Files\\PowerShell\\7\\pwsh.exe'
      return null
    }
    const result = await listShells('win32', { COMSPEC: 'cmd.exe' }, resolve)
    expect(result.map((s) => s.id)).toEqual(['cmd', 'powershell', 'pwsh'])
  })

  it('resolves posix shells via the injected lookup, in candidate order', async () => {
    const resolve = async (command: string): Promise<string | null> => {
      if (command === 'bash') return '/bin/bash'
      if (command === 'zsh') return '/usr/bin/zsh'
      return null
    }
    const result = await listShells('linux', {}, resolve)
    expect(result).toEqual([
      { id: 'bash', label: 'Bash', path: '/bin/bash' },
      { id: 'zsh', label: 'Zsh', path: '/usr/bin/zsh' }
    ])
  })

  it('returns an empty list when nothing resolves', async () => {
    const resolve = async (): Promise<string | null> => null
    expect(await listShells('linux', {}, resolve)).toEqual([])
  })
})
