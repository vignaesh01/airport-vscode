import type { SessionStatus } from './status-engine'

export interface SessionRecord {
  /** Stable session id, generated when the session is created. Persists across window reloads. */
  id: string
  /** Absolute path to the session's working directory. */
  folder: string
  /** AgentDefinition.id this session was launched with. */
  agentId: string
  /** Display label shown in the rail. */
  name: string
  /** epoch ms, used to compute elapsed time in the rail. */
  createdAt: number
  /**
   * Resolved executable path of the shell to host the session in (cmd,
   * PowerShell, bash, ...), when the user picked one instead of VS Code's
   * default terminal profile. Passed as `shellPath` in `TerminalOptions`.
   */
  shellPath?: string
}

export interface SessionsFile {
  version: 1
  activeId: string | null
  sessions: SessionRecord[]
}

export const EMPTY_SESSIONS_FILE: SessionsFile = { version: 1, activeId: null, sessions: [] }

/** Runtime-only fields tracked per session, never persisted. */
export interface SessionRuntime {
  terminal: import('vscode').Terminal | null
  status: SessionStatus
  /** True once the underlying terminal process has exited. */
  exited: boolean
  branch: string | null
}
