import { existsSync, readdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

function hasSession(dir: string): boolean {
  try {
    return readdirSync(dir).some((f) => f.endsWith('.jsonl'))
  } catch {
    return false
  }
}

export interface AgentDefinition {
  id: string
  label: string
  /** Becomes the command sent to the terminal via `sendText`. Undefined = plain shell, no command. */
  command?: string
  /**
   * Command used when re-opening a terminal after a window reload, so the
   * agent continues its previous conversation. `sessionId` is the terminal's
   * stable id. Undefined = no known resume support; `command` is used instead.
   */
  resumeCommand?: (sessionId: string, pinned: boolean, folder: string) => string
  /** Command for a brand-new terminal when the agent can be pinned to a session id up front. */
  startCommand?: (sessionId: string) => string
  /**
   * Matches this agent's own printed rename confirmation, for agents that
   * don't set the terminal title via an OSC escape sequence (unlike Claude
   * Code, whose title change is caught directly). Capture group 1 must be
   * the new name.
   */
  renameConfirmationPattern?: RegExp
}

export const AGENTS: AgentDefinition[] = [
  {
    id: 'claude',
    label: 'Claude',
    command: 'claude',
    startCommand: (id) => `claude --session-id ${id}`,
    resumeCommand: (id, pinned, folder) => {
      // Claude stores sessions in ~/.claude/projects/<cwd with non-alphanumerics as '-'>/<id>.jsonl.
      // Resuming a session that doesn't exist just errors, so fall back to a fresh start.
      const dir = join(homedir(), '.claude', 'projects', folder.replace(/[^a-zA-Z0-9]/g, '-'))
      if (pinned && existsSync(join(dir, `${id}.jsonl`))) return `claude --resume ${id}`
      if (!pinned && hasSession(dir)) return 'claude --continue'
      return pinned ? `claude --session-id ${id}` : 'claude'
    }
  },
  { id: 'codex', label: 'Codex', command: 'codex', resumeCommand: () => 'codex resume --last' },
  {
    id: 'antigravity',
    label: 'Antigravity',
    command: 'agy',
    renameConfirmationPattern: /Conversation renamed to:\s*(.+)/,
    resumeCommand: () => 'agy --continue'
  },
  { id: 'devin', label: 'Devin', command: 'devin', resumeCommand: () => 'devin --continue' },
  { id: 'shell', label: 'Shell' }
]
