# Media shot list

Drop the finished files in this `media/` folder using the exact names below — the README
already references them, so nothing else needs to change once they're in place.

Record at a normal laptop width (~1440px), light theme preferred (Marketplace pages are
mostly viewed on a white background), and trim dead air from GIFs.

| File | Type | What to capture |
|---|---|---|
| `hero.gif` | GIF | The money shot for the top of the README: a workspace with a Claude Code terminal and an Antigravity (or Codex) terminal both running side by side, opened from the Airport sidebar's **+** picker. Show a status icon flip from sync (working) to bell-dot (needs you) on one terminal while the other stays on check (done), then click that terminal from the sidebar to jump to it. |
| `sidebar-overview.png` | Screenshot | The Airport sidebar with 3+ terminals listed (e.g. Claude, Antigravity, a plain shell), each showing a different colored status light, plus the Files view underneath following the selected terminal. |
| `new-terminal-picker.gif` | GIF | Clicking **+** in the Terminals view and choosing an agent (Claude Code, Codex, Antigravity, Devin, or plain shell) from the quick-pick, ending with the new terminal opening. |
| `status-lights.png` | Screenshot | Close crop of the sidebar showing all four status icons at once (bell, sync, check, outlined circle) for easy side-by-side reference with the status table in the README. |
| `icon-needs-you.png` | Icon crop | Tight crop of just the red `bell-dot` icon from a sidebar row, ~32x32px before it's scaled down by the README (transparent background so it sits cleanly in the table). |
| `icon-working.png` | Icon crop | Tight crop of the yellow `sync` icon from a sidebar row, same size/background treatment as above. |
| `icon-done.png` | Icon crop | Tight crop of the green `check` icon from a sidebar row, same size/background treatment as above. |
| `icon-exited.png` | Icon crop | Tight crop of the gray `circle-outline` icon from a sidebar row, same size/background treatment as above. |
| `files-view.gif` | GIF | The Files view panel showing a terminal's folder contents, with the sidebar terminal that's selected visible above it. |
| `notification.png` | Screenshot | An OS-level notification popup ("this terminal needs you") triggered by Airport, with VS Code visible behind it. |

The four `icon-*.png` crops are the exact codicons Airport uses (see `src/terminal-tree-provider.ts`):
`bell-dot` (needs you), `sync` (working), `check` (done), `circle-outline` (exited) — each tinted
by its VS Code theme color. Easiest way to grab clean crops: zoom into a screenshot of the sidebar
and crop just the icon glyph, or increase the OS display scale before screenshotting so the crop
stays sharp at 32x32.

Once files are added, optionally delete this list — it's just capture instructions, not
something the extension reads.
