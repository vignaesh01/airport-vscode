import { spawn } from 'child_process'
import { writeFile, unlink } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { randomUUID } from 'crypto'

/** Escapes a string for embedding inside a single-quoted PowerShell literal. */
function escapePowerShellString(value: string): string {
  return value.replace(/'/g, "''")
}

/** Escapes a string for embedding inside a double-quoted AppleScript literal. */
function escapeAppleScriptString(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
}

// Verified empirically: `powershell.exe -Command <multiline script>` passed as
// a single spawn argv entry is unreliable — the toast silently never shows,
// even though the very same script runs fine from a .ps1 file via `-File`.
// So the script is written to a temp file and run that way instead.
function windowsToastScript(title: string, message: string): string {
  const t = escapePowerShellString(title)
  const m = escapePowerShellString(message)
  // $ErrorActionPreference + try/catch is deliberate: a thrown .NET exception
  // from a bare method call like Show() doesn't reliably turn into a
  // non-zero powershell.exe exit code on its own, which would make a real
  // failure here (e.g. toast platform/activation issues) look identical to
  // success from the calling Node code. A unique Tag/Group also rules out
  // Windows silently deduplicating same-tag toasts instead of re-showing one.
  return `
$ErrorActionPreference = 'Stop'
try {
  $title = '${t}'
  $message = '${m}'
  [Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] > $null
  [Windows.UI.Notifications.ToastNotification, Windows.UI.Notifications, ContentType = WindowsRuntime] > $null
  [Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom, ContentType = WindowsRuntime] > $null
  $template = [Windows.UI.Notifications.ToastNotificationManager]::GetTemplateContent([Windows.UI.Notifications.ToastTemplateType]::ToastText02)
  $texts = $template.GetElementsByTagName('text')
  $texts.Item(0).AppendChild($template.CreateTextNode($title)) > $null
  $texts.Item(1).AppendChild($template.CreateTextNode($message)) > $null
  $toast = New-Object Windows.UI.Notifications.ToastNotification $template
  $toast.Tag = [guid]::NewGuid().ToString()
  $toast.Group = 'Airport'
  [Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier('Airport').Show($toast)
} catch {
  Write-Error $_.Exception.ToString()
  exit 1
}
`
}

async function sendWindowsToast(title: string, message: string, onError?: (detail: string) => void): Promise<void> {
  const scriptPath = join(tmpdir(), `airport-toast-${randomUUID()}.ps1`)
  await writeFile(scriptPath, windowsToastScript(title, message), 'utf8')
  const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', scriptPath], {
    detached: true,
    stdio: ['ignore', 'ignore', 'pipe'],
    windowsHide: true
  })
  let stderr = ''
  child.stderr?.on('data', (chunk: Buffer) => {
    stderr += chunk.toString()
  })
  child.on('error', (err) => onError?.(err.message))
  child.on('exit', (code) => {
    if (code !== 0) onError?.(`exit code ${code}${stderr ? `: ${stderr.trim()}` : ''}`)
    void unlink(scriptPath).catch(() => {})
  })
  child.unref()
}

/**
 * Best-effort native OS notification (Windows toast, macOS Notification
 * Center, Linux libnotify) — separate from and in addition to VS Code's own
 * in-app notification, so it still reaches the user when the window isn't
 * focused. Never throws: a missing binary (e.g. no notify-send on a minimal
 * Linux install) just means no toast, not a broken extension.
 *
 * @param onError optional sink for the failure diagnostics that `detached` +
 * `stdio: 'ignore'` would otherwise swallow silently — a non-zero exit code
 * or spawn error (e.g. missing binary) is reported here instead.
 */
export function sendOsNotification(title: string, message: string, onError?: (detail: string) => void): void {
  try {
    if (process.platform === 'win32') {
      // sendWindowsToast is async (writeFile before spawn) — without this
      // .catch, a rejection (e.g. writeFile failing) becomes an unhandled
      // promise rejection that Node logs to its own stderr, never reaching
      // onError or the user.
      sendWindowsToast(title, message, onError).catch((err) =>
        onError?.(err instanceof Error ? err.message : String(err))
      )
      return
    }

    const child =
      process.platform === 'darwin'
        ? spawn(
            'osascript',
            ['-e', `display notification "${escapeAppleScriptString(message)}" with title "${escapeAppleScriptString(title)}"`],
            { detached: true, stdio: ['ignore', 'ignore', 'pipe'] }
          )
        : spawn('notify-send', [title, message], { detached: true, stdio: ['ignore', 'ignore', 'pipe'] })

    let stderr = ''
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString()
    })
    // A missing binary (e.g. no notify-send on a minimal Linux install) fires
    // an async 'error' event on the child process; unhandled, that's an
    // uncaught exception that would crash the extension host.
    child.on('error', (err) => onError?.(err.message))
    child.on('exit', (code) => {
      if (code !== 0) onError?.(`exit code ${code}${stderr ? `: ${stderr.trim()}` : ''}`)
    })
    child.unref()
  } catch (err) {
    onError?.(err instanceof Error ? err.message : String(err))
  }
}
