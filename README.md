# ✈️ Airport

Run Claude Code, Codex, Devin, and other AI coding agents side by side — in VS Code's own
terminals — and see at a glance which ones need you.

If you juggle several AI agent sessions at once, you know the problem: they're all just terminal
tabs, so you end up alt-tabbing between them to check whether one is still thinking or has been
sitting idle waiting for an answer for the last five minutes. Airport adds a sidebar that tracks
every session's status for you, so you only switch to the ones that actually need your attention.

## What it does

- **A dedicated sidebar** lists all your agent sessions in one place, each with a live status
  light.
- **Start any agent** — Claude Code, Codex, Antigravity, Devin, or a plain shell — in one click,
  each running in a real VS Code terminal.
- **Know who needs you** without checking every tab: sessions are color-coded so a blocked one
  stands out immediately.
- **Browse each session's files** in a lightweight panel that follows whichever session is
  selected, without touching your workspace folders.
- **Pick up where you left off** — Airport offers to resume your previous sessions the next time
  you open the workspace.

## Status lights

| | Status | Meaning |
|---|---|---|
| 🔴 | **Needs you** | The agent is blocked on a question or a permission prompt |
| 🟡 | **Working** | The agent is thinking or running a tool |
| 🟢 | **Done** | The agent finished its turn and is idle |
| ⚪ | **Exited** | The terminal process ended |

## Getting started

1. Install the extension and open the **Airport** icon in the Activity Bar.
2. Click **+** in the Sessions view and pick an agent to start.
3. Work as usual in the terminal that opens — Airport watches its output in the background and
   updates the status light for you.
4. Click any session in the sidebar to jump straight to its terminal, or use the **Files** view
   underneath to browse its folder without leaving the sidebar.

Notifications can be turned on so you get an OS notification when a session needs you — toggle
them from the Sessions view's toolbar or the Command Palette (**Airport: Turn On/Off
Notifications**).

## Requirements

- VS Code 1.93 or newer.
- A shell with [shell integration](https://code.visualstudio.com/docs/terminal/shell-integration)
  support — bash, zsh, fish, pwsh, and cmd all work. If shell integration doesn't activate for your
  shell, the session still runs, it just won't show a status light.
- The AI coding agent(s) you want to run (Claude Code, Codex, etc.) already installed and working
  from your regular terminal.

## Known limitations

- No built-in diff viewer — use VS Code's Source Control view for that (works when a session's
  folder is also a workspace folder).
- A session's terminal name can't be changed after it's created, due to a VS Code API limitation;
  renaming a session in the sidebar keeps working, it just doesn't rename the underlying terminal
  tab.
- After reloading the window, resumed sessions won't show a status until they produce new output.

## About

Airport is a VS Code port of the [Airport desktop app](https://github.com/vignaesh01/airport),
rebuilt to run entirely inside VS Code's own terminals instead of a separate Electron window — so
there's nothing to install beyond the extension itself, and it works the same over SSH, WSL, and
GitHub Codespaces.
