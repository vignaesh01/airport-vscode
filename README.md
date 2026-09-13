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

## Known limitations vs. the desktop app

- No built-in file explorer or diff viewer — use VS Code's own Explorer and Source Control views.
  This only shows a session's files if its folder is part of the open workspace: when you start a
  session in a folder outside it, Airport offers to add that folder to the workspace so it shows up
  in Explorer. Choosing "Not now" leaves the session running with no file-browsing UI for it.
- A session's terminal name can't be renamed after creation (VS Code API limitation); the rail's
  session name is tracked separately from the underlying terminal's title.
- Reloading the window doesn't reattach the output stream to resumed terminals, so a "resumed"
  session shows no status until it produces new output.
