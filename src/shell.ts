export interface ShellOption {
  /** Stable identifier, e.g. 'cmd', 'powershell', 'bash'. */
  id: string
  /** Display label, e.g. 'Command Prompt'. */
  label: string
  /** Resolved executable path or name to spawn. */
  path: string
}
