const esbuild = require('esbuild')

const watch = process.argv.includes('--watch')

/** @type {import('esbuild').BuildOptions} */
const options = {
  entryPoints: ['src/extension.ts'],
  bundle: true,
  outfile: 'out/extension.js',
  external: ['vscode'],
  format: 'cjs',
  platform: 'node',
  target: 'node20',
  sourcemap: true,
  minify: false
}

async function main() {
  if (watch) {
    const ctx = await esbuild.context(options)
    await ctx.watch()
    console.log('watching for changes...')
  } else {
    await esbuild.build(options)
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
