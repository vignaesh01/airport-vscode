export type TerminalStatus = 'red' | 'yellow' | 'green' | 'grey'

/** Output written more recently than this counts as still actively streaming. */
export const YELLOW_ACTIVE_MS = 400
/** Minimum quiet time before a prompt-shaped last line is trusted as "needs you". */
export const RED_QUIET_MS = 800
/** Quiet time after which, absent a prompt match, the agent is considered idle/done. */
export const GREEN_QUIET_MS = 1500

/**
 * Worst-case lag between the underlying condition (output actually went
 * quiet) and a poll confirming the resulting status change — quiet threshold
 * plus a couple of confirmation polls, with slack. A terminal that was the
 * active tab within this long of the transition settling was still being
 * watched when the real event happened, so a notification for it would just
 * be telling the user something they already saw.
 */
export const NOTIFY_SETTLE_GRACE_MS = 2500

export interface ShouldNotifyParams {
  previousStatus: TerminalStatus | undefined
  status: TerminalStatus
  /** Which status (if any) an OS notification was already fired for. */
  alreadyNotifiedAs: TerminalStatus | undefined
  notificationsEnabled: boolean
  /** True when this terminal is both the active tab and the window has OS focus. */
  isActiveAndFocused: boolean
  now: number
  /** Epoch ms this terminal was last the active tab, or undefined if never. */
  lastActiveAt: number | undefined
}

/**
 * Decides whether a status transition should fire an OS notification.
 * Pure and harness-agnostic — it only looks at status history and tab
 * activity timing, never at which agent/shell is running in the terminal.
 */
export function shouldNotify(params: ShouldNotifyParams): boolean {
  const { previousStatus, status, alreadyNotifiedAs, notificationsEnabled, isActiveAndFocused, now, lastActiveAt } =
    params
  if (!notificationsEnabled) return false
  if (previousStatus === undefined || previousStatus === status) return false
  if (status !== 'red' && status !== 'green') return false
  if (alreadyNotifiedAs === status) return false
  if (isActiveAndFocused) return false
  const settledJustAfterLeaving = now - (lastActiveAt ?? 0) < NOTIFY_SETTLE_GRACE_MS
  if (settledJustAfterLeaving) return false
  return true
}

// Deliberately narrow: a bare trailing `>`/`❯` was tried first and dropped —
// full-screen TUI agents (Claude Code included) park the cursor in a
// persistent input box whose leading `❯` caret is visible whether or not
// anything actually needs you, and a plain wrapping shell prompt (cmd's
// "C:\path>", PowerShell's "PS C:\path>") left behind once an agent process
// exits ends in '>' too — both used to cause a false "needs you" red. What's
// left targets an actual question: a literal '?', a "(y/n)" confirmation, or
// a numbered choice line ("1. Yes", "[1] Yes", "1) Yes", optionally preceded
// by a `❯`/`>` selection marker).
const QUESTION_END_RE = /\?\s*$/
const CONFIRM_RE = /\(y\/n\)/i
const OPTION_LINE_RE = /^\s*[❯>]?\s*(?:\[\d+\]|\d+[.):])\s*\S/

// Claude Code's permission/question prompts render inside a box: every row
// is wrapped in a leading and trailing `│` (plus padding), so a real row
// reads `│ Do you want to proceed? │`, not `Do you want to proceed?`. The
// two anchored patterns above (QUESTION_END_RE, OPTION_LINE_RE) would never
// match a boxed row's actual border character, only a bare edge — so box
// borders are stripped from both ends before matching. Only literal
// box-drawing pipe glyphs are stripped, never `>`/`❯`, which OPTION_LINE_RE
// still needs as a meaningful selection marker.
const BOX_BORDER_RE = /^[\s│┃|]+|[\s│┃|]+$/g

export function looksLikePrompt(line: string): boolean {
  const trimmed = line.trimEnd().replace(BOX_BORDER_RE, '')
  if (trimmed.length === 0) return false
  return QUESTION_END_RE.test(trimmed) || CONFIRM_RE.test(trimmed) || OPTION_LINE_RE.test(trimmed)
}

// Chat-style agents (Antigravity included) draw a full-width horizontal rule
// between turns instead of Claude Code's cornered box borders (which mix in
// ╭/╮/╰/╯ and text, so this pure-dash pattern never matches those). Without
// this, a completed turn's own conversational reply ending in "?" — e.g.
// "How can I help you today with the X project?" — was mistaken for a live
// prompt purely because QUESTION_END_RE matches any trailing "?".
const SEPARATOR_RE = /^[-─━]{10,}$/

function isTurnSeparator(line: string): boolean {
  return SEPARATOR_RE.test(line.trim())
}

export interface ClassifyParams {
  /** True once the PTY process has exited. */
  exited: boolean
  now: number
  /** epoch ms of the last output chunk received, or null if none has arrived yet. */
  lastOutputAt: number | null
  /**
   * The last few rendered terminal rows up to and including the cursor's row,
   * oldest first. Full-screen TUI agents (Claude Code included) park the
   * cursor in a persistent input box at the bottom of the screen — the actual
   * question or option list renders on the rows just above it — so checking
   * only the cursor's own row misses every real prompt.
   */
  lines: string[]
}

/**
 * Tier 1 heuristic status classifier — works for any command, including plain
 * shells, using only output timing and the shape of the most recently
 * rendered rows (not the raw byte stream, so it stays meaningful across
 * full-screen/alt-screen TUI redraws).
 */
export function classifyStatus({ exited, now, lastOutputAt, lines }: ClassifyParams): TerminalStatus {
  if (exited) return 'grey'
  if (lastOutputAt === null) return 'yellow'

  const quiet = now - lastOutputAt
  if (quiet < YELLOW_ACTIVE_MS) return 'yellow'
  if (quiet >= RED_QUIET_MS) {
    // Only the lines since the most recent turn separator are "live" — text
    // above it belongs to an already-finished turn.
    const lastSeparatorIndex = lines.reduce((last, line, i) => (isTurnSeparator(line) ? i : last), -1)
    const liveLines = lastSeparatorIndex >= 0 ? lines.slice(lastSeparatorIndex + 1) : lines
    if (liveLines.some(looksLikePrompt)) return 'red'
  }
  if (quiet >= GREEN_QUIET_MS) return 'green'
  return 'yellow'
}
