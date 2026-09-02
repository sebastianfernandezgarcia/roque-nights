#!/usr/bin/env node
/** Bundles src/alignment-report.ts with the esbuild that ships with Remotion and runs it. */
import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(ROOT, 'out', 'alignment.cjs');
mkdirSync(join(ROOT, 'out'), { recursive: true });
execFileSync(
  join(ROOT, 'node_modules', '.bin', 'esbuild'),
  ['src/alignment-report.ts', '--bundle', '--platform=node', '--format=cjs', '--log-level=warning', `--outfile=${out}`],
  { cwd: ROOT, stdio: 'inherit' },
);
execFileSync(process.execPath, [out], { stdio: 'inherit' });
