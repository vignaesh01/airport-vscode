import * as vscode from 'vscode'
import { AGENTS } from './agents'
import { listShells } from './shells'
import { FAVORITE_AGENT_SETTING, orderAgentsForPicker, toggleFavorite } from './favorite-agent'

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

type AgentPickItem = vscode.QuickPickItem & { value: string }

const STAR_BUTTON: vscode.QuickInputButton = {
  iconPath: new vscode.ThemeIcon('star-empty'),
  tooltip: 'Set as favourite agent'
}
const UNSTAR_BUTTON: vscode.QuickInputButton = {
  iconPath: new vscode.ThemeIcon('star-full'),
  tooltip: 'Remove favourite agent'
}

/** The favourite agent's id, or undefined if none (or an unknown id) is configured. */
export function getFavoriteAgent(): string | undefined {
  const id = vscode.workspace.getConfiguration('airport').get<string>(FAVORITE_AGENT_SETTING)
  return AGENTS.some((a) => a.id === id) ? id : undefined
}

/**
 * Saves the favourite to the most specific scope that already defines it, so a
 * workspace-level override isn't silently shadowing a user-level write.
 */
async function setFavoriteAgent(id: string | undefined): Promise<void> {
  const config = vscode.workspace.getConfiguration('airport')
  const inspected = config.inspect<string>(FAVORITE_AGENT_SETTING)
  const target =
    inspected?.workspaceFolderValue !== undefined
      ? vscode.ConfigurationTarget.WorkspaceFolder
      : inspected?.workspaceValue !== undefined
        ? vscode.ConfigurationTarget.Workspace
        : vscode.ConfigurationTarget.Global
  await config.update(FAVORITE_AGENT_SETTING, id ?? '', target)
}

function buildAgentItems(favoriteId: string | undefined): AgentPickItem[] {
  return orderAgentsForPicker(AGENTS, favoriteId).map(({ agent, isFavorite }) => ({
    label: isFavorite ? `$(star-full) ${agent.label}` : agent.label,
    description: isFavorite ? 'favourite' : undefined,
    value: agent.id,
    buttons: [isFavorite ? UNSTAR_BUTTON : STAR_BUTTON]
  }))
}

/**
 * Agent picker with a star button on every row: the favourite floats to the
 * top and is preselected, so Enter picks it.
 */
export function pickAgent(title = 'Airport: New terminal — pick an agent'): Promise<string | undefined> {
  return new Promise((resolve) => {
    const qp = vscode.window.createQuickPick<AgentPickItem>()
    qp.title = title
    qp.placeholder = 'Which agent should run in this terminal? (☆ sets your favourite)'

    const render = (favoriteId: string | undefined, keepActive?: string): void => {
      const items = buildAgentItems(favoriteId)
      qp.items = items
      const active = items.find((i) => i.value === keepActive) ?? items[0]
      if (active) qp.activeItems = [active]
    }
    render(getFavoriteAgent())

    let result: string | undefined
    qp.onDidTriggerItemButton(async ({ item }) => {
      const next = toggleFavorite(getFavoriteAgent(), item.value)
      qp.busy = true
      try {
        await setFavoriteAgent(next)
      } finally {
        qp.busy = false
      }
      render(next, item.value)
    })
    qp.onDidAccept(() => {
      result = qp.selectedItems[0]?.value
      qp.hide()
    })
    qp.onDidHide(() => {
      qp.dispose()
      resolve(result)
    })
    qp.show()
  })
}
