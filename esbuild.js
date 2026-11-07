const esbuild = require('esbuild');
const watch = process.argv.includes('--watch');

const common = { bundle: true, sourcemap: true, logLevel: 'info' };
const targets = [
  { ...common, entryPoints: ['src/extension.ts'], outfile: 'dist/extension.js', platform: 'node', format: 'cjs', external: ['vscode'] },
  { ...common, entryPoints: ['src/webview/main.ts'], outfile: 'dist/webview.js', platform: 'browser', format: 'iife' },
];

(async () => {
  for (const t of targets) {
    if (watch) { (await esbuild.context(t)).watch(); } else { await esbuild.build(t); }
  }
})();
