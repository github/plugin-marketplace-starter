import { build } from 'esbuild';
import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const check = process.argv.includes('--check');
const output = resolve(root, 'plugins/json-configuration/dist/server.mjs');
const result = await build({
  absWorkingDir: root,
  entryPoints: ['plugins/json-configuration/src/server.ts'],
  outfile: output,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  bundle: true,
  write: false,
  metafile: true,
  legalComments: 'inline',
  banner: { js: "import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);" }
});

const packagePaths = new Set();
for (const input of Object.keys(result.metafile.inputs)) {
  const match = input.replaceAll('\\', '/').match(/^(.*node_modules\/(?:@[^/]+\/)?[^/]+)/);
  if (match) packagePaths.add(match[1]);
}
let notices = 'Third-party licenses for the bundled JSON configuration MCP server.\n';
for (const path of [...packagePaths].sort()) {
  const dir = resolve(root, path);
  const pkg = JSON.parse(await readFile(resolve(dir, 'package.json'), 'utf8'));
  const licenses = (await readdir(dir)).filter(name => /^licen[sc]e(?:[.-]|$)/i.test(name)).sort();
  if (!licenses.length) throw new Error(`No license text found for bundled package ${pkg.name}`);
  notices += `\n${'='.repeat(72)}\n${pkg.name}@${pkg.version} (${pkg.license ?? 'see license'})\n`;
  for (const license of licenses) notices += `${await readFile(resolve(dir, license), 'utf8')}\n`;
}

const files = new Map([
  [output, result.outputFiles[0].text],
  [resolve(dirname(output), 'THIRD_PARTY_NOTICES.txt'), notices]
]);
const grader = await build({
  absWorkingDir: root,
  entryPoints: ['evals/graders/src/authoring.mjs'],
  outfile: resolve(root, 'evals/graders/dist/authoring.mjs'),
  platform: 'node', format: 'esm', target: 'node22',
  bundle: true, write: false, legalComments: 'inline',
  banner: { js: "import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);" }
});
files.set(resolve(root, 'evals/graders/dist/authoring.mjs'), grader.outputFiles[0].text);
files.set(resolve(root, 'evals/graders/dist/THIRD_PARTY_NOTICES.txt'),
  'yaml (MIT), https://github.com/eemeli/yaml\n\n' +
  await readFile(resolve(root, 'node_modules/yaml/LICENSE'), 'utf8'));
const normalize = text => text.replaceAll('\r\n', '\n');
for (const [path, contents] of files) {
  if (check) {
    let current;
    try { current = await readFile(path, 'utf8'); }
    catch (error) { if (error.code === 'ENOENT') throw new Error(`Missing generated artifact: ${path}. Run npm run build.`); throw error; }
    if (normalize(current) !== normalize(contents)) throw new Error(`Stale generated artifact: ${path}. Run npm run build.`);
  } else {
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, contents);
  }
}
console.log(check ? 'Generated MCP bundle, authoring grader, and notices are current.' : 'Built the MCP bundle, authoring grader, and notices.');
