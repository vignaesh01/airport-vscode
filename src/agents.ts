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
  resumeCommand?: (sessionId: string, pinned: boolean) => string
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
    resumeCommand: (id, pinned) => (pinned ? `claude --resume ${id}` : 'claude --continue')
  },
  { id: 'codex', label: 'Codex', command: 'codex', resumeCommand: () => 'codex resume --last' },
  {
    id: 'antigravity',
    label: 'Antigravity',
    command: 'agy',
    renameConfirmationPattern: /Conversation renamed to:\s*(.+)/
  },
  { id: 'devin', label: 'Devin', command: 'devin' },
  { id: 'shell', label: 'Shell' }
]
