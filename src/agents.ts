export interface AgentDefinition {
  id: string
  label: string
  /** Becomes the command sent to the terminal via `sendText`. Undefined = plain shell, no command. */
  command?: string
  /**
   * Matches this agent's own printed rename confirmation, for agents that
   * don't set the terminal title via an OSC escape sequence (unlike Claude
   * Code, whose title change is caught directly). Capture group 1 must be
   * the new name.
   */
  renameConfirmationPattern?: RegExp
}

export const AGENTS: AgentDefinition[] = [
  { id: 'claude', label: 'Claude', command: 'claude' },
  { id: 'codex', label: 'Codex', command: 'codex' },
  {
    id: 'antigravity',
    label: 'Antigravity',
    command: 'agy',
    renameConfirmationPattern: /Conversation renamed to:\s*(.+)/
  },
  { id: 'devin', label: 'Devin', command: 'devin' },
  { id: 'shell', label: 'Shell' }
]
