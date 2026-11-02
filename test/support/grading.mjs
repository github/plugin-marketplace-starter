import { cp, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parse } from "yaml";

const root = fileURLToPath(new URL("../../", import.meta.url));

// Stages an eval's grading_environment.files the way Vally does, then imports
// one grader from there. A plugin grader imports ./common.mjs, which only sits
// beside it once both are staged, so this also proves the eval wires them up.
export async function loadGrader(evalSpec, grader) {
  const path = resolve(root, evalSpec);
  const spec = parse(await readFile(path, "utf8"));
  const directory = await mkdtemp(resolve(tmpdir(), "starter-grading-"));
  try {
    for (const { src, dest } of spec.grading_environment?.files ?? []) {
      await cp(resolve(dirname(path), src), resolve(directory, dest), { recursive: true });
    }
    return await import(pathToFileURL(resolve(directory, grader)).href);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
