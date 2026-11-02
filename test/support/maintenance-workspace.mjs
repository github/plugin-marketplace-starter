import { mkdtemp, rm, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { createWorkspace } from "../../evals/support/maintenance-workspace.mjs";

export async function fixture(t, scenario = "authoring") {
  const directory = await mkdtemp(resolve(tmpdir(), "maintenance-workspace-"));
  t.after(async () => {
    try { await unlink(resolve(directory, "node_modules")); }
    catch (error) { if (error.code !== "ENOENT") throw error; }
    await rm(directory, { recursive: true, force: true });
  });
  await createWorkspace(directory, scenario);
  return directory;
}
