import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, cp, readdir, writeFile, rm } from 'node:fs/promises';
import { relative, resolve, join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { contained, readCatalog } from '../scripts/catalog.mjs';
import { root as projectRoot } from '../scripts/validate.mjs';

test('local workflows install independently without fetching remote plugins', { timeout: 300000 }, async () => {
  const { catalog, localPlugins } = await readCatalog(projectRoot);
  const loader = resolve(projectRoot, 'node_modules/@github/copilot/npm-loader.js');
  for (const plugin of localPlugins) {
    const home = await mkdtemp(join(tmpdir(), 'marketplace install '));
    const source = join(home, 'source');
    const env = {
      ...process.env,
      COPILOT_HOME: home,
      COPILOT_CACHE_HOME: join(home, 'cache'),
      COPILOT_AUTO_UPDATE: 'false',
      NO_COLOR: '1'
    };
    for (const name of ['GH_TOKEN', 'GITHUB_TOKEN', 'COPILOT_GITHUB_TOKEN', 'GITHUB_COPILOT_API_TOKEN']) delete env[name];
    const run = args => {
      const result = spawnSync(process.execPath, [loader, ...args], {
        cwd: projectRoot, env, encoding: 'utf8', timeout: 30000, windowsHide: true
      });
      assert.ifError(result.error);
      assert.equal(result.status, 0, `${args.join(' ')}\n${result.stdout}\n${result.stderr}`);
      return result.stdout;
    };
    try {
      await mkdir(source, { recursive: true });
      await writeFile(join(source, 'marketplace.json'), JSON.stringify({ ...catalog, plugins: localPlugins }));
      for (const local of localPlugins) {
        await cp(await contained(projectRoot, local.source), resolve(source, local.source), { recursive: true });
      }
      const before = JSON.parse(run(['plugin', 'list', '--json']));
      assert.equal(before.filter(item => item.marketplace === catalog.name).length, 0,
        'The temporary client must not inherit installations from this marketplace');
      run(['plugin', 'marketplace', 'add', source]);
      run(['plugin', 'install', `${plugin.name}@${catalog.name}`]);
      const installed = JSON.parse(run(['plugin', 'list', '--json']));
      assert.ok(Array.isArray(installed), 'Expected the documented flat plugin list');
      const ours = installed.filter(item => item.marketplace === catalog.name && item.enabled);
      assert.deepEqual(ours.map(item => item.name), [plugin.name], 'A workflow must not install its sibling plugins');
      assert.equal(ours[0].enabled, true);
      const skillsRoot = resolve(source, plugin.source, 'skills');
      let expectedSkills = [];
      try {
        expectedSkills = (await readdir(skillsRoot, { withFileTypes: true }))
          .filter(entry => entry.isDirectory()).map(entry => entry.name).sort();
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
      }
      const installedSkills = JSON.parse(run(['skill', 'list', '--json']));
      assert.ok(Array.isArray(installedSkills), 'Expected the documented flat skill list');
      const pluginSkills = installedSkills.filter(item => item.source === 'plugin' && item.enabled)
        .filter(item => {
          const path = relative(skillsRoot, item.path);
          return path && !path.startsWith('..') && !path.includes('/') && !path.includes('\\');
        }).map(item => item.name).sort();
      assert.deepEqual(pluginSkills, expectedSkills, `Installed skills for ${plugin.name} must match its skills directories`);
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  }
});
