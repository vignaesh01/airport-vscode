const path = require('node:path')
const os = require('node:os')
const fs = require('node:fs')
const { runTests, downloadAndUnzipVSCode } = require('@vscode/test-electron')

async function main() {
  const extensionDevelopmentPath = path.resolve(__dirname, '..', '..')
  const extensionTestsPath = path.resolve(__dirname, 'suite', 'index.js')

  const workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'airport-test-ws-'))

  const vscodeExecutablePath = await downloadAndUnzipVSCode('stable')

  await runTests({
    vscodeExecutablePath,
    extensionDevelopmentPath,
    extensionTestsPath,
    launchArgs: [workspaceDir, '--disable-extensions', '--skip-welcome', '--skip-release-notes'],
    extensionTestsEnv: { AIRPORT_TEST_WORKSPACE: workspaceDir }
  })
}

main().catch((err) => {
  console.error('Integration test run failed:', err)
  process.exit(1)
})
