import { spawn } from 'child_process'
import * as vscode from 'vscode'
import { SessionManager } from './session-manager'
import { SessionTreeProvider } from './session-tree-provider'
import { SessionFilesProvider } from './session-files-provider'
import { registerFileCommands } from './file-commands'
import { runNewSessionFlow } from './new-session-flow'
import type { SessionRecord } from './session'

const VIEW_ID = 'airport.sessions'
const FILES_VIEW_ID = 'airport.files'

export function activate(context: vscode.ExtensionContext): void {
  const manager = new SessionManager(context)
  context.subscriptions.push(manager)

  const treeProvider = new SessionTreeProvider(manager)
  context.subscriptions.push(treeProvider)
  const treeView = vscode.window.createTreeView(VIEW_ID, {
    treeDataProvider: treeProvider,
    showCollapseAll: false
  })
  context.subscriptions.push(treeView)

  const filesProvider = new SessionFilesProvider(manager)
  const filesView = vscode.window.createTreeView(FILES_VIEW_ID, {
    treeDataProvider: filesProvider,
    showCollapseAll: true
  })
  context.subscriptions.push(filesView)
  registerFileCommands(context, filesProvider)

  const updateHasActiveSessionContext = (): void => {
    void vscode.commands.executeCommand('setContext', 'airport.hasActiveSession', manager.getActiveId() !== null)
  }
  context.subscriptions.push(manager.onDidChange(updateHasActiveSessionContext))
  updateHasActiveSessionContext()

  const updateNotificationsEnabledContext = (): void => {
    void vscode.commands.executeCommand('setContext', 'airport.notificationsEnabled', manager.notificationsOn)
  }
  context.subscriptions.push(manager.onDidChange(updateNotificationsEnabledContext))
  updateNotificationsEnabledContext()

  const updateBadge = (): void => {
    const count = manager.needsYouCount()
    treeView.badge =
      count > 0 ? { value: count, tooltip: `${count} session${count === 1 ? '' : 's'} need${count === 1 ? 's' : ''} you` } : undefined
  }
  context.subscriptions.push(manager.onDidChange(updateBadge))
  updateBadge()

  context.subscriptions.push(
    vscode.commands.registerCommand('airport.newSession', async () => {
      const choice = await runNewSessionFlow()
      if (!choice) return
      manager.create(choice.folder, choice.agentId, choice.shellPath)
    }),

    vscode.commands.registerCommand('airport.selectSession', (session: SessionRecord) => {
      manager.setActive(session.id)
    }),

    vscode.commands.registerCommand('airport.closeSession', (session: SessionRecord) => {
      manager.close(session.id)
    }),

    vscode.commands.registerCommand('airport.viewFolder', (session: SessionRecord) => {
      // revealFileInOS opens the folder's *parent* with the item selected
      // rather than opening the folder's contents, so the OS file manager
      // is launched directly on the session folder instead.
      switch (process.platform) {
        case 'win32':
          spawn('explorer.exe', [session.folder], { detached: true, stdio: 'ignore' }).unref()
          break
        case 'darwin':
          spawn('open', [session.folder], { detached: true, stdio: 'ignore' }).unref()
          break
        default:
          spawn('xdg-open', [session.folder], { detached: true, stdio: 'ignore' }).unref()
      }
    }),

    vscode.commands.registerCommand('airport.renameSession', async (session: SessionRecord) => {
      const name = await vscode.window.showInputBox({
        title: 'Rename session',
        value: session.name,
        prompt: 'New name for this session'
      })
      if (name === undefined) return
      manager.rename(session.id, name)
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

    vscode.commands.registerCommand('airport.resumeSessions', () => manager.resume()),
    vscode.commands.registerCommand('airport.discardResume', () => manager.discardResume())
  )

  if (manager.resumeCount > 0) {
    void manager.offerResume()
  }
}

export function deactivate(): void {
  // SessionManager (and everything it owns) is disposed via
  // context.subscriptions — nothing else to tear down here.
}
