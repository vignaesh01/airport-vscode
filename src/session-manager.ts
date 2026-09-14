import * as vscode from 'vscode'
import { randomUUID } from 'node:crypto'
import { AGENTS } from './agents'
import { getBranch } from './git'
import { SessionStatusTracker } from './status-tracker'
import { shouldNotify, type SessionStatus } from './status-engine'
import { sendOsNotification } from './os-notify'
import type { SessionRecord, SessionsFile } from './session'
import { EMPTY_SESSIONS_FILE } from './session'

const STORAGE_KEY = 'airport.sessions'
/**
 * Worst-case lag between the underlying condition (output actually went
 * quiet) and a poll confirming the resulting status change — see
 * status-engine.ts's NOTIFY_SETTLE_GRACE_MS for the full rationale.
 */
const NOTIFY_SETTLE_GRACE_MS = 2500

interface Runtime {
  terminal: vscode.Terminal | null
  tracker: SessionStatusTracker
  /** undefined until the first classification arrives — see the comment where Runtime is created. */
  status: SessionStatus | undefined
  branch: string | null
  /** Which status (if any) an OS notification was already fired for. */
  notifiedAs: SessionStatus | undefined
  lastActiveAt: number | undefined
}

/**
 * Owns the live session list, one vscode.Terminal + SessionStatusTracker per
 * session, and persistence across window reloads. Fires onDidChange whenever
 * anything the tree view should redraw for has changed.
 */
export class SessionManager implements vscode.Disposable {
  private sessions: SessionRecord[] = []
  private activeId: string | null = null
  private readonly runtime = new Map<string, Runtime>()
  private readonly disposables: vscode.Disposable[] = []
  private pendingResume: SessionsFile | null = null
  // Diagnostic channel for status-classification and rename debugging —
  // surfaced to users as "Airport" in the Output panel's dropdown.
  private readonly output = vscode.window.createOutputChannel('Airport')

  private readonly onDidChangeEmitter = new vscode.EventEmitter<void>()
  readonly onDidChange = this.onDidChangeEmitter.event

  constructor(private readonly context: vscode.ExtensionContext) {
    this.disposables.push(
      vscode.window.onDidStartTerminalShellExecution((event) => this.handleExecutionStart(event)),
      vscode.window.onDidCloseTerminal((term) => this.handleTerminalClosed(term)),
      vscode.window.onDidChangeActiveTerminal((term) => this.handleActiveTerminalChanged(term))
    )

    const stored = context.workspaceState.get<SessionsFile>(STORAGE_KEY, EMPTY_SESSIONS_FILE)
    if (stored.sessions.length > 0) {
      this.pendingResume = stored
    }
  }

  dispose(): void {
    for (const d of this.disposables) d.dispose()
    for (const runtime of this.runtime.values()) runtime.tracker.dispose()
    this.onDidChangeEmitter.dispose()
    this.output.dispose()
  }

  // ---- Resume ----

  get resumeCount(): number {
    return this.pendingResume?.sessions.length ?? 0
  }

  async offerResume(): Promise<void> {
    if (!this.pendingResume) return
    const count = this.pendingResume.sessions.length
    const choice = await vscode.window.showInformationMessage(
      `Airport: resume ${count} session${count === 1 ? '' : 's'} from your last window?`,
      'Resume',
      'Start fresh'
    )
    if (choice === 'Resume') {
      this.resume()
    } else if (choice === 'Start fresh') {
      this.pendingResume = null
      this.persist()
    }
    // If dismissed without a choice, leave pendingResume so it can still be
    // resumed later via the rail's resume affordance (getPendingResume()).
  }

  getPendingResume(): SessionsFile | null {
    return this.pendingResume
  }

  resume(): void {
    if (!this.pendingResume) return
    const file = this.pendingResume
    this.pendingResume = null
    for (const record of file.sessions) {
      this.sessions.push(record)
      this.launch(record, false)
    }
    this.activeId = file.activeId ?? file.sessions[0]?.id ?? null
    if (this.activeId) this.runtime.get(this.activeId)?.terminal?.show(true)
    this.persist()
    this.notifyChange()
  }

  discardResume(): void {
    this.pendingResume = null
    this.persist()
    this.notifyChange()
  }

  // ---- Session CRUD ----

  list(): SessionRecord[] {
    return this.sessions
  }

  getActiveId(): string | null {
    return this.activeId
  }

  statusOf(id: string): SessionStatus {
    return this.runtime.get(id)?.status ?? 'yellow'
  }

  branchOf(id: string): string | null {
    return this.runtime.get(id)?.branch ?? null
  }

  needsYouCount(): number {
    return this.sessions.filter((s) => this.statusOf(s.id) === 'red').length
  }

  create(folder: string, agentId: string, shellPath?: string): SessionRecord {
    const id = randomUUID()
    const record: SessionRecord = {
      id,
      folder,
      agentId,
      name: `${agentId}-${id.slice(0, 4)}`,
      createdAt: Date.now(),
      shellPath
    }
    this.sessions.push(record)
    this.launch(record)
    this.setActive(id)
    this.persist()
    this.notifyChange()
    return record
  }

  /**
   * Runs `action` once `terminal`'s shell integration activates, or after a
   * 3s timeout if it never does (mirroring the fallback pattern from VS
   * Code's own TerminalShellIntegration.executeCommand docs) — sending the
   * command any earlier risks running it before shell integration is up,
   * which would mean its execution is never seen by
   * onDidStartTerminalShellExecution and the session never gets a status.
   */
  private runAfterShellIntegration(terminal: vscode.Terminal, action: () => void): void {
    if (terminal.shellIntegration) {
      action()
      return
    }
    let done = false
    const listener = vscode.window.onDidChangeTerminalShellIntegration((event) => {
      if (event.terminal !== terminal || done) return
      done = true
      listener.dispose()
      clearTimeout(timeout)
      action()
    })
    const timeout = setTimeout(() => {
      if (done) return
      done = true
      listener.dispose()
      action()
    }, 3000)
  }

  private launch(record: SessionRecord, reveal = true): void {
    const agent = AGENTS.find((a) => a.id === record.agentId)
    const terminal = vscode.window.createTerminal({
      name: record.name,
      cwd: record.folder,
      shellPath: record.shellPath
    })

    const tracker = new SessionStatusTracker(
      (status) => this.handleStatusChange(record.id, status),
      (title) => {
        this.output.appendLine(`[${record.name}] rename -> ${JSON.stringify(title)}`)
        this.rename(record.id, title)
      },
      agent?.renameConfirmationPattern,
      (message) => this.output.appendLine(`[${record.name}] ${message}`)
    )
    this.runtime.set(record.id, {
      terminal,
      tracker,
      // Left undefined (not an initial status) so the first real transition
      // isn't suppressed by shouldNotify's "no prior status" guard — mirrors
      // the Electron app's prevStatusesRef, which likewise started empty.
      status: undefined,
      branch: null,
      notifiedAs: undefined,
      lastActiveAt: undefined
    })

    if (agent?.command) {
      // Shell integration isn't active the instant a terminal is created —
      // that's exactly why onDidStartTerminalShellExecution exists as a
      // separate event. Sending the command before it activates means that
      // execution never gets seen by handleExecutionStart, so read() is
      // never attached and the session sits with no status forever. Wait for
      // this terminal's shellIntegration to come up (with the same ~3s
      // fallback the API docs recommend) before sending the command.
      this.runAfterShellIntegration(terminal, () => terminal.sendText(agent.command as string))
    }
    if (reveal) terminal.show(true)

    getBranch(record.folder).then((branch) => {
      const runtime = this.runtime.get(record.id)
      if (runtime) {
        runtime.branch = branch
        this.notifyChange()
      }
    })
  }

  close(id: string): void {
    const runtime = this.runtime.get(id)
    runtime?.terminal?.dispose()
    runtime?.tracker.dispose()
    this.runtime.delete(id)
    this.sessions = this.sessions.filter((s) => s.id !== id)
    if (this.activeId === id) {
      this.activeId = this.sessions[0]?.id ?? null
    }
    this.persist()
    this.notifyChange()
  }

  rename(id: string, name: string): void {
    const trimmed = name.trim()
    if (!trimmed) return
    const session = this.sessions.find((s) => s.id === id)
    if (!session || session.name === trimmed) return
    session.name = trimmed
    this.persist()
    this.notifyChange()
  }

  setActive(id: string): void {
    const previousId = this.activeId
    if (previousId && previousId !== id) {
      const prevRuntime = this.runtime.get(previousId)
      if (prevRuntime) prevRuntime.lastActiveAt = Date.now()
    }
    this.activeId = id
    const runtime = this.runtime.get(id)
    runtime?.terminal?.show()
    this.persist()
    this.notifyChange()
  }

  // ---- Event handlers ----

  private handleExecutionStart(event: vscode.TerminalShellExecutionStartEvent): void {
    const entry = [...this.runtime.entries()].find(([, r]) => r.terminal === event.terminal)
    if (!entry) return
    const [, runtime] = entry
    const stream = event.execution.read()
    void (async () => {
      try {
        for await (const chunk of stream) {
          runtime.tracker.write(chunk)
        }
      } catch {
        // Stream errors (e.g. terminal disposed mid-read) are non-fatal —
        // handleTerminalClosed will mark the session exited separately.
      }
    })()
  }

  private handleTerminalClosed(term: vscode.Terminal): void {
    const entry = [...this.runtime.entries()].find(([, r]) => r.terminal === term)
    if (!entry) return
    const [, runtime] = entry
    runtime.terminal = null
    runtime.tracker.markExited()
  }

  private handleActiveTerminalChanged(term: vscode.Terminal | undefined): void {
    const entry = [...this.runtime.entries()].find(([, r]) => r.terminal === term)
    if (!entry) return
    const [id] = entry
    if (this.activeId === id) return
    // VS Code already made this terminal active (e.g. the user clicked its
    // tab) — just update our bookkeeping. Calling setActive here would call
    // terminal.show() again, which steals keyboard focus back to the
    // terminal and, during a multi-session resume where several terminals
    // are created in quick succession, causes visible focus "ping-pong".
    const previousId = this.activeId
    if (previousId) {
      const prevRuntime = this.runtime.get(previousId)
      if (prevRuntime) prevRuntime.lastActiveAt = Date.now()
    }
    this.activeId = id
    this.persist()
    this.notifyChange()
  }

  private handleStatusChange(id: string, status: SessionStatus): void {
    const runtime = this.runtime.get(id)
    if (!runtime) return
    const previousStatus = runtime.status
    runtime.status = status
    this.notifyChange()

    // notifiedAs latches which status (red/green) we've already notified for,
    // so a run of identical repeated classifications doesn't re-fire. But
    // once the session moves on to new work (yellow) or exits (grey), that
    // latch needs to clear — otherwise a *second* task that ends the same way
    // (e.g. green again) would be silently swallowed by "already notified as
    // green" from the first task, potentially minutes/hours earlier.
    if (status !== 'red' && status !== 'green') {
      runtime.notifiedAs = undefined
    }

    const isActiveAndFocused = vscode.window.state.focused && this.activeId === id
    if (
      shouldNotify({
        previousStatus,
        status,
        alreadyNotifiedAs: runtime.notifiedAs,
        notificationsEnabled: this.notificationsEnabled,
        isActiveAndFocused,
        now: Date.now(),
        lastActiveAt: runtime.lastActiveAt
      })
    ) {
      const session = this.sessions.find((s) => s.id === id)
      if (session) {
        runtime.notifiedAs = status
        const title = status === 'red' ? 'Needs your input' : 'Task completed'
        vscode.window.showInformationMessage(`${title}: ${session.name}`, 'Go to session').then((choice) => {
          if (choice === 'Go to session') {
            runtime.notifiedAs = undefined
            this.setActive(id)
          }
        })
        if (this.osNotificationsEnabled) {
          sendOsNotification(title, session.name, (detail) => this.output.appendLine(`OS notification failed: ${detail}`))
        }
      }
    }
  }

  // ---- Notification toggle ----

  private notificationsEnabled = true

  get notificationsOn(): boolean {
    return this.notificationsEnabled
  }

  toggleNotifications(): void {
    this.notificationsEnabled = !this.notificationsEnabled
    this.notifyChange()
  }

  private osNotificationsEnabled = true

  get osNotificationsOn(): boolean {
    return this.osNotificationsEnabled
  }

  toggleOsNotifications(): void {
    this.osNotificationsEnabled = !this.osNotificationsEnabled
    this.notifyChange()
  }

  // ---- Persistence ----

  private persist(): void {
    const file: SessionsFile = { version: 1, activeId: this.activeId, sessions: this.sessions }
    this.context.workspaceState.update(STORAGE_KEY, file)
  }

  private notifyChange(): void {
    this.onDidChangeEmitter.fire()
  }
}
