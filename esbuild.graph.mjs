/**
 * esbuild configuration for graph React bundle
 *
 * Bundles ReactFlow with React loaded from CDN globals.
 */

import * as esbuild from 'esbuild';

const isWatch = process.argv.includes('--watch');

const config = {
  entryPoints: ['src/graph/index.jsx'],
  bundle: true,
  outfile: 'public/js/graph-bundle.js',
  format: 'iife',
  globalName: 'InfraGraph',
  minify: !isWatch,
  sourcemap: isWatch,
  loader: { '.jsx': 'jsx' },
  jsx: 'automatic',
  jsxImportSource: 'react',
  // Map React imports to CDN globals
  alias: {
    'react': './src/graph/react-shim.js',
    'react-dom': './src/graph/react-shim.js',
    'react/jsx-runtime': './src/graph/react-shim.js',
    'react/jsx-dev-runtime': './src/graph/react-shim.js',
    'react-dom/client': './src/graph/react-shim.js',
  },
};

if (isWatch) {
  const ctx = await esbuild.context(config);
  await ctx.watch();
  console.log('Watching for changes...');
} else {
  const result = await esbuild.build(config);
  console.log('Build complete:', result);
}
