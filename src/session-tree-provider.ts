import * as path from 'path'
import * as vscode from 'vscode'
import { formatElapsed } from './format-elapsed'
import { AGENTS } from './agents'
import type { SessionManager } from './session-manager'
import type { SessionRecord } from './session'
import type { SessionStatus } from './status-engine'

/**
 * Maps each status to a distinct codicon (not just a color) so the rail
 * stays readable for colorblind users and in a screenshot — mirrors the
 * Electron app's "colour is never the only encoding" rule.
 */
function iconFor(status: SessionStatus): vscode.ThemeIcon {
  switch (status) {
    case 'red':
      return new vscode.ThemeIcon('bell-dot', new vscode.ThemeColor('problemsErrorIcon.foreground'))
    case 'yellow':
      return new vscode.ThemeIcon('sync', new vscode.ThemeColor('problemsWarningIcon.foreground'))
    case 'green':
      return new vscode.ThemeIcon('check', new vscode.ThemeColor('testing.iconPassed'))
    case 'grey':
      return new vscode.ThemeIcon('circle-outline', new vscode.ThemeColor('disabledForeground'))
  }
}

const STATUS_LABEL: Record<SessionStatus, string> = {
  red: 'Needs you',
  yellow: 'Working',
  green: 'Done',
  grey: 'Exited'
}

export class SessionTreeProvider implements vscode.TreeDataProvider<SessionRecord>, vscode.Disposable {
  private readonly onDidChangeTreeDataEmitter = new vscode.EventEmitter<SessionRecord | undefined | void>()
  readonly onDidChangeTreeData = this.onDidChangeTreeDataEmitter.event

  constructor(private readonly manager: SessionManager) {
    manager.onDidChange(() => this.onDidChangeTreeDataEmitter.fire())
  }

  refresh(): void {
    this.onDidChangeTreeDataEmitter.fire()
  }

  dispose(): void {
    this.onDidChangeTreeDataEmitter.dispose()
  }

  getTreeItem(session: SessionRecord): vscode.TreeItem {
    const status = this.manager.statusOf(session.id)
    const branch = this.manager.branchOf(session.id)
    const folderName = path.basename(session.folder)
    const agentLabel = AGENTS.find((a) => a.id === session.agentId)?.label ?? session.agentId
    const item = new vscode.TreeItem(folderName, vscode.TreeItemCollapsibleState.None)
    item.id = session.id
    item.iconPath = iconFor(status)
    item.description = [session.name, branch, agentLabel].filter(Boolean).join(' · ')
    item.tooltip = `${session.folder}\nGit Branch : ${branch ?? 'no branch'}\n${agentLabel}\n${STATUS_LABEL[status]}\n${formatElapsed(Date.now() - session.createdAt)} elapsed`
    item.contextValue = 'airportSession'
    item.command = {
      command: 'airport.selectSession',
      title: 'Open session',
      arguments: [session]
    }
    return item
  }

  getChildren(): SessionRecord[] {
    return this.manager.list()
  }
}
