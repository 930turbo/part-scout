import { build } from 'esbuild';
await build({
  entryPoints: ['desktop/entry.ts'],
  outfile: 'desktop/server.cjs',
  bundle: true,
  platform: 'node',
  target: 'node24',
  format: 'cjs',
  external: ['electron'],
  sourcemap: false,
});
console.log('Desktop server bundled.');
