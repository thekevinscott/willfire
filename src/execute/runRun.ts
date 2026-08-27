import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { Scope } from "../expr/val.js";
import { err } from "./err.js";
import { parseGithubOutput } from "./parseGithubOutput.js";
import { renderEnvLayer } from "./renderEnvLayer.js";
import { renderTemplate } from "./renderTemplate.js";
import type { Res, WalkCtx } from "./types.js";

export async function runRun(
  step: any,
  label: string,
  scope: Scope,
  ctx: WalkCtx,
): Promise<Res<Record<string, string>>> {
  const shell = step.shell == null ? "bash" : String(step.shell);
  if (shell !== "bash" && shell !== "sh") {
    return err(`${label}: shell '${shell}' is not modelled`);
  }
  const script = renderTemplate(String(step.run), scope);
  if (script == null) {
    return err(`${label}: cannot resolve \${{ }} in run`);
  }
  const env: Record<string, string> = {
    PATH: process.env.PATH ?? "",
    HOME: process.env.HOME ?? "",
    GITHUB_WORKSPACE: ctx.tree,
  };
  if (ctx.actionPath != null) {
    env.GITHUB_ACTION_PATH = ctx.actionPath;
  }
  for (const layer of [...ctx.envLayers, step.env]) {
    const rendered = renderEnvLayer(layer, scope);
    if (!rendered.ok) {
      return err(`${label}: ${rendered.reason}`);
    }
    Object.assign(env, rendered.v);
  }
  let cwd = ctx.tree;
  if (step["working-directory"] != null) {
    const wd = renderTemplate(String(step["working-directory"]), scope);
    if (wd == null) {
      return err(`${label}: cannot resolve working-directory`);
    }
    cwd = resolve(ctx.tree, wd);
  }
  const outDir = await mkdtemp(join(tmpdir(), "willfire-out-"));
  const outFile = join(outDir, "output");
  await writeFile(outFile, "");
  env.GITHUB_OUTPUT = outFile;
  const r = await ctx.deps.runCommand({ script, shell, cwd, env });
  if (r.code !== 0) {
    const trimmed = r.stderr.trim();
    const tail = trimmed.slice(trimmed.lastIndexOf("\n") + 1);
    return err(`${label}: exited ${r.code}${tail === "" ? "" : ` (${tail})`}`);
  }
  const outputs = parseGithubOutput(await readFile(outFile, "utf8"));
  if (outputs == null) {
    return err(`${label}: malformed GITHUB_OUTPUT`);
  }
  return { ok: true, v: outputs };
}
