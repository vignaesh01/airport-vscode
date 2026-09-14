import { describe, it, expect } from 'vitest'
import { classifyStatus, looksLikePrompt, shouldNotify, NOTIFY_SETTLE_GRACE_MS } from './status-engine'

describe('looksLikePrompt', () => {
  it('matches an actual question or confirmation', () => {
    expect(looksLikePrompt('Allow Bash(npm test)?')).toBe(true)
    expect(looksLikePrompt('Continue? (y/n)')).toBe(true)
  })

  it('matches a numbered choice line, with or without a leading selection marker', () => {
    expect(looksLikePrompt('❯ 1. Yes')).toBe(true)
    expect(looksLikePrompt('  2. No, and tell it what to do differently')).toBe(true)
    expect(looksLikePrompt('[1] Yes')).toBe(true)
    expect(looksLikePrompt('1) Yes')).toBe(true)
  })

  it('does not match a bare trailing > or ❯ on its own', () => {
    // These used to false-positive on two real cases: a full-screen TUI agent's
    // persistent input-box caret (visible whether or not it needs you), and a
    // plain wrapping-shell prompt left behind once the agent process exits.
    expect(looksLikePrompt('❯')).toBe(false)
    expect(looksLikePrompt('some/path >')).toBe(false)
    expect(looksLikePrompt('C:\\Users\\me\\project>')).toBe(false)
    expect(looksLikePrompt('PS C:\\Users\\me\\project>')).toBe(false)
  })

  it('rejects plain output and blank lines', () => {
    expect(looksLikePrompt('Compiling module 4 of 10')).toBe(false)
    expect(looksLikePrompt('')).toBe(false)
    expect(looksLikePrompt('   ')).toBe(false)
  })

  it('matches a question or option line boxed in │ borders', () => {
    // Claude Code's permission prompts render every row inside a box, so the
    // actual question/option text is flanked by literal │ characters, not a
    // bare edge — QUESTION_END_RE/OPTION_LINE_RE must see past that border.
    expect(looksLikePrompt('│ Do you want to proceed? │')).toBe(true)
    expect(looksLikePrompt('│ ❯ 1. Yes │')).toBe(true)
    expect(looksLikePrompt('│   2. No, and tell it what to do differently │')).toBe(true)
  })

  it('does not match a box border row with no question content', () => {
    expect(looksLikePrompt('╭────────────────────────────╮')).toBe(false)
    expect(looksLikePrompt('│                            │')).toBe(false)
  })
})

describe('classifyStatus', () => {
  const base = { exited: false, now: 10_000, lastOutputAt: 10_000, lines: [] as string[] }

  it('is grey once the process has exited, regardless of everything else', () => {
    expect(classifyStatus({ ...base, exited: true, lines: ['❯'] })).toBe('grey')
  })

  it('is yellow before any output has arrived', () => {
    expect(classifyStatus({ ...base, lastOutputAt: null })).toBe('yellow')
  })

  it('is yellow while output is still streaming (< 400ms quiet)', () => {
    expect(classifyStatus({ ...base, now: 10_300, lastOutputAt: 10_000 })).toBe('yellow')
  })

  it('is red once quiet >= 800ms and the last line looks like a prompt', () => {
    expect(classifyStatus({ ...base, now: 10_900, lastOutputAt: 10_000, lines: ['Allow Bash(npm test)?'] })).toBe(
      'red'
    )
  })

  it('is red when a prompt-shaped line sits above the cursor row, not just on it', () => {
    // Mirrors a full-screen TUI: the question/options render above the
    // persistent input box the cursor actually sits in.
    expect(
      classifyStatus({
        ...base,
        now: 10_900,
        lastOutputAt: 10_000,
        lines: ['Allow Bash(npm test)?', '❯ 1. Yes', '  2. No', '', '>']
      })
    ).toBe('red')
  })

  it('is not red at 800ms quiet without a prompt-shaped line', () => {
    expect(classifyStatus({ ...base, now: 10_900, lastOutputAt: 10_000, lines: ['still building…'] })).not.toBe(
      'red'
    )
  })

  it('is green once quiet >= 1500ms with no prompt match', () => {
    expect(classifyStatus({ ...base, now: 11_600, lastOutputAt: 10_000, lines: ['done.'] })).toBe('green')
  })

  it('stays yellow in the ambiguous gap between 400ms and the red/green thresholds', () => {
    expect(classifyStatus({ ...base, now: 10_600, lastOutputAt: 10_000, lines: ['still building…'] })).toBe(
      'yellow'
    )
  })

  it('is not red when a "?"-ending line belongs to a finished turn, past a separator', () => {
    // Reproduces a real Antigravity false positive: its own conversational
    // reply happened to end in "?", and a full-width "────" rule (its
    // between-turns marker) sits between that line and the idle prompt.
    expect(
      classifyStatus({
        ...base,
        now: 10_900,
        lastOutputAt: 10_000,
        lines: [
          '> hi',
          '',
          '  Hello! How can I help you today with the project?',
          '',
          '────────────────────────────────────────',
          '>'
        ]
      })
    ).not.toBe('red')
  })

  it('is still red for a "?"-ending prompt with no separator after it', () => {
    expect(
      classifyStatus({
        ...base,
        now: 10_900,
        lastOutputAt: 10_000,
        lines: ['Do you trust the contents of this project?', '', '> Yes, I trust this folder', '  No, exit']
      })
    ).toBe('red')
  })

  it('turns green, not red, once an agent exits back to the wrapping shell prompt', () => {
    // The PTY itself is still alive (it wraps the agent command in cmd/PowerShell
    // so the window stays open), so `exited` is false — only the rendered line
    // changes to a bare shell prompt. That alone must not read as "needs you".
    expect(
      classifyStatus({ ...base, now: 11_600, lastOutputAt: 10_000, lines: ['PS C:\\Users\\me\\project>'] })
    ).toBe('green')
  })
})

describe('shouldNotify', () => {
  const base = {
    previousStatus: 'yellow' as const,
    status: 'green' as const,
    alreadyNotifiedAs: undefined,
    notificationsEnabled: true,
    isActiveAndFocused: false,
    now: 100_000,
    lastActiveAt: undefined
  }

  it('notifies on a genuine red/green transition while backgrounded', () => {
    expect(shouldNotify(base)).toBe(true)
    expect(shouldNotify({ ...base, previousStatus: 'yellow', status: 'red' })).toBe(true)
  })

  it('does not notify for a terminal that is the active, focused tab', () => {
    expect(shouldNotify({ ...base, isActiveAndFocused: true })).toBe(false)
  })

  it('does not notify when the same status was already notified', () => {
    expect(shouldNotify({ ...base, alreadyNotifiedAs: 'green' })).toBe(false)
  })

  it('does not notify when notifications are disabled', () => {
    expect(shouldNotify({ ...base, notificationsEnabled: false })).toBe(false)
  })

  it('does not notify on the very first status (no prior status to transition from)', () => {
    expect(shouldNotify({ ...base, previousStatus: undefined })).toBe(false)
  })

  it('does not notify when the status did not actually change', () => {
    expect(shouldNotify({ ...base, previousStatus: 'green', status: 'green' })).toBe(false)
  })

  it('does not notify for a transition to yellow/grey, even if newly settled', () => {
    expect(shouldNotify({ ...base, status: 'yellow' })).toBe(false)
    expect(shouldNotify({ ...base, status: 'grey' })).toBe(false)
  })

  // The tab-switch race this whole function exists to close: the status
  // classifier can take up to ~1.9s (quiet threshold + poll confirmation) to
  // settle after output actually stops. If the user switches away from the
  // terminal within that window, the underlying completion happened while
  // they were still watching it — a notification for it would be stale.
  it('suppresses a transition that settles just after the user switched away from it', () => {
    const leftAt = 100_000
    const settledAt = leftAt + NOTIFY_SETTLE_GRACE_MS - 1
    expect(shouldNotify({ ...base, now: settledAt, lastActiveAt: leftAt })).toBe(false)
  })

  it('still notifies once enough time has passed since the user left the tab', () => {
    const leftAt = 100_000
    const settledAt = leftAt + NOTIFY_SETTLE_GRACE_MS + 1
    expect(shouldNotify({ ...base, now: settledAt, lastActiveAt: leftAt })).toBe(true)
  })

  it('is unaffected by lastActiveAt for a terminal that was never the active tab', () => {
    expect(shouldNotify({ ...base, lastActiveAt: undefined })).toBe(true)
  })
})
