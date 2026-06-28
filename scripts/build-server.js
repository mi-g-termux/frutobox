#!/usr/bin/env node
/**
 * build-server.js
 * Compiles server.ts → dist-server/server.js using esbuild.
 * Self-contained ESM bundle runnable with: node dist-server/server.js
 */

import { build } from 'esbuild';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');

await build({
  entryPoints: [path.join(root, 'server.ts')],
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  outfile: path.join(root, 'dist-server', 'server.js'),
  external: [
    'express',
    'nodemailer',
    'vite',
    'firebase-admin',
    'fs',
    'path',
    'url',
    'module',
    'crypto',
    'http',
    'https',
    'stream',
    'os',
    'child_process',
  ],
  banner: {
    // Only inject `require` for any CJS interop. __dirname/__filename are
    // already declared inside server.ts — declaring them here too causes
    // "Identifier '__dirname' has already been declared" at runtime.
    js: `import { createRequire as _cr } from 'module';\nconst require = _cr(import.meta.url);`,
  },
  logLevel: 'info',
});

console.log('\n✅ server.ts compiled → dist-server/server.js\n');
