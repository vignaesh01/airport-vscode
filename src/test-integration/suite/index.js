const path = require('node:path')
const Mocha = require('mocha')
const { glob } = require('glob')

async function run() {
  const mocha = new Mocha({ ui: 'tdd', timeout: 30000, color: true })
  const testsRoot = __dirname

  const files = await glob('**/*.spec.js', { cwd: testsRoot })
  files.forEach((f) => mocha.addFile(path.resolve(testsRoot, f)))

  return new Promise((resolve, reject) => {
    mocha.run((failures) => {
      if (failures > 0) reject(new Error(`${failures} tests failed.`))
      else resolve()
    })
  })
}

module.exports = { run }
