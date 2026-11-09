# Changelog

All notable changes to the Airport extension are documented in this file.

## [0.1.6] - 2026-11-09

### Added
- **Favourite agent** ([#6], [#13]): new `airport.favoriteAgent` setting. Click ☆ next to an agent in the picker to make it the favourite. It moves to the top and is preselected. Click ★ again to clear it.
- **Duplicate Terminal with ⟨agent⟩ ★** in the terminal right-click menu, shown only when a favourite is set.

### Changed
- **New terminals open in the editor pane** instead of the terminal panel ([#5], [#9]). The terminal tab is always moved to the first position, and new terminals are created directly in the editor to reduce jumping.
- **Notification defaults** ([#13]): OS notifications are on by default and in-window VS Code notifications are off. The two toggles are now independent. Previously the OS notification only fired when the VS Code notification was on. Both settings persist across reloads and workspaces.

### Fixed
- **Resume reopens existing terminals and agent sessions** ([#8], [#10]). Clicking **Resume** after reopening VS Code used to open brand-new terminals and start fresh agent conversations.
  - Restored terminals are adopted instead of duplicated. Airport terminals are now transient, so VS Code no longer restores stray empty ones.
  - Claude resumes by session id, and starts fresh if no saved session exists.
  - Codex resumes with `codex resume --last`.
  - Devin and Antigravity store their session id after launch and resume by id, falling back to `--continue`.
  - Saved terminals are no longer overwritten while a resume offer is pending.
- **OS notifications on Windows** ([#7], [#12]). Toasts were never shown because PowerShell was spawned detached.

## [0.1.5] - 2026-10-11

### Added
- Press **F2** to rename the selected terminal or file ([#3]).

### Changed
- Reduced the packaged extension size ([#4]).

## [0.1.1 – 0.1.4] - 2026-09-15 to 2026-09-19

### Added
- **Duplicate Terminal** and related terminal context-menu actions ([#1]).
- Files panel updates ([#2]).

## [0.1.0] - 2026-09-13

### Added
- Initial release: run Claude Code, Codex, Devin, Antigravity and other AI coding agents side by side in VS Code terminals across multiple workspaces.
- Terminals view with attention notifications, and a self-contained Files panel with a file context menu.
- Open a session's folder in the OS file explorer.

## Not yet released

- Open: allow extra startup flags and commands for agents ([#11]).

[#1]: https://github.com/vignaesh01/airport-vscode/pull/1
[#2]: https://github.com/vignaesh01/airport-vscode/pull/2
[#3]: https://github.com/vignaesh01/airport-vscode/pull/3
[#4]: https://github.com/vignaesh01/airport-vscode/pull/4
[#5]: https://github.com/vignaesh01/airport-vscode/issues/5
[#6]: https://github.com/vignaesh01/airport-vscode/issues/6
[#7]: https://github.com/vignaesh01/airport-vscode/issues/7
[#8]: https://github.com/vignaesh01/airport-vscode/issues/8
[#9]: https://github.com/vignaesh01/airport-vscode/pull/9
[#10]: https://github.com/vignaesh01/airport-vscode/pull/10
[#11]: https://github.com/vignaesh01/airport-vscode/issues/11
[#12]: https://github.com/vignaesh01/airport-vscode/pull/12
[#13]: https://github.com/vignaesh01/airport-vscode/pull/13
