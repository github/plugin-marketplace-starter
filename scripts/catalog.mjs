import assert from "node:assert/strict";
import { readFile, realpath } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { parseDocument } from "yaml";

export const namePattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function parseYaml(text, label) {
  const document = parseDocument(text, { uniqueKeys: true });
  if (document.errors.length) throw new Error(`${label}: ${document.errors.map((error) => error.message).join("; ")}`);
  return document.toJS();
}

export function frontmatter(text, label) {
  const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  if (!match) throw new Error(`${label}: YAML frontmatter is required`);
  const data = parseYaml(match[1], label);
  if (!data || typeof data.name !== "string" || !namePattern.test(data.name) || data.name.length > 64
    || typeof data.description !== "string" || !data.description.trim() || data.description.length > 1024) {
    throw new Error(`${label}: a valid name and nonempty description are required`);
  }
  if (!text.slice(match[0].length).trim()) throw new Error(`${label}: instructions are empty`);
  return data;
}

export async function contained(base, path) {
  const root = await realpath(base);
  const target = await realpath(resolve(root, path));
  const rel = relative(root, target);
  if (isAbsolute(rel) || rel.split(sep).includes("..")) throw new Error(`Path escapes its plugin: ${path}`);
  return target;
}
const relativePath = (value) => typeof value === "string" && value.length > 0
  && !/[\\:\u0000-\u001f\u007f]/.test(value)
  && value.split("/").every((part) => part && part !== "." && part !== "..");

export function validateRemoteSource(source) {
  assert.ok(source && typeof source === "object" && !Array.isArray(source), "Remote source must be an object.");
  assert.ok(Object.keys(source).every((key) => ["source", "repo", "path", "ref", "sha"].includes(key)), "Unknown remote source field.");
  assert.equal(source.source, "github", "Only GitHub remote references are supported.");
  assert.equal(typeof source.repo, "string", "Remote repo must be owner/repo.");
  assert.match(source.repo, /^[A-Za-z0-9][A-Za-z0-9-]*\/(?!\.{1,2}$)[A-Za-z0-9_.-]+$/, "Remote repo must be owner/repo.");
  if (source.path !== undefined) assert.ok(relativePath(source.path), "Remote path must be a canonical repository-relative directory.");
  if (source.ref !== undefined) assert.ok(typeof source.ref === "string" && source.ref.trim()
    && !/[\u0000-\u001f\u007f]/.test(source.ref), "Remote ref must be nonempty text.");
  if (source.sha !== undefined) assert.ok(typeof source.sha === "string" && /^[a-fA-F0-9]{40}$/.test(source.sha), "Remote sha must be a full commit ID.");
}

export function partitionCatalog(catalog) {
  assert.equal(typeof catalog?.name, "string");
  assert.match(catalog.name, namePattern);
  assert.ok(typeof catalog.owner?.name === "string" && catalog.owner.name.trim());
  assert.ok(Array.isArray(catalog.plugins) && catalog.plugins.length > 0);
  const names = new Set();
  const localPlugins = [];
  const remotePlugins = [];
  for (const entry of catalog.plugins) {
    assert.equal(typeof entry?.name, "string");
    assert.match(entry.name, namePattern);
    assert.ok(!names.has(entry.name), `Duplicate plugin: ${entry.name}`);
    names.add(entry.name);
    if (typeof entry.source === "string") {
      assert.ok(entry.source.startsWith("./plugins/") && relativePath(entry.source.slice(2)), "Local source must stay under ./plugins/.");
      localPlugins.push(entry);
    } else {
      validateRemoteSource(entry.source);
      remotePlugins.push(entry);
    }
  }
  return { catalog, localPlugins, remotePlugins };
}

export async function readCatalog(directory) {
  return partitionCatalog(JSON.parse(await readFile(resolve(directory, "marketplace.json"), "utf8")));
}
