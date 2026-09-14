import * as path from 'path'
import * as vscode from 'vscode'
import { formatElapsed } from './format-elapsed'
import { AGENTS } from './agents'
import type { TerminalManager } from './terminal-manager'
import type { TerminalRecord } from './terminal'
import type { TerminalStatus } from './status-engine'

/**
 * Maps each status to a distinct codicon (not just a color) so the rail
 * stays readable for colorblind users and in a screenshot — mirrors the
 * Electron app's "colour is never the only encoding" rule.
 */
function iconFor(status: TerminalStatus): vscode.ThemeIcon {
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

const STATUS_LABEL: Record<TerminalStatus, string> = {
  red: 'Needs you',
  yellow: 'Working',
  green: 'Done',
  grey: 'Exited'
}

export class TerminalTreeProvider implements vscode.TreeDataProvider<TerminalRecord>, vscode.Disposable {
  private readonly onDidChangeTreeDataEmitter = new vscode.EventEmitter<TerminalRecord | undefined | void>()
  readonly onDidChangeTreeData = this.onDidChangeTreeDataEmitter.event

  constructor(private readonly manager: TerminalManager) {
    manager.onDidChange(() => this.onDidChangeTreeDataEmitter.fire())
  }

  refresh(): void {
    this.onDidChangeTreeDataEmitter.fire()
  }

  dispose(): void {
    this.onDidChangeTreeDataEmitter.dispose()
  }

  getTreeItem(terminal: TerminalRecord): vscode.TreeItem {
    const status = this.manager.statusOf(terminal.id)
    const branch = this.manager.branchOf(terminal.id)
    const folderName = path.basename(terminal.folder)
    const agentLabel = AGENTS.find((a) => a.id === terminal.agentId)?.label ?? terminal.agentId
    const item = new vscode.TreeItem(folderName, vscode.TreeItemCollapsibleState.None)
    item.id = terminal.id
    item.iconPath = iconFor(status)
    item.description = [terminal.name, branch, agentLabel].filter(Boolean).join(' · ')
    item.tooltip = `${terminal.folder}\nGit Branch : ${branch ?? 'no branch'}\n${agentLabel}\n${STATUS_LABEL[status]}\n${formatElapsed(Date.now() - terminal.createdAt)} elapsed`
    item.contextValue = 'airportTerminal'
    item.command = {
      command: 'airport.selectTerminal',
      title: 'Open terminal',
      arguments: [terminal]
    }
    return item
  }

  getChildren(): TerminalRecord[] {
    return this.manager.list()
  }
}
