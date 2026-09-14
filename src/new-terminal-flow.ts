import * as vscode from 'vscode'
import { AGENTS } from './agents'
import { listShells } from './shells'

export interface NewTerminalChoice {
  folder: string
  agentId: string
  shellPath?: string
}

const SYSTEM_DEFAULT_SHELL = '__system_default__'
const BROWSE_FOLDER = '__browse__'

/**
 * QuickPick-based folder / shell / agent picker — replaces the Electron
 * app's NewSessionDialog.tsx. Returns undefined if the user cancels any step.
 */
export async function runNewTerminalFlow(): Promise<NewTerminalChoice | undefined> {
  const folder = await pickFolder()
  if (!folder) return undefined

  const shellPath = await pickShell()
  if (shellPath === undefined) return undefined

  const agentId = await pickAgent()
  if (!agentId) return undefined

  return { folder, agentId, shellPath: shellPath === SYSTEM_DEFAULT_SHELL ? undefined : shellPath }
}

async function pickFolder(): Promise<string | undefined> {
  const workspaceFolders = vscode.workspace.workspaceFolders ?? []
  const items: (vscode.QuickPickItem & { value: string })[] = workspaceFolders.map((f) => ({
    label: `$(folder) ${f.name}`,
    description: f.uri.fsPath,
    value: f.uri.fsPath
  }))
  items.push({ label: '$(file-directory) Browse…', value: BROWSE_FOLDER })

  const picked = await vscode.window.showQuickPick(items, {
    title: 'Airport: New terminal — pick a folder',
    placeHolder: 'Select the working directory for this terminal'
  })
  if (!picked) return undefined
  if (picked.value !== BROWSE_FOLDER) return picked.value

  const result = await vscode.window.showOpenDialog({ canSelectFolders: true, canSelectMany: false })
  return result?.[0]?.fsPath
}

async function pickShell(): Promise<string | undefined> {
  const shells = await listShells()
  const items: (vscode.QuickPickItem & { value: string })[] = [
    { label: 'System default', value: SYSTEM_DEFAULT_SHELL }
  ]
  for (const s of shells) {
    items.push({ label: s.label, description: s.path, value: s.path })
  }

  const picked = await vscode.window.showQuickPick(items, {
    title: 'Airport: New terminal — pick a shell',
    placeHolder: 'Which shell should host this terminal?'
  })
  return picked?.value
}

async function pickAgent(): Promise<string | undefined> {
  const items = AGENTS.map((a) => ({ label: a.label, value: a.id }))
  const picked = await vscode.window.showQuickPick(items, {
    title: 'Airport: New terminal — pick an agent',
    placeHolder: 'Which agent should run in this terminal?'
  })
  return picked?.value
}
