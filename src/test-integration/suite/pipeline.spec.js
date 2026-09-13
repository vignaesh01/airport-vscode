// Integration test: exercises the real pipeline this port depends on — a
// live vscode.window.createTerminal(), waiting for shell integration,
// sendText(), onDidStartTerminalShellExecution, execution.read(), and the
// headless-xterm status classification — against a real Extension Host, not
// a mock. This is the closest automatable proxy to the plan's "F5, start a
// real agent, watch yellow -> red -> green" kill-criterion.
const assert = require('node:assert')
const path = require('node:path')
const fs = require('node:fs')
const os = require('node:os')
const vscode = require('vscode')

const outTest = path.resolve(__dirname, '..', '..', '..', 'out-test')
const { SessionManager } = require(path.join(outTest, 'session-manager'))
const { AGENTS } = require(path.join(outTest, 'agents'))

function makeFakeContext() {
  const store = new Map()
  return {
    workspaceState: {
      get: (key, fallback) => (store.has(key) ? store.get(key) : fallback),
      update: (key, value) => {
        store.set(key, value)
        return Promise.resolve()
      }
    }
  }
}

function waitFor(predicate, timeoutMs, intervalMs = 100) {
  const start = Date.now()
  return new Promise((resolve, reject) => {
    const tick = () => {
      if (predicate()) return resolve()
      if (Date.now() - start > timeoutMs) return reject(new Error('waitFor timed out'))
      setTimeout(tick, intervalMs)
    }
    tick()
  })
}

suite('Airport status pipeline (live terminal)', () => {
  const workspaceDir = process.env.AIRPORT_TEST_WORKSPACE || require('node:os').tmpdir()
  let manager

  suiteSetup(() => {
    // Registered once, reused by both tests below via a distinct agent id
    // each — avoids mutating any existing entry in AGENTS.
    AGENTS.push({
      id: 'test-prompt',
      label: 'Test Prompt',
      command: 'powershell -NoProfile -Command "Write-Host -NoNewline \'Continue? (y/n)\'"'
    })
    AGENTS.push({
      id: 'test-quiet',
      label: 'Test Quiet',
      command: 'powershell -NoProfile -Command "Write-Host \'all done\'"'
    })
    // Mirrors Claude Code's boxed permission prompt: every row (including
    // the question and option lines) is wrapped in a literal │ border, not
    // a bare edge. This is the case status-engine.ts's BOX_BORDER_RE exists
    // for — see status-engine.test.ts for the equivalent unit-level check.
    AGENTS.push({
      id: 'test-boxed-prompt',
      label: 'Test Boxed Prompt',
      command:
        "powershell -NoProfile -Command \"Write-Host '│ Do you want to proceed? │'; Write-Host '│ ❯ 1. Yes │'\""
    })
  })

  setup(() => {
    manager = new SessionManager(makeFakeContext())
  })

  teardown(() => {
    manager.dispose()
  })

  test('a real terminal emitting a prompt-shaped line settles on red', async () => {
    const record = manager.create(workspaceDir, 'test-prompt')

    await waitFor(() => manager.statusOf(record.id) === 'red', 15000)
    assert.strictEqual(manager.statusOf(record.id), 'red')
    assert.strictEqual(manager.needsYouCount(), 1)
  })

  test('a real terminal that goes quiet with no prompt settles on green', async () => {
    const record = manager.create(workspaceDir, 'test-quiet')

    await waitFor(() => manager.statusOf(record.id) === 'green', 15000)
    assert.strictEqual(manager.statusOf(record.id), 'green')
  })

  test('a real terminal rendering a boxed (│-bordered) prompt still settles on red', async () => {
    const record = manager.create(workspaceDir, 'test-boxed-prompt')

    await waitFor(() => manager.statusOf(record.id) === 'red', 15000)
    assert.strictEqual(manager.statusOf(record.id), 'red')
  })

  test('a session folder outside the open workspace is offered as a workspace folder', async () => {
    // The test runner opens `workspaceDir` itself as the workspace, so a
    // *different* folder is needed to exercise the "not already covered"
    // branch of offerAddToWorkspace.
    const outsideFolder = fs.mkdtempSync(path.join(os.tmpdir(), 'airport-outside-'))
    assert.strictEqual(vscode.workspace.getWorkspaceFolder(vscode.Uri.file(outsideFolder)), undefined)

    const originalShowInformationMessage = vscode.window.showInformationMessage
    let promptedWith = null
    vscode.window.showInformationMessage = (message, ...items) => {
      promptedWith = { message, items }
      return Promise.resolve('Add to Workspace')
    }
    try {
      manager.create(outsideFolder, 'test-quiet')
      await waitFor(() => vscode.workspace.getWorkspaceFolder(vscode.Uri.file(outsideFolder)) !== undefined, 5000)
    } finally {
      vscode.window.showInformationMessage = originalShowInformationMessage
    }

    assert.ok(promptedWith, 'expected showInformationMessage to be called')
    assert.ok(promptedWith.items.includes('Add to Workspace'))
    assert.ok(
      vscode.workspace.workspaceFolders?.some((f) => f.uri.fsPath === vscode.Uri.file(outsideFolder).fsPath)
    )
  })
})
