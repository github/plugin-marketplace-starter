import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { delimiter, resolve } from 'node:path';
import { root as projectRoot, runtimeBridge, runtimeEnvironment } from '../scripts/evals.mjs';
import { spawnSync } from 'node:child_process';
import { packageVersion, runtimeProcessEnvironment } from '../scripts/eval-runtime.js';

test('direct Node execution gets a normalized executable path', () => {
  const env = runtimeEnvironment({ Path: '/existing/bin', KEEP: 'yes' });
  assert.equal(env.KEEP, 'yes');
  assert.equal(Object.keys(env).filter(key => key.toLowerCase() === 'path').length, 1);
  assert.equal(env.PATH.split(delimiter)[0], resolve(projectRoot, 'node_modules/.bin'));
  assert.ok(env.PATH.endsWith('/existing/bin'));
});

test('the runtime bridge runs the pinned Copilot CLI, not a newer auto-updated copy', () => {
  assert.equal(runtimeProcessEnvironment({}).COPILOT_AUTO_UPDATE, 'false');
  assert.equal(runtimeProcessEnvironment({ COPILOT_AUTO_UPDATE: 'true' }).COPILOT_AUTO_UPDATE, 'true');
  const manifest = JSON.parse(readFileSync(resolve(projectRoot, 'package.json'), 'utf8'));
  assert.equal(packageVersion(), manifest.devDependencies['@github/copilot']);
  const env = { ...process.env };
  delete env.COPILOT_AUTO_UPDATE;
  const result = spawnSync(process.execPath, [runtimeBridge, '--version'], {
    encoding: 'utf8', env, timeout: 60_000, windowsHide: true,
  });
  assert.equal(result.status, 0, result.stderr || result.error?.message);
  assert.match(result.stdout, new RegExp(`Pinned @github/copilot package: ${packageVersion().replaceAll('.', '\\.')}`));
  assert.match(result.stdout, new RegExp(`Copilot CLI ${packageVersion().replaceAll('.', '\\.')}\\b`));
});
