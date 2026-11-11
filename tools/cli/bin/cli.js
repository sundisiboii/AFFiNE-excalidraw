#!/usr/bin/env node
import { spawnSync } from 'node:child_process';

const result = spawnSync('yarn', ['r', 'affine.ts', ...process.argv.slice(2)], {
  stdio: 'inherit',
});

if (result.error) {
  console.error(result.error);
}
process.exitCode = result.status ?? 1;
