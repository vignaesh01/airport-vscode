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
const TERMINAL_ID_ENV = 'AIRPORT_TERMINAL_ID'
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
  /** True while this terminal is docked in the editor area (vs. the hidden Terminal panel). */
  inEditor: boolean
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
  private presentQueue: Promise<void> = Promise.resolve()
  private switching = false
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
      this.launch(record, true)
    }
    this.activeId = file.activeId ?? file.terminals[0]?.id ?? null
    if (this.activeId) this.present(this.activeId, true)
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
      shellPath,
      pinnedSession: AGENTS.find((a) => a.id === agentId)?.startCommand ? true : undefined
    }
    this.terminals.push(record)
    // Created straight into the editor area: skips the panel-open + move round trip.
    this.launch(record, false, true)
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

  private launch(record: TerminalRecord, resuming: boolean, inEditor = false): void {
    const agent = AGENTS.find((a) => a.id === record.agentId)
    // VS Code may already have restored this terminal's process on reopen
    // (persistent sessions); adopt it instead of creating a duplicate, and
    // don't re-send the agent command into a session that is still running.
    const existing = resuming ? this.findRestoredTerminal(record) : undefined
    const nativeTerminal =
      existing ??
      vscode.window.createTerminal({
        name: record.name,
        cwd: record.folder,
        shellPath: record.shellPath,
        env: { [TERMINAL_ID_ENV]: record.id },
        // Airport owns persistence (see Resume); stop VS Code from also restoring
        // these as stray empty terminals when the window reopens.
        isTransient: true,
        ...(inEditor ? { location: { viewColumn: vscode.ViewColumn.Active } } : {})
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
      lastActiveAt: undefined,
      inEditor: inEditor && !existing
    })

    if (existing) {
      // Already running; the tracker re-attaches on the next shell execution.
    } else if (agent?.command) {
      // Shell integration isn't active the instant a terminal is created —
      // that's exactly why onDidStartTerminalShellExecution exists as a
      // separate event. Sending the command before it activates means that
      // execution never gets seen by handleExecutionStart, so read() is
      // never attached and the terminal sits with no status forever. Wait for
      // this terminal's shellIntegration to come up (with the same ~3s
      // fallback the API docs recommend) before sending the command.
      const command = resuming
        ? (agent.resumeCommand?.(record.id, !!record.pinnedSession, record.folder, record.agentSessionId) ?? agent.command)
        : (agent.startCommand?.(record.id) ?? agent.command)
      this.runAfterShellIntegration(nativeTerminal, () => nativeTerminal.sendText(command as string))
    }
    if (agent?.detectSessionId && !existing && !(resuming && record.agentSessionId)) {
      this.watchForSessionId(record, agent.detectSessionId)
    }

    getBranch(record.folder).then((branch) => {
      const runtime = this.runtime.get(record.id)
      if (runtime) {
        runtime.branch = branch
        this.notifyChange()
      }
    })
  }

  /** Polls until the agent creates its session, then stores the id on the record. */
  private watchForSessionId(record: TerminalRecord, detect: NonNullable<(typeof AGENTS)[number]['detectSessionId']>): void {
    const since = Date.now()
    const timer = setInterval(() => {
      const runtime = this.runtime.get(record.id)
      if (!runtime?.nativeTerminal || Date.now() - since > 30 * 60_000) {
        clearInterval(timer)
        return
      }
      const claimed = new Set(this.terminals.map((t) => t.agentSessionId).filter((x): x is string => !!x))
      const found = detect(since, claimed)
      if (found) {
        clearInterval(timer)
        record.agentSessionId = found
        this.output.appendLine(`[${record.name}] session id ${found}`)
        this.persist()
      }
    }, 3000)
  }

  /** Finds a terminal VS Code restored on reopen that belongs to `record` and isn't claimed yet. */
  private findRestoredTerminal(record: TerminalRecord): vscode.Terminal | undefined {
    const claimed = new Set([...this.runtime.values()].map((r) => r.nativeTerminal))
    const envOf = (t: vscode.Terminal) =>
      (t.creationOptions as vscode.TerminalOptions).env?.[TERMINAL_ID_ENV]
    const free = vscode.window.terminals.filter((t) => !claimed.has(t) && t.exitStatus === undefined)
    return free.find((t) => envOf(t) === record.id) ?? free.find((t) => t.name === record.name)
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

  /**
   * @param preserveFocus When true, reveals the terminal without stealing
   * keyboard focus from wherever it currently is — used when a tile is
   * clicked in the Terminals view, so an immediate F2 still targets the
   * tile just clicked instead of landing nowhere. Other callers (creating a
   * terminal, jumping to one from a notification) want the normal
   * focus-follows behavior.
   */
  setActive(id: string, preserveFocus = false): void {
    const previousId = this.activeId
    if (previousId && previousId !== id) {
      const prevRuntime = this.runtime.get(previousId)
      if (prevRuntime) prevRuntime.lastActiveAt = Date.now()
    }
    this.activeId = id
    this.present(id, preserveFocus)
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

  /**
   * Shows only `id` in the editor area. Any other terminal currently docked
   * in the editor is moved back to the (closed) Terminal panel, since the
   * extension API can't hide an editor tab without disposing its terminal.
   * Serialized because the move commands act on whichever terminal is active.
   */
  private present(id: string, preserveFocus: boolean): void {
    this.presentQueue = this.presentQueue.then(() =>
      vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: 'Switching terminal…' },
        async () => {
          this.switching = true
          try {
            const target = this.runtime.get(id)
            if (!target?.nativeTerminal) return
            const stale = [...this.runtime.entries()].filter(
              ([otherId, r]) => otherId !== id && r.inEditor && r.nativeTerminal
            )
            // Fast path: already the only terminal in the editor — just reveal it.
            if (target.inEditor && stale.length === 0) {
              target.nativeTerminal.show(true)
              await vscode.commands.executeCommand('moveActiveEditor', { to: 'first', by: 'tab' })
              target.nativeTerminal.show(preserveFocus)
              return
            }
            for (const [, other] of stale) {
              other.nativeTerminal?.show(true)
              await vscode.commands.executeCommand('workbench.action.terminal.moveToTerminalPanel')
              other.inEditor = false
            }
            target.nativeTerminal.show(true)
            if (!target.inEditor) {
              await vscode.commands.executeCommand('workbench.action.terminal.moveToEditor')
              target.inEditor = true
            }
            // Keep the terminal tab pinned to the first position in its group.
            await vscode.commands.executeCommand('moveActiveEditor', { to: 'first', by: 'tab' })
            // Single panel close at the end, after all moves, to limit flicker.
            await vscode.commands.executeCommand('workbench.action.closePanel')
            target.nativeTerminal.show(preserveFocus)
          } catch (err) {
            this.output.appendLine(`present failed: ${String(err)}`)
          } finally {
            this.switching = false
          }
        }
      )
    )
  }

  private handleActiveTerminalChanged(term: vscode.Terminal | undefined): void {
    if (this.switching) return
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
