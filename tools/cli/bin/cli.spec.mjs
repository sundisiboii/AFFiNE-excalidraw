import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const cli = fileURLToPath(new URL('./cli.js', import.meta.url));

for (const exitCode of [0, 23]) {
  test(
    `preserves Yarn child exit code ${exitCode}`,
    {
      skip: process.platform === 'win32',
    },
    () => {
      const directory = mkdtempSync(join(tmpdir(), 'affine-cli-exit-'));
      try {
        const yarn = join(directory, 'yarn');
        writeFileSync(yarn, `#!/bin/sh\nexit ${exitCode}\n`);
        chmodSync(yarn, 0o755);
        const result = spawnSync(process.execPath, [cli, 'bundle'], {
          env: { ...process.env, PATH: directory },
          encoding: 'utf8',
        });
        assert.equal(result.status, exitCode, result.stderr);
      } finally {
        rmSync(directory, { recursive: true, force: true });
      }
    }
  );
}

test('fails when Yarn cannot be launched', () => {
  const directory = mkdtempSync(join(tmpdir(), 'affine-cli-missing-yarn-'));
  try {
    const result = spawnSync(process.execPath, [cli, 'bundle'], {
      env: { ...process.env, PATH: directory },
      encoding: 'utf8',
    });
    assert.equal(result.status, 1);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
