# Port Airport (Electron) to a VS Code extension

> Original plan approved before implementation, with a postscript below noting where the
> implementation diverged from it (all divergences found via testing, not preference).

## Context

Airport (`C:\Projects\VS Code Workspaces\airport`) is a small (~3,400 line) Electron desktop app
that runs multiple AI coding agents (Claude Code, Codex, Devin, etc.) in separate PTYs, laid out as
a vertical session rail with a traffic-light status per session (🔴 needs you / 🟡 working / 🟢 done /
⚪ exited) plus a built-in file explorer and diff viewer. The status signal is the product's whole
value — it's a pure heuristic (`status-engine.ts`) driven off rendered terminal rows, not raw bytes,
so it survives full-screen TUI redraws.

The goal is to bring this into VS Code as an extension in `C:\Projects\VS Code Extensions\airport-vscode`
(currently empty), so people get the same "which agent needs me" signal inside the editor they're
already using, instead of a separate desktop app.

**Key architectural decision, resolved by checking the actual stable API surface (not assumed):**
VS Code's `Terminal.shellIntegration.executeCommand` was proposed-API-only for raw output access in
earlier versions, but the stable `TerminalShellExecution.read(): AsyncIterable<string>` (confirmed
present in the current stable `vscode.d.ts`, not the proposed-API file) gives raw bytes *including
escape sequences* for commands run in a **native VS Code terminal**, as long as shell integration is
active. This means:

- No bundled `node-pty`. No prebuilt binaries, no per-platform VSIX, no Linux/remote packaging problem.
- Terminals run in real `vscode.window.createTerminal()` instances — get free persistence UI, copy/paste,
  themes, accessibility, and WSL/SSH/Codespaces support, none of which the Electron app had to build.
- The extension calls `terminal.sendText(command)` to launch the agent, then reads the async byte
  stream from `onDidStartTerminalShellExecution` → `execution.read()` and feeds it into an
  `@xterm/headless` instance (same `Terminal` class as `@xterm/xterm`, no DOM) to reconstruct
  *rendered* rows — exactly what `Terminal.tsx`'s `recentLines()` does today, just fed from a
  different byte source. `status-engine.ts`'s classifier is reused unchanged.
- Trade-off, stated explicitly: shell integration must activate (works for bash/zsh/fish/pwsh/cmd per
  VS Code's supported list) and a command's `read()` must be attached at/after
  `onDidStartTerminalShellExecution` to not miss bytes. If shell integration never activates for a
  terminal (rare, but possible with unusual shell configs), that terminal shows in the rail with no
  traffic light and a tooltip explaining status requires shell integration — never refuse to create it.
- The headless xterm's column width is a guess (no stable API reports a native terminal's actual
  cols/rows), so it's set generously wide/tall by default and only affects line-wrapping edge cases,
  not the core red/yellow/green logic, since `looksLikePrompt` matches trimmed lines from
  `translateToString(true)` regardless of wrap width.
- Per the user's decision: **drop the explorer/diff/file-viewer entirely** — VS Code's own Explorer,
  Source Control view, and `vscode.diff` command are strictly better and already there.

## What survives essentially unchanged

Copy these into the new extension's `src/` with no logic changes (bring their vitest tests along —
they port free):

- `src/renderer/src/status-engine.ts` + `status-engine.test.ts` — the classifier. Zero changes.
- `src/shared/agents.ts` — agent list (`claude`, `codex`, `antigravity`, `devin`, `shell`), minus the
  chip/ink CSS-var fields (no longer needed; map to `ThemeIcon` colors instead in the tree view).
- `src/renderer/src/format-elapsed.ts` + test — elapsed-time formatting for the rail.
- `src/main/shells.ts` + `shells.test.ts` — shell discovery (`which`/`where` for cmd/powershell/bash/
  etc.), reused to populate a shell-picker if the extension offers "run in a specific shell" — likely
  unnecessary since VS Code terminal profiles already do this, but keep the logic available if the
  new-terminal flow wants explicit shell selection à la `NewSessionDialog.tsx`.

## Reshaped

- **Terminal persistence**: `sessions-store.ts`'s JSON-file approach becomes
  `ExtensionContext.workspaceState` (or `globalState` if terminals should follow the user, not the
  workspace) storing `TerminalRecord[]` — drop `parseSessionsFile`'s manual validation in favor of a
  small zod-free type guard or just trusting the stored shape.
- **Resume-on-reload UX**: `App.tsx`'s `pendingResume` banner becomes a `showInformationMessage` with
  "Resume N terminals" / "Start fresh" actions, shown once on `activate()` if stored terminals exist.
  Known limitation to state up front: even with `terminal.integrated.enablePersistentSessions`, a
  reload's `read()` stream doesn't reattach to old output — a "resumed" terminal comes back with no
  status until new output arrives.
- **Notifications**: `notifications.ts`'s `Notification` + click-to-focus becomes
  `window.showInformationMessage(title, 'Go to terminal')` with a `.then()` handler that reveals the
  terminal and focuses the corresponding tree item.
- **Folder picker**: `dialog.ts`'s `browseForFolder` becomes `workspace.workspaceFolders` as the
  default source (most terminals belong to the open workspace), falling back to
  `window.showOpenDialog({ canSelectFolders: true })` only when no workspace is open or the user
  explicitly wants a different folder.
- **Git branch label**: `main/git.ts`'s 13-line `simple-git` helper is kept as-is (small, reusable),
  or swapped for VS Code's built-in `vscode.git` extension API if branch-per-folder is easy to read
  from there — pick whichever needs less code once written.

## Deleted outright (VS Code already owns this)

`Explorer.tsx`, `FileView.tsx`, `parse-diff.ts`, `file-icon.ts`, `binary-files.ts`, `main/explorer.ts`,
`PanelResizer.tsx`, `panel-sizes.ts`, `theme.ts`/`theme.css`, `font-size.ts`, the entire IPC/preload
layer (`shared/ipc.ts`, `preload/index.ts`, `main/index.ts`'s `BrowserWindow` setup), and `pty-manager.ts`
in its current PTY-spawning form (its `resolveShell`/`resolveSpawnTarget` Windows-PATH-shim reasoning
is no longer needed — `terminal.sendText()` goes through the shell directly, sidestepping the exact
`.cmd`/`.ps1` resolution problem that code worked around).

Also deleted: the two Electron-only workarounds in `Terminal.tsx` — the Ctrl+V clipboard hack and the
`[O` focus-report suppression — native VS Code terminals handle both already.

## New extension structure

```
airport-vscode/
  package.json              — extension manifest: contributes.views, commands, keybindings
  src/
    extension.ts             — activate(): registers tree provider, commands, restores terminals
    terminal.ts                — TerminalRecord type (from shared/session.ts), terminal lifecycle
    status-engine.ts          — ported verbatim
    status-engine.test.ts
    status-tracker.ts         — NEW: per-terminal @xterm/headless instance fed by execution.read(),
                                 replaces Terminal.tsx's recentLines()/reportStatus() polling loop
    agents.ts                 — ported from shared/agents.ts
    format-elapsed.ts + test
    shells.ts + test           — kept for shell-selection UI if offered
    git.ts                     — branch lookup
    terminal-tree-provider.ts  — TreeDataProvider<TerminalRecord>: rail as a native tree view
    new-terminal-flow.ts       — QuickPick-based folder/agent/shell picker (replaces NewSessionDialog.tsx)
  package.json contributes:
    views: one view container ("Airport") + a TreeView for terminals
    commands: airport.newTerminal, airport.closeTerminal, airport.renameTerminal, airport.toggleNotifications
    keybindings: alt+1..9 → airport.gotoTerminal with args, scoped when the view has focus
    viewsWelcome / badge: "N need you" count via TreeView.badge (ViewBadge)
```

### Rail as TreeView, not a webview

- Traffic light → `TreeItem.iconPath = new ThemeIcon(<codicon-id>, new ThemeColor(<color-id>))`, with
  a **distinct codicon per state** (not just color) to preserve the "never color-only" accessibility
  rule from the original design doc.
- Branch + elapsed time → `TreeItem.description`.
- Rename → inline command on `view/item/context` (`workbench.action....` style rename input box).
- Close → `view/item/context` command with a trash/close icon, `group: inline`.
- "N need you" badge → `TreeView.badge` (`{ value: needsYouCount, tooltip: '...' }`).
- Alt+1..9 → `keybindings` contribution entries bound to `airport.gotoTerminal.<n>` commands, scoped
  with `"when": "focusedView == airport.terminals"` instead of the old `window` keydown listener.

### Status detection pipeline (the part that must be proven first)

1. `airport.newTerminal` creates a `vscode.window.createTerminal()` in the chosen folder, running the
   agent command via `terminal.sendText(command)`.
2. `window.onDidStartTerminalShellExecution` fires for that execution; immediately call
   `execution.read()` and pipe each chunk into a per-terminal `@xterm/headless` `Terminal` instance
   (`scrollback: 0`, generous fixed cols/rows since real dimensions aren't queryable) via `term.write()`.
3. On a timer (mirroring `Terminal.tsx`'s `STATUS_POLL_MS` + `STATUS_CONFIRM_COUNT` debounce), read
   `recentLines()` off the headless buffer exactly as today, feed into `classifyStatus()`, and update
   the tree item's icon/status when the debounced result changes.
4. `window.onDidEndTerminalShellExecution` / terminal exit → `grey`.

**Kill-criterion for this step, before building anything else on top:** wire this up standalone, start
a real `claude` terminal in a git folder, and confirm the rail item goes yellow → red on a permission
prompt and green when the turn ends. If the boxed-TUI rendering doesn't trip `looksLikePrompt` at the
headless emulator's guessed width, the fix is tuning `status-engine.ts`'s regexes/row-window, not
picking a different runtime.

## Verification

- Run the ported `status-engine.test.ts`, `shells.test.ts`, and `format-elapsed.test.ts` unchanged
  under vitest (or migrate to the extension's chosen test runner) — this is the regression net for
  the one part of the app that must not silently change behavior.
- Press F5 to launch an Extension Development Host, open a git repo folder, run `airport.newTerminal`
  targeting `claude`, and manually verify the yellow → red → green → grey lifecycle described above.
- Verify the resume flow: reload the dev host window with a terminal active, confirm the
  "Resume N terminals" prompt appears and clicking it re-creates terminals (accepting that status
  starts blank until new output arrives, per the stated limitation).
- Verify Alt+1..9 keybindings switch/reveal the right terminal when the terminals view has focus.

---

## Postscript: what implementation found

The plan above was followed as written, with one substitution for the "kill-criterion" step: this
environment has no interactive VS Code session to run a real `F5` + live `claude` session against, so
a `@vscode/test-electron` integration suite (`src/test-integration/`) was built instead — it launches
a real Extension Host and drives `TerminalManager` against real `vscode.window` terminals, which is as
close to the plan's kill-criterion as an automated, non-interactive check can get. It caught three real
bugs the plan's design didn't anticipate:

1. **`@xterm/headless` requires `allowProposedApi: true`** for the `buffer` accessor `recentLines()`
   depends on — undocumented in the plan, only visible at runtime.
2. **`looksLikePrompt()`'s anchored regexes never matched Claude Code's boxed permission prompts.**
   Every row of a boxed prompt (`│ Do you want to proceed? │`) is wrapped in a literal `│` border, so
   `QUESTION_END_RE` (anchored to end-of-line) and `OPTION_LINE_RE` (anchored to start-of-line) never
   fired. This is a latent bug in the *original* Electron app's `status-engine.ts` too — the ported
   code is unmodified from it and Electron's `translateToString(true)` returns the same bordered text —
   but it only surfaced here because the port's kill-criterion (this integration suite) specifically
   probed for it. Fixed with a `BOX_BORDER_RE` strip in `looksLikePrompt()`, confirmed with a unit test
   and a live-terminal test that was verified to actually fail without the fix (not a false pass from
   console-encoding mangling).
3. **`activationEvents: []` would have silently broken resume-on-reload and the `alt+1..9`
   keybindings** until the user first opened the Airport view (VS Code only auto-activates on
   `onView:...` from `contributes.views`, and `activate()` — where the resume prompt lives — never ran
   before that). Changed to `onStartupFinished`.

One deliberate deviation from the plan's keybinding design: `alt+1..9` are **not** scoped to
`"when": "focusedView == airport.terminals"` as originally planned. Switching terminals from inside a
terminal (not the tree view) is the primary use case, so the keybindings are unscoped, matching the
original Electron app's global `window` keydown handler.

**Still not exercised by automated tests**, and left as manual work per the README: the tree view,
badge, and rename/close context menus (no UI is driven in the integration suite), the resume flow
end-to-end, and a real long-running agent's alt-screen TUI redrawing at the headless emulator's fixed
`HEADLESS_COLS`/`HEADLESS_ROWS`.

### Follow-up: a terminal's folder wasn't visible anywhere

The plan's "drop the explorer, use VS Code's own" reasoning only holds when a terminal's folder is a
workspace folder. The new-terminal flow's folder picker allows any folder via `showOpenDialog`, so a
terminal pointed outside the open workspace had no file-browsing UI at all — a gap neither the plan
nor the integration suite caught, since nothing in either exercised a folder outside the test
workspace.

**First attempt (reverted):** `terminal-manager.ts` prompted to add the folder via
`vscode.workspace.updateWorkspaceFolders()`. This looked correct against the API docs and passed a
live integration test asserting the workspace folder list grew — but real usage showed it opening a
**new VS Code window per terminal**. On a window that isn't already a multi-root workspace, that API
can reopen the current window or spawn a new one to accommodate the transition to multi-root, which
is exactly what was observed. Chasing this also produced a run of confusing, hard-to-reproduce
integration-test instability (the extension host restarting and re-running the whole Mocha suite,
apparently on every folder add rather than only the documented first-time transition) before the
underlying cause was traced back to this one API call.

**Fix:** removed `updateWorkspaceFolders()` entirely — no code in this extension touches
`vscode.workspace` state at all now. In its place, `terminal-files-provider.ts` is a second, lightweight
TreeView ("Files", alongside "Terminals" in the Airport sidebar) that always mirrors the *active*
terminal's folder, built by reading the filesystem directly (`file-tree.ts`'s `listDirectory()`, plain
`fs.readdir`) rather than through any workspace/window API. Clicking a terminal (or its "View Folder"
action) just calls `setActive()` and focuses the Files view — never anything that can open a window.
`file-tree.ts` has no `vscode` import, so `listDirectory()`'s directories-first/alphabetical sort is
covered by a fast vitest unit test (`file-tree.test.ts`) instead of the slow live-terminal harness.
