import * as vscode from 'vscode'
import { SessionManager } from './session-manager'
import { SessionTreeProvider } from './session-tree-provider'
import { runNewSessionFlow } from './new-session-flow'
import type { SessionRecord } from './session'

const VIEW_ID = 'airport.sessions'

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

    vscode.commands.registerCommand('airport.renameSession', async (session: SessionRecord) => {
      const name = await vscode.window.showInputBox({
        title: 'Rename session',
        value: session.name,
        prompt: 'New name for this session'
      })
      if (name === undefined) return
      manager.rename(session.id, name)
    }),

    vscode.commands.registerCommand('airport.toggleNotifications', () => {
      manager.toggleNotifications()
      vscode.window.setStatusBarMessage(
        `Airport notifications ${manager.notificationsOn ? 'enabled' : 'disabled'}`,
        3000
      )
    }),

    vscode.commands.registerCommand('airport.resumeSessions', () => manager.resume()),
    vscode.commands.registerCommand('airport.discardResume', () => manager.discardResume())
  )

  // Alt+1..9 (0 for the 10th) — mirrors the numbering the rail could show,
  // bound via package.json keybindings scoped to when this view has focus.
  for (let i = 0; i < 10; i++) {
    const index = i
    context.subscriptions.push(
      vscode.commands.registerCommand(`airport.gotoSession${(i + 1) % 10}`, () => {
        const session = manager.sessionAt(index)
        if (session) manager.setActive(session.id)
      })
    )
  }

  if (manager.resumeCount > 0) {
    void manager.offerResume()
  }
}

export function deactivate(): void {
  // SessionManager (and everything it owns) is disposed via
  // context.subscriptions — nothing else to tear down here.
}
