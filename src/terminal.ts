import type { TerminalStatus } from './status-engine'

export interface TerminalRecord {
  /** Stable terminal id, generated when the terminal is created. Persists across window reloads. */
  id: string
  /** Absolute path to the terminal's working directory. */
  folder: string
  /** AgentDefinition.id this terminal was launched with. */
  agentId: string
  /** Display label shown in the rail. */
  name: string
  /** epoch ms, used to compute elapsed time in the rail. */
  createdAt: number
  /**
   * Resolved executable path of the shell to host the terminal in (cmd,
   * PowerShell, bash, ...), when the user picked one instead of VS Code's
   * default terminal profile. Passed as `shellPath` in `TerminalOptions`.
   */
  shellPath?: string
}

export interface TerminalsFile {
  version: 1
  activeId: string | null
  terminals: TerminalRecord[]
}

export const EMPTY_TERMINALS_FILE: TerminalsFile = { version: 1, activeId: null, terminals: [] }

/** Runtime-only fields tracked per terminal, never persisted. */
export interface TerminalRuntime {
  nativeTerminal: import('vscode').Terminal | null
  status: TerminalStatus
  /** True once the underlying terminal process has exited. */
  exited: boolean
  branch: string | null
}
