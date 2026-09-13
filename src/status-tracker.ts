import { Terminal as HeadlessTerminal } from '@xterm/headless'
import { classifyStatus, type SessionStatus } from './status-engine'

const STATUS_POLL_MS = 200
/** How many rows above the cursor's own row to scan for a prompt shape. */
const PROMPT_SCAN_ROWS = 8
/** Consecutive identical polls required before a status change is reported. */
const STATUS_CONFIRM_COUNT = 2
/**
 * A native terminal's real column/row count isn't exposed by any stable
 * VS Code API, so the headless emulator is sized generously instead of
 * matching it exactly. This only affects line-wrapping edge cases — the
 * prompt-shape regexes match trimmed, rendered lines regardless of wrap
 * width (see status-engine.ts), so classification stays reliable.
 */
const HEADLESS_COLS = 220
const HEADLESS_ROWS = 50

// Full-screen TUI agents (Claude Code included) park the cursor in a
// persistent input box at the bottom of the screen — the actual question or
// option list renders on the rows just above it, so a single-row read misses
// every real prompt. Mirrors Terminal.tsx's recentLines() from the Electron app.
function recentLines(term: HeadlessTerminal): string[] {
  const buf = term.buffer.active
  const cursorRow = buf.cursorY + buf.baseY
  const startRow = Math.max(0, cursorRow - PROMPT_SCAN_ROWS)
  const lines: string[] = []
  for (let row = startRow; row <= cursorRow; row++) {
    const line = buf.getLine(row)
    if (line) lines.push(line.translateToString(true))
  }
  return lines
}

/**
 * Reconstructs a session's rendered terminal state from a raw byte stream
 * (VS Code's `TerminalShellExecution.read()`) using a headless xterm
 * instance, and classifies status off it exactly the way the Electron app's
 * Terminal.tsx did off a real xterm.js buffer. One instance per session.
 */
export class SessionStatusTracker {
  private readonly term: HeadlessTerminal
  private lastOutputAt: number | null = null
  private exited = false
  private lastReportedStatus: SessionStatus | null = null
  private pendingStatus: SessionStatus | null = null
  private pendingCount = 0
  private pollTimer: ReturnType<typeof setInterval> | null = null
  private disposed = false
  private lastRenameMatch: string | null = null

  constructor(
    private readonly onStatusChange: (status: SessionStatus) => void,
    private readonly onTitleChange?: (title: string) => void,
    /**
     * Fallback for agents (Antigravity included) that don't set the terminal
     * title on rename — matched against each visible line, capture group 1
     * is the new name. See AgentDefinition.renameConfirmationPattern.
     */
    private readonly renameConfirmationPattern?: RegExp,
    private readonly debugLog?: (message: string) => void
  ) {
    this.term = new HeadlessTerminal({
      cols: HEADLESS_COLS,
      rows: HEADLESS_ROWS,
      scrollback: 0,
      // buffer.active (read in recentLines()) is a proposed API in
      // @xterm/headless — confirmed required at runtime by the integration
      // test, which throws "You must set the allowProposedApi option to
      // true" without this.
      allowProposedApi: true
    })
    this.pollTimer = setInterval(() => this.reportStatus(), STATUS_POLL_MS)
    // Agents like Claude Code rename their session (e.g. via `/rename`) by
    // emitting an OSC 0/2 title escape sequence, same as any terminal app
    // changing its tab title — xterm parses that for us.
    if (this.onTitleChange) {
      this.term.onTitleChange((title) => {
        this.debugLog?.(`title event: raw=${JSON.stringify(title)}`)
        if (title.trim()) this.onTitleChange?.(title.trim())
      })
    }
  }

  /** Feed a chunk of raw terminal output (escape sequences included). */
  write(chunk: string): void {
    if (this.disposed) return
    this.lastOutputAt = Date.now()
    this.term.write(chunk)
    this.checkRenameConfirmation()
    this.reportStatus()
  }

  private checkRenameConfirmation(): void {
    if (!this.renameConfirmationPattern) return
    for (const line of recentLines(this.term)) {
      const match = this.renameConfirmationPattern.exec(line)
      const name = match?.[1]?.trim()
      if (name && name !== this.lastRenameMatch) {
        this.lastRenameMatch = name
        this.debugLog?.(`rename confirmation matched: ${JSON.stringify(name)}`)
        this.onTitleChange?.(name)
      }
    }
  }

  /** Mark the underlying terminal process as exited. Status becomes 'grey'. */
  markExited(): void {
    this.exited = true
    this.reportStatus()
  }

  /** Current status without waiting for the next poll tick. */
  get status(): SessionStatus {
    return classifyStatus({
      exited: this.exited,
      now: Date.now(),
      lastOutputAt: this.lastOutputAt,
      lines: recentLines(this.term)
    })
  }

  private reportStatus(): void {
    const status = classifyStatus({
      exited: this.exited,
      now: Date.now(),
      lastOutputAt: this.lastOutputAt,
      lines: recentLines(this.term)
    })
    if (status === this.pendingStatus) {
      this.pendingCount++
    } else {
      this.pendingStatus = status
      this.pendingCount = 1
    }
    // Require the same classification across a couple of polls before
    // reporting it — a periodic TUI redraw can transiently move the cursor
    // on/off a prompt-shaped row, and a single blip shouldn't flip the badge
    // or fire a notification.
    if (this.pendingCount >= STATUS_CONFIRM_COUNT && status !== this.lastReportedStatus) {
      this.lastReportedStatus = status
      if (status === 'red') {
        this.debugLog?.(`status -> red, lines=${JSON.stringify(recentLines(this.term))}`)
      }
      this.onStatusChange(status)
    }
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    if (this.pollTimer) clearInterval(this.pollTimer)
    this.term.dispose()
  }
}
