import * as vscode from 'vscode'
import { randomUUID } from 'node:crypto'
import { AGENTS } from './agents'
import { getBranch } from './git'
import { TerminalStatusTracker } from './status-tracker'
import { shouldNotify, type TerminalStatus } from './status-engine'
import { sendOsNotification } from './os-notify'
import type { TerminalRecord, TerminalsFile } from './terminal'
import { EMPTY_TERMINALS_FILE } from './terminal'

const STORAGE_KEY = 'airport.terminals'
/**
 * Worst-case lag between the underlying condition (output actually went
 * quiet) and a poll confirming the resulting status change — see
 * status-engine.ts's NOTIFY_SETTLE_GRACE_MS for the full rationale.
 */
const NOTIFY_SETTLE_GRACE_MS = 2500

interface Runtime {
  nativeTerminal: vscode.Terminal | null
  tracker: TerminalStatusTracker
  /** undefined until the first classification arrives — see the comment where Runtime is created. */
  status: TerminalStatus | undefined
  branch: string | null
  /** Which status (if any) an OS notification was already fired for. */
  notifiedAs: TerminalStatus | undefined
  lastActiveAt: number | undefined
}

/**
 * Owns the live terminal list, one vscode.Terminal + TerminalStatusTracker per
 * terminal, and persistence across window reloads. Fires onDidChange whenever
 * anything the tree view should redraw for has changed.
 */
export class TerminalManager implements vscode.Disposable {
  private terminals: TerminalRecord[] = []
  private activeId: string | null = null
  private readonly runtime = new Map<string, Runtime>()
  private readonly disposables: vscode.Disposable[] = []
  private pendingResume: TerminalsFile | null = null
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

    const stored = context.workspaceState.get<TerminalsFile>(STORAGE_KEY, EMPTY_TERMINALS_FILE)
    if (stored.terminals.length > 0) {
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
    return this.pendingResume?.terminals.length ?? 0
  }

  async offerResume(): Promise<void> {
    if (!this.pendingResume) return
    const count = this.pendingResume.terminals.length
    const choice = await vscode.window.showInformationMessage(
      `Airport: resume ${count} terminal${count === 1 ? '' : 's'} from your last window?`,
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

  getPendingResume(): TerminalsFile | null {
    return this.pendingResume
  }

  resume(): void {
    if (!this.pendingResume) return
    const file = this.pendingResume
    this.pendingResume = null
    for (const record of file.terminals) {
      this.terminals.push(record)
      this.launch(record, false)
    }
    this.activeId = file.activeId ?? file.terminals[0]?.id ?? null
    if (this.activeId) this.runtime.get(this.activeId)?.nativeTerminal?.show(true)
    this.persist()
    this.notifyChange()
  }

  discardResume(): void {
    this.pendingResume = null
    this.persist()
    this.notifyChange()
  }

  // ---- Terminal CRUD ----

  list(): TerminalRecord[] {
    return this.terminals
  }

  getActiveId(): string | null {
    return this.activeId
  }

  statusOf(id: string): TerminalStatus {
    return this.runtime.get(id)?.status ?? 'yellow'
  }

  branchOf(id: string): string | null {
    return this.runtime.get(id)?.branch ?? null
  }

  needsYouCount(): number {
    return this.terminals.filter((s) => this.statusOf(s.id) === 'red').length
  }

  create(folder: string, agentId: string, shellPath?: string): TerminalRecord {
    const id = randomUUID()
    const record: TerminalRecord = {
      id,
      folder,
      agentId,
      name: `${agentId}-${id.slice(0, 4)}`,
      createdAt: Date.now(),
      shellPath
    }
    this.terminals.push(record)
    this.launch(record)
    this.setActive(id)
    this.persist()
    this.notifyChange()
    return record
  }

  /**
   * Runs `action` once `nativeTerminal`'s shell integration activates, or
   * after a 3s timeout if it never does (mirroring the fallback pattern from
   * VS Code's own TerminalShellIntegration.executeCommand docs) — sending the
   * command any earlier risks running it before shell integration is up,
   * which would mean its execution is never seen by
   * onDidStartTerminalShellExecution and the terminal never gets a status.
   */
  private runAfterShellIntegration(nativeTerminal: vscode.Terminal, action: () => void): void {
    if (nativeTerminal.shellIntegration) {
      action()
      return
    }
    let done = false
    const listener = vscode.window.onDidChangeTerminalShellIntegration((event) => {
      if (event.terminal !== nativeTerminal || done) return
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

  private launch(record: TerminalRecord, reveal = true): void {
    const agent = AGENTS.find((a) => a.id === record.agentId)
    const nativeTerminal = vscode.window.createTerminal({
      name: record.name,
      cwd: record.folder,
      shellPath: record.shellPath
    })

    const tracker = new TerminalStatusTracker(
      (status) => this.handleStatusChange(record.id, status),
      (title) => {
        this.output.appendLine(`[${record.name}] rename -> ${JSON.stringify(title)}`)
        this.rename(record.id, title)
      },
      agent?.renameConfirmationPattern,
      (message) => this.output.appendLine(`[${record.name}] ${message}`)
    )
    this.runtime.set(record.id, {
      nativeTerminal,
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
      // never attached and the terminal sits with no status forever. Wait for
      // this terminal's shellIntegration to come up (with the same ~3s
      // fallback the API docs recommend) before sending the command.
      this.runAfterShellIntegration(nativeTerminal, () => nativeTerminal.sendText(agent.command as string))
    }
    if (reveal) nativeTerminal.show(true)

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
    runtime?.nativeTerminal?.dispose()
    runtime?.tracker.dispose()
    this.runtime.delete(id)
    this.terminals = this.terminals.filter((s) => s.id !== id)
    if (this.activeId === id) {
      this.activeId = this.terminals[0]?.id ?? null
    }
    this.persist()
    this.notifyChange()
  }

  /**
   * Moves `id` to sit just before `beforeId` (or to the end when `beforeId`
   * is null), for drag-and-drop reordering in the tree view.
   */
  reorder(id: string, beforeId: string | null): void {
    const from = this.terminals.findIndex((s) => s.id === id)
    if (from === -1) return
    const [record] = this.terminals.splice(from, 1)
    const to = beforeId ? this.terminals.findIndex((s) => s.id === beforeId) : -1
    if (to === -1) {
      this.terminals.push(record)
    } else {
      this.terminals.splice(to, 0, record)
    }
    this.persist()
    this.notifyChange()
  }

  rename(id: string, name: string): void {
    const trimmed = name.trim()
    if (!trimmed) return
    const terminal = this.terminals.find((s) => s.id === id)
    if (!terminal || terminal.name === trimmed) return
    terminal.name = trimmed
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
    runtime?.nativeTerminal?.show()
    this.persist()
    this.notifyChange()
  }

  // ---- Event handlers ----

  private handleExecutionStart(event: vscode.TerminalShellExecutionStartEvent): void {
    const entry = [...this.runtime.entries()].find(([, r]) => r.nativeTerminal === event.terminal)
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
        // handleTerminalClosed will mark the terminal exited separately.
      }
    })()
  }

  private handleTerminalClosed(term: vscode.Terminal): void {
    const entry = [...this.runtime.entries()].find(([, r]) => r.nativeTerminal === term)
    if (!entry) return
    const [, runtime] = entry
    runtime.nativeTerminal = null
    runtime.tracker.markExited()
  }

  private handleActiveTerminalChanged(term: vscode.Terminal | undefined): void {
    const entry = [...this.runtime.entries()].find(([, r]) => r.nativeTerminal === term)
    if (!entry) return
    const [id] = entry
    if (this.activeId === id) return
    // VS Code already made this terminal active (e.g. the user clicked its
    // tab) — just update our bookkeeping. Calling setActive here would call
    // nativeTerminal.show() again, which steals keyboard focus back to the
    // terminal and, during a multi-terminal resume where several terminals
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

  private handleStatusChange(id: string, status: TerminalStatus): void {
    const runtime = this.runtime.get(id)
    if (!runtime) return
    const previousStatus = runtime.status
    runtime.status = status
    this.notifyChange()

    // notifiedAs latches which status (red/green) we've already notified for,
    // so a run of identical repeated classifications doesn't re-fire. But
    // once the terminal moves on to new work (yellow) or exits (grey), that
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
      const terminal = this.terminals.find((s) => s.id === id)
      if (terminal) {
        runtime.notifiedAs = status
        const title = status === 'red' ? 'Needs your input' : 'Task completed'
        vscode.window.showInformationMessage(`${title}: ${terminal.name}`, 'Go to terminal').then((choice) => {
          if (choice === 'Go to terminal') {
            runtime.notifiedAs = undefined
            this.setActive(id)
          }
        })
        if (this.osNotificationsEnabled) {
          sendOsNotification(title, terminal.name, (detail) => this.output.appendLine(`OS notification failed: ${detail}`))
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
    const file: TerminalsFile = { version: 1, activeId: this.activeId, terminals: this.terminals }
    this.context.workspaceState.update(STORAGE_KEY, file)
  }

  private notifyChange(): void {
    this.onDidChangeEmitter.fire()
  }
}
