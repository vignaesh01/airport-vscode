import { spawn } from 'child_process'
import * as vscode from 'vscode'
import { TerminalManager } from './terminal-manager'
import { TerminalTreeProvider } from './terminal-tree-provider'
import { TerminalFilesProvider } from './terminal-files-provider'
import { registerFileCommands } from './file-commands'
import { runNewTerminalFlow, pickAgent } from './new-terminal-flow'
import type { TerminalRecord } from './terminal'

const VIEW_ID = 'airport.terminals'
const FILES_VIEW_ID = 'airport.files'

export function activate(context: vscode.ExtensionContext): void {
  const manager = new TerminalManager(context)
  context.subscriptions.push(manager)

  const treeProvider = new TerminalTreeProvider(manager)
  context.subscriptions.push(treeProvider)
  const treeView = vscode.window.createTreeView(VIEW_ID, {
    treeDataProvider: treeProvider,
    showCollapseAll: false
  })
  context.subscriptions.push(treeView)

  const filesProvider = new TerminalFilesProvider(manager)
  const filesView = vscode.window.createTreeView(FILES_VIEW_ID, {
    treeDataProvider: filesProvider,
    showCollapseAll: true
  })
  context.subscriptions.push(filesView)
  registerFileCommands(context, filesProvider)
  context.subscriptions.push(
    vscode.commands.registerCommand('airport.filesRefresh', () => filesProvider.refresh())
  )

  const updateHasActiveTerminalContext = (): void => {
    void vscode.commands.executeCommand('setContext', 'airport.hasActiveTerminal', manager.getActiveId() !== null)
  }
  context.subscriptions.push(manager.onDidChange(updateHasActiveTerminalContext))
  updateHasActiveTerminalContext()

  const updateNotificationsEnabledContext = (): void => {
    void vscode.commands.executeCommand('setContext', 'airport.notificationsEnabled', manager.notificationsOn)
  }
  context.subscriptions.push(manager.onDidChange(updateNotificationsEnabledContext))
  updateNotificationsEnabledContext()

  const updateOsNotificationsEnabledContext = (): void => {
    void vscode.commands.executeCommand('setContext', 'airport.osNotificationsEnabled', manager.osNotificationsOn)
  }
  context.subscriptions.push(manager.onDidChange(updateOsNotificationsEnabledContext))
  updateOsNotificationsEnabledContext()

  const updateBadge = (): void => {
    const count = manager.needsYouCount()
    treeView.badge =
      count > 0 ? { value: count, tooltip: `${count} terminal${count === 1 ? '' : 's'} need${count === 1 ? 's' : ''} you` } : undefined
  }
  context.subscriptions.push(manager.onDidChange(updateBadge))
  updateBadge()

  context.subscriptions.push(
    vscode.commands.registerCommand('airport.newTerminal', async () => {
      const choice = await runNewTerminalFlow()
      if (!choice) return
      manager.create(choice.folder, choice.agentId, choice.shellPath)
    }),

    vscode.commands.registerCommand('airport.selectTerminal', (terminal: TerminalRecord) => {
      manager.setActive(terminal.id)
    }),

    vscode.commands.registerCommand('airport.closeTerminal', (terminal: TerminalRecord) => {
      manager.close(terminal.id)
    }),

    vscode.commands.registerCommand('airport.duplicateTerminal', (terminal: TerminalRecord) => {
      manager.create(terminal.folder, terminal.agentId, terminal.shellPath)
    }),

    vscode.commands.registerCommand('airport.duplicateTerminalWithAgent', async (terminal: TerminalRecord) => {
      const agentId = await pickAgent()
      if (!agentId) return
      manager.create(terminal.folder, agentId, terminal.shellPath)
    }),

    vscode.commands.registerCommand('airport.viewFolder', (terminal: TerminalRecord) => {
      // revealFileInOS opens the folder's *parent* with the item selected
      // rather than opening the folder's contents, so the OS file manager
      // is launched directly on the terminal folder instead.
      switch (process.platform) {
        case 'win32':
          spawn('explorer.exe', [terminal.folder], { detached: true, stdio: 'ignore' }).unref()
          break
        case 'darwin':
          spawn('open', [terminal.folder], { detached: true, stdio: 'ignore' }).unref()
          break
        default:
          spawn('xdg-open', [terminal.folder], { detached: true, stdio: 'ignore' }).unref()
      }
    }),

    vscode.commands.registerCommand('airport.renameTerminal', async (terminal: TerminalRecord) => {
      const name = await vscode.window.showInputBox({
        title: 'Rename terminal',
        value: terminal.name,
        prompt: 'New name for this terminal'
      })
      if (name === undefined) return
      manager.rename(terminal.id, name)
    }),

    vscode.commands.registerCommand('airport.turnOffNotifications', () => {
      manager.toggleNotifications()
      vscode.window.setStatusBarMessage(
        `Airport notifications ${manager.notificationsOn ? 'enabled' : 'disabled'}`,
        3000
      )
    }),

    vscode.commands.registerCommand('airport.turnOnNotifications', () => {
      manager.toggleNotifications()
      vscode.window.setStatusBarMessage(
        `Airport notifications ${manager.notificationsOn ? 'enabled' : 'disabled'}`,
        3000
      )
    }),

    vscode.commands.registerCommand('airport.turnOffOsNotifications', () => {
      manager.toggleOsNotifications()
      vscode.window.setStatusBarMessage(
        `Airport OS notifications ${manager.osNotificationsOn ? 'enabled' : 'disabled'}`,
        3000
      )
    }),

    vscode.commands.registerCommand('airport.turnOnOsNotifications', () => {
      manager.toggleOsNotifications()
      vscode.window.setStatusBarMessage(
        `Airport OS notifications ${manager.osNotificationsOn ? 'enabled' : 'disabled'}`,
        3000
      )
    }),

    vscode.commands.registerCommand('airport.resumeTerminals', () => manager.resume()),
    vscode.commands.registerCommand('airport.discardResume', () => manager.discardResume())
  )

  if (manager.resumeCount > 0) {
    void manager.offerResume()
  }
}

export function deactivate(): void {
  // TerminalManager (and everything it owns) is disposed via
  // context.subscriptions — nothing else to tear down here.
}
