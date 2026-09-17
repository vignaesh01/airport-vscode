import * as path from 'node:path'
import * as vscode from 'vscode'
import { listDirectory, type FileEntry } from './file-tree'
import { getGitStatus, normalizePath, type GitStatusInfo } from './git-status'
import type { TerminalManager } from './terminal-manager'

/** Debounce for the folder watcher — coalesces bursts of fs events (e.g. a git checkout) into one refresh. */
const WATCH_DEBOUNCE_MS = 300

/**
 * A lightweight, read-only file tree scoped to the active terminal's folder —
 * built directly from the filesystem via readdir, never through
 * vscode.workspace.updateWorkspaceFolders(). That API can reopen the window
 * (or open a new one) when the current window isn't already a multi-root
 * workspace, which is unacceptable for something as routine as picking a
 * terminal: creating or switching a terminal must never touch window/workspace
 * state, only this panel's own content.
 *
 * The tree has a single root node (the folder itself), matching how VS Code's
 * own Explorer shows each root in a multi-root workspace — since the active
 * terminal's folder is effectively a "root" the user is switching between.
 */
export class TerminalFilesProvider
  implements vscode.TreeDataProvider<FileEntry>, vscode.FileDecorationProvider, vscode.Disposable
{
  private readonly onDidChangeTreeDataEmitter = new vscode.EventEmitter<FileEntry | undefined | void>()
  readonly onDidChangeTreeData = this.onDidChangeTreeDataEmitter.event

  private readonly onDidChangeFileDecorationsEmitter = new vscode.EventEmitter<
    vscode.Uri | vscode.Uri[] | undefined
  >()
  readonly onDidChangeFileDecorations = this.onDidChangeFileDecorationsEmitter.event

  private lastFolder: string | null = null
  private gitStatus: GitStatusInfo | null = null
  private watcher: vscode.FileSystemWatcher | null = null
  private watchDebounce: ReturnType<typeof setTimeout> | null = null

  constructor(private readonly manager: TerminalManager) {
    manager.onDidChange(() => this.refreshIfActiveFolderChanged())
  }

  /** Root of the active terminal's file tree — used to resolve "copy relative path". */
  activeFolder(): string | null {
    const activeId = this.manager.getActiveId()
    if (!activeId) return null
    return this.manager.list().find((s) => s.id === activeId)?.folder ?? null
  }

  private refreshIfActiveFolderChanged(): void {
    const folder = this.activeFolder()
    if (folder === this.lastFolder) return
    this.lastFolder = folder
    this.watchFolder(folder)
    this.gitStatus = null
    this.onDidChangeTreeDataEmitter.fire()
    this.onDidChangeFileDecorationsEmitter.fire(undefined)
    void this.reloadGitStatus(folder)
  }

  private watchFolder(folder: string | null): void {
    this.watcher?.dispose()
    this.watcher = null
    if (!folder) return
    this.watcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(folder, '**/*'))
    const onEvent = (): void => {
      if (this.watchDebounce) clearTimeout(this.watchDebounce)
      this.watchDebounce = setTimeout(() => {
        void this.reloadGitStatus(this.activeFolder())
      }, WATCH_DEBOUNCE_MS)
    }
    this.watcher.onDidCreate(onEvent)
    this.watcher.onDidChange(onEvent)
    this.watcher.onDidDelete(onEvent)
  }

  private async reloadGitStatus(folder: string | null): Promise<void> {
    const status = folder ? await getGitStatus(folder) : null
    // Folder may have changed again while the git call was in flight — discard
    // a stale result rather than let it clobber whatever landed after it.
    if (folder !== this.activeFolder()) return
    this.gitStatus = status
    this.onDidChangeTreeDataEmitter.fire()
    // undefined invalidates every decorated URI — cheap here since decoration
    // lookups are a plain map read, and it's the only way to guarantee a path
    // that went from dirty back to clean loses its color.
    this.onDidChangeFileDecorationsEmitter.fire(undefined)
  }

  refresh(): void {
    this.onDidChangeTreeDataEmitter.fire()
    void this.reloadGitStatus(this.activeFolder())
  }

  private rootEntry(folder: string): FileEntry {
    return { name: path.basename(folder) || folder, fsPath: folder, isDirectory: true }
  }

  private isRoot(entry: FileEntry): boolean {
    if (!entry.isDirectory) return false
    const folder = this.activeFolder()
    return folder !== null && normalizePath(entry.fsPath) === normalizePath(folder)
  }

  getTreeItem(entry: FileEntry): vscode.TreeItem {
    const isRoot = this.isRoot(entry)
    const item = new vscode.TreeItem(
      entry.name,
      entry.isDirectory
        ? isRoot
          ? vscode.TreeItemCollapsibleState.Expanded
          : vscode.TreeItemCollapsibleState.Collapsed
        : vscode.TreeItemCollapsibleState.None
    )
    // Setting resourceUri (with no explicit iconPath) lets VS Code resolve
    // the icon from the user's active file-icon theme, matching the native
    // Explorer's per-file-type icons for free.
    item.resourceUri = vscode.Uri.file(entry.fsPath)
    item.contextValue = isRoot ? 'airportFileRoot' : 'airportFileEntry'
    if (!entry.isDirectory) {
      item.command = { command: 'vscode.open', title: 'Open File', arguments: [item.resourceUri] }
    }
    if (isRoot && this.gitStatus?.branch) {
      item.description = this.gitStatus.branch
      item.tooltip = `${entry.fsPath}\nBranch: ${this.gitStatus.branch}`
    } else if (!entry.isDirectory) {
      const code = this.gitStatus?.codes.get(normalizePath(entry.fsPath))
      if (code) {
        item.description = code
        item.tooltip = `${entry.fsPath}\n${describeCode(code)}`
      }
    }
    return item
  }

  /**
   * Colors the label the way the built-in git decorations color the native
   * Explorer. Must stay synchronous and cache-only — VS Code calls this for
   * every resourceUri it renders anywhere (this tree, the real Explorer,
   * editor tabs, breadcrumbs), not just visible rows in this view.
   */
  provideFileDecoration(uri: vscode.Uri): vscode.FileDecoration | undefined {
    // Non-`file:` URIs (git diff views, output panels, etc.) can share the
    // same fsPath as a real file — never decorate those.
    if (uri.scheme !== 'file') return undefined
    const status = this.gitStatus
    if (!status) return undefined
    const key = normalizePath(uri.fsPath)
    const code = status.codes.get(key)
    if (code) return new vscode.FileDecoration(undefined, describeCode(code), colorForCode(code))
    // Folder rollup: computed eagerly in git-status.ts rather than relying on
    // decoration propagation, which only sees children a tree node has
    // already been expanded to fetch (see ancestorCodes' doc comment).
    // Keep the panel's own root row neutral — its label already carries the
    // branch name — even though it may sit below the repo root and would
    // otherwise pick up a color from ancestorCodes like any other folder.
    const activeFolder = this.activeFolder()
    if (activeFolder && normalizePath(activeFolder) === key) return undefined
    const ancestorCode = status.ancestorCodes.get(key)
    if (!ancestorCode) return undefined
    return new vscode.FileDecoration(undefined, 'Contains changes', colorForCode(ancestorCode))
  }

  async getChildren(entry?: FileEntry): Promise<FileEntry[]> {
    if (!entry) {
      const folder = this.activeFolder()
      return folder ? [this.rootEntry(folder)] : []
    }
    try {
      return await listDirectory(entry.fsPath)
    } catch {
      return []
    }
  }

  dispose(): void {
    this.watcher?.dispose()
    if (this.watchDebounce) clearTimeout(this.watchDebounce)
    this.onDidChangeTreeDataEmitter.dispose()
    this.onDidChangeFileDecorationsEmitter.dispose()
  }
}

/** Maps a porcelain-style XY code to the same theme colors the built-in git decorations use. */
function colorForCode(code: string): vscode.ThemeColor {
  const [index, workingDir] = code
  if (code === '??') return new vscode.ThemeColor('gitDecoration.untrackedResourceForeground')
  if (index === 'U' || workingDir === 'U') return new vscode.ThemeColor('gitDecoration.conflictingResourceForeground')
  if (index === 'A' || workingDir === 'A') return new vscode.ThemeColor('gitDecoration.addedResourceForeground')
  if (index === 'D' || workingDir === 'D') return new vscode.ThemeColor('gitDecoration.deletedResourceForeground')
  if (index === 'R' || workingDir === 'R') return new vscode.ThemeColor('gitDecoration.renamedResourceForeground')
  return new vscode.ThemeColor('gitDecoration.modifiedResourceForeground')
}

/** Expands a porcelain-style XY code into a human-readable status for the tooltip. */
function describeCode(code: string): string {
  const [index, workingDir] = code
  if (code === '??') return 'Untracked'
  if (index === 'U' || workingDir === 'U') return 'Conflicted'
  const parts: string[] = []
  if (index !== ' ') parts.push(`Staged: ${describeChar(index)}`)
  if (workingDir !== ' ') parts.push(`Unstaged: ${describeChar(workingDir)}`)
  return parts.join(', ')
}

function describeChar(ch: string): string {
  switch (ch) {
    case 'M':
      return 'Modified'
    case 'A':
      return 'Added'
    case 'D':
      return 'Deleted'
    case 'R':
      return 'Renamed'
    case 'C':
      return 'Copied'
    default:
      return ch
  }
}
