# ✈️ Airport for VS Code

Run Claude Code, Codex, Devin, and other AI coding agents side by side in VS Code's own integrated
terminals — with a traffic-light status per session so you always know which one needs you.

This is a VS Code extension port of the [Airport desktop app](https://github.com/vignaesh01/airport).
Instead of a separate Electron window managing its own PTYs, sessions run in real
`vscode.window` terminals, and status is read from VS Code's stable
[terminal shell integration API](https://code.visualstudio.com/api/references/vscode-api#TerminalShellExecution)
— no bundled native modules, no per-platform packaging, and it works over SSH/WSL/Codespaces for free.

## Status semantics

- 🔴 **Needs you** — the agent is blocked on a question or a permission prompt
- 🟡 **Working** — the agent is thinking or running a tool
- 🟢 **Done** — the agent finished its turn and is idle
- ⚪ **Exited** — the terminal process ended

Status is a heuristic based on output timing and the shape of the most recently rendered rows (not
raw bytes), so it survives full-screen TUI redraws. See `src/status-engine.ts`.

## Requirements

- VS Code 1.93+ (for stable terminal shell integration)
- Shell integration active in the terminal's shell (bash, zsh, fish, pwsh, cmd are supported). If it
  never activates for a given shell, the session still runs — it just won't show a status.
- The AI coding agents you want to run, installed and working from your regular terminal first.

## Development

```sh
npm install
npm run watch   # esbuild in watch mode
```

Press F5 in VS Code to launch an Extension Development Host.

```sh
npm test        # vitest — status-engine / shells / format-elapsed unit tests
npm run typecheck
```

## Files panel

Each session's folder is shown in the **Files** view (below Sessions in the Airport sidebar) — a
lightweight read-only file tree that always follows whichever session is active, built by reading
the folder directly rather than through VS Code's workspace APIs. Clicking a session (or its "View
Folder" inline action) switches the Files panel to that folder; clicking a file opens it in the
current window's editor, same as double-clicking in the native Explorer.

This is deliberately **not** implemented via `vscode.workspace.updateWorkspaceFolders()` (adding the
session's folder as a workspace folder): on a window that isn't already a multi-root workspace, that
API can reopen the current window or spawn an entirely new one, which is unacceptable for something
as routine as starting or switching a session — every session stays in the one window you started in.

## Known limitations vs. the desktop app

- No diff viewer — use VS Code's own Source Control view for that (works when the session's folder
  happens to be a workspace folder; the Files panel above doesn't provide diffs on its own).
- A session's terminal name can't be renamed after creation (VS Code API limitation); the rail's
  session name is tracked separately from the underlying terminal's title.
- Reloading the window doesn't reattach the output stream to resumed terminals, so a "resumed"
  session shows no status until it produces new output.
