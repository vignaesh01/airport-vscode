import * as vscode from 'vscode'
import { listDirectory, type FileEntry } from './file-tree'
import type { SessionManager } from './session-manager'

/**
 * A lightweight, read-only file tree scoped to the active session's folder —
 * built directly from the filesystem via readdir, never through
 * vscode.workspace.updateWorkspaceFolders(). That API can reopen the window
 * (or open a new one) when the current window isn't already a multi-root
 * workspace, which is unacceptable for something as routine as picking a
 * session: creating or switching a session must never touch window/workspace
 * state, only this panel's own content.
 */
export class SessionFilesProvider implements vscode.TreeDataProvider<FileEntry> {
  private readonly onDidChangeTreeDataEmitter = new vscode.EventEmitter<FileEntry | undefined | void>()
  readonly onDidChangeTreeData = this.onDidChangeTreeDataEmitter.event

  private lastFolder: string | null = null

  constructor(private readonly manager: SessionManager) {
    manager.onDidChange(() => this.refreshIfActiveFolderChanged())
  }

  /** Root of the active session's file tree — used to resolve "copy relative path". */
  activeFolder(): string | null {
    const activeId = this.manager.getActiveId()
    if (!activeId) return null
    return this.manager.list().find((s) => s.id === activeId)?.folder ?? null
  }

  private refreshIfActiveFolderChanged(): void {
    const folder = this.activeFolder()
    if (folder === this.lastFolder) return
    this.lastFolder = folder
    this.onDidChangeTreeDataEmitter.fire()
  }

  refresh(): void {
    this.onDidChangeTreeDataEmitter.fire()
  }

  getTreeItem(entry: FileEntry): vscode.TreeItem {
    const item = new vscode.TreeItem(
      entry.name,
      entry.isDirectory ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None
    )
    // Setting resourceUri (with no explicit iconPath) lets VS Code resolve
    // the icon from the user's active file-icon theme, matching the native
    // Explorer's per-file-type icons for free.
    item.resourceUri = vscode.Uri.file(entry.fsPath)
    item.contextValue = 'airportFileEntry'
    if (!entry.isDirectory) {
      item.command = { command: 'vscode.open', title: 'Open File', arguments: [item.resourceUri] }
    }
    return item
  }

  async getChildren(entry?: FileEntry): Promise<FileEntry[]> {
    const dir = entry ? entry.fsPath : this.activeFolder()
    if (!dir) return []
    try {
      return await listDirectory(dir)
    } catch {
      return []
    }
  }
}
