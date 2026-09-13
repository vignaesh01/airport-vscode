import * as path from 'path'
import * as vscode from 'vscode'
import type { FileEntry } from './file-tree'
import type { SessionFilesProvider } from './session-files-provider'

interface FileClipboard {
  uri: vscode.Uri
  cut: boolean
}

/** Finds a name like "foo copy" / "foo copy 2" that doesn't already exist in `dir`. */
async function uniqueDestination(dir: string, baseName: string): Promise<vscode.Uri> {
  const ext = path.extname(baseName)
  const stem = ext ? baseName.slice(0, -ext.length) : baseName

  let candidate = path.join(dir, baseName)
  for (let n = 1; ; n++) {
    try {
      await vscode.workspace.fs.stat(vscode.Uri.file(candidate))
    } catch {
      return vscode.Uri.file(candidate)
    }
    const suffix = n === 1 ? 'copy' : `copy ${n}`
    candidate = path.join(dir, `${stem} ${suffix}${ext}`)
  }
}

/**
 * Registers the file-management context-menu commands (reveal, cut/copy/paste,
 * copy path, rename, delete) for the read-only Files panel. The panel is built
 * straight from the filesystem (see SessionFilesProvider), so these operate on
 * plain fs paths via vscode.workspace.fs rather than any workspace-folder API.
 */
export function registerFileCommands(context: vscode.ExtensionContext, filesProvider: SessionFilesProvider): void {
  let clipboard: FileClipboard | null = null

  const setClipboard = (value: FileClipboard | null): void => {
    clipboard = value
    void vscode.commands.executeCommand('setContext', 'airport.fileClipboardHasContent', clipboard !== null)
  }

  context.subscriptions.push(
    vscode.commands.registerCommand('airport.file.reveal', (entry: FileEntry) => {
      void vscode.commands.executeCommand('revealFileInOS', vscode.Uri.file(entry.fsPath))
    }),

    vscode.commands.registerCommand('airport.file.copyPath', async (entry: FileEntry) => {
      await vscode.env.clipboard.writeText(entry.fsPath)
    }),

    vscode.commands.registerCommand('airport.file.copyRelativePath', async (entry: FileEntry) => {
      const root = filesProvider.activeFolder()
      await vscode.env.clipboard.writeText(root ? path.relative(root, entry.fsPath) : entry.fsPath)
    }),

    vscode.commands.registerCommand('airport.file.cut', (entry: FileEntry) => {
      setClipboard({ uri: vscode.Uri.file(entry.fsPath), cut: true })
    }),

    vscode.commands.registerCommand('airport.file.copy', (entry: FileEntry) => {
      setClipboard({ uri: vscode.Uri.file(entry.fsPath), cut: false })
    }),

    vscode.commands.registerCommand('airport.file.paste', async (entry: FileEntry) => {
      if (!clipboard) return
      const targetDir = entry.isDirectory ? entry.fsPath : path.dirname(entry.fsPath)
      const dest = await uniqueDestination(targetDir, path.basename(clipboard.uri.fsPath))
      try {
        if (clipboard.cut) {
          await vscode.workspace.fs.rename(clipboard.uri, dest, { overwrite: false })
          setClipboard(null)
        } else {
          await vscode.workspace.fs.copy(clipboard.uri, dest, { overwrite: false })
        }
      } catch (err) {
        void vscode.window.showErrorMessage(`Paste failed: ${err instanceof Error ? err.message : String(err)}`)
        return
      }
      filesProvider.refresh()
    }),

    vscode.commands.registerCommand('airport.file.rename', async (entry: FileEntry) => {
      const name = await vscode.window.showInputBox({
        title: 'Rename',
        value: entry.name,
        valueSelection: [0, entry.name.length - (path.extname(entry.name).length || 0)],
        prompt: `New name for ${entry.name}`,
        validateInput: (value) => (value.trim().length === 0 ? 'Name cannot be empty' : undefined)
      })
      if (!name || name === entry.name) return
      const dest = vscode.Uri.file(path.join(path.dirname(entry.fsPath), name))
      try {
        await vscode.workspace.fs.rename(vscode.Uri.file(entry.fsPath), dest, { overwrite: false })
      } catch (err) {
        void vscode.window.showErrorMessage(`Rename failed: ${err instanceof Error ? err.message : String(err)}`)
        return
      }
      filesProvider.refresh()
    }),

    vscode.commands.registerCommand('airport.file.delete', async (entry: FileEntry) => {
      const choice = await vscode.window.showWarningMessage(
        `Are you sure you want to delete '${entry.name}'?`,
        { modal: true },
        'Move to Recycle Bin'
      )
      if (choice !== 'Move to Recycle Bin') return
      try {
        await vscode.workspace.fs.delete(vscode.Uri.file(entry.fsPath), { recursive: true, useTrash: true })
      } catch (err) {
        void vscode.window.showErrorMessage(`Delete failed: ${err instanceof Error ? err.message : String(err)}`)
        return
      }
      filesProvider.refresh()
    })
  )
}
