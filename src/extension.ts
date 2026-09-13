import * as vscode from 'vscode'
import { SessionManager } from './session-manager'
import { SessionTreeProvider } from './session-tree-provider'
import { SessionFilesProvider } from './session-files-provider'
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
      // Makes this session active (so the Files view, which always follows
      // the active session, switches to its folder) and brings that view to
      // the front — entirely in the current window. Never touches
      // vscode.workspace state: adding/removing workspace folders can
      // reopen the window (or open a new one) on a single-folder window,
      // which is unacceptable for something this routine.
      manager.setActive(session.id)
      void vscode.commands.executeCommand(`${FILES_VIEW_ID}.focus`)
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
