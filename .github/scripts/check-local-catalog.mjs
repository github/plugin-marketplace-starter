import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

export function checkLocalCatalog(root = process.cwd()) {
  const read = (path) => JSON.parse(readFileSync(resolve(root, path), "utf8"));
  for (const folder of readdirSync(resolve(root, "plugins"))) {
    read(`plugins/${folder}/plugin.json`);
  }
  for (const plugin of read("marketplace.json").plugins.filter((entry) => typeof entry.source === "string")) {
    const manifest = read(`${plugin.source}/plugin.json`);
    for (const field of ["name", "version", "description"]) {
      if (manifest[field] !== plugin[field]) {
        throw new Error(`${plugin.name}: marketplace.json and ${plugin.source}/plugin.json disagree on ${field}.`);
      }
    }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  checkLocalCatalog();
  console.log("Local catalog entries match their plugin.json files.");
}
