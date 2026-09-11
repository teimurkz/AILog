import { build } from 'esbuild';
import { readFile } from 'node:fs/promises';
import { builtinModules } from 'node:module';

const result = await build({
  entryPoints: ['functions/src/index.ts'], outfile: 'functions/lib/index.js',
  bundle: true, platform: 'node', target: 'node22', format: 'cjs', packages: 'external',
  sourcemap: true, metafile: true,
});
const pkg = JSON.parse(await readFile('functions/package.json', 'utf8'));
for (const output of Object.values(result.metafile.outputs)) for (const dependency of output.imports) {
  if (!dependency.external || dependency.path.startsWith('node:') || builtinModules.includes(dependency.path)) continue;
  const name = dependency.path.startsWith('@') ? dependency.path.split('/').slice(0, 2).join('/') : dependency.path.split('/')[0];
  if (!pkg.dependencies[name]) throw new Error(`Missing Firebase Functions dependency: ${name}`);
}
console.log('Firebase Functions built. No deployment or database changes performed.');
