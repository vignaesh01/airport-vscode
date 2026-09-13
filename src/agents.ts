export interface AgentDefinition {
  id: string
  label: string
  /** Becomes the command sent to the terminal via `sendText`. Undefined = plain shell, no command. */
  command?: string
}

export const AGENTS: AgentDefinition[] = [
  { id: 'claude', label: 'Claude', command: 'claude' },
  { id: 'codex', label: 'Codex', command: 'codex' },
  { id: 'antigravity', label: 'Antigravity', command: 'agy' },
  { id: 'devin', label: 'Devin', command: 'devin' },
  { id: 'shell', label: 'Shell' }
]
