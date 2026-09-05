import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { Scope } from "../expr/val.js";
import { err } from "./err.js";
import { parseGithubOutput } from "./parseGithubOutput.js";
import { renderEnvLayer } from "./renderEnvLayer.js";
import { renderTemplate } from "./renderTemplate.js";
import { tailLine } from "../tailLine.js";
import type { Res, StepModel, WalkCtx } from "./types.js";

/** A `run:` step, executed under its declared shell with its declared env. */
export async function runRun(
  step: StepModel,
  label: string,
  scope: Scope,
  ctx: WalkCtx,
): Promise<Res<Record<string, string>>> {
  const shell = step.shell === null || step.shell === undefined ? "bash" : String(step.shell);
  if (shell !== "bash" && shell !== "sh") {
    return err(`${label}: shell '${shell}' is not modelled`);
  }
  const script = renderTemplate(String(step.run), scope);
  if (script === null) {
    return err(`${label}: cannot resolve \${{ }} in run`);
  }
  const env: Record<string, string> = {
    // Everything else a step sees, it declared. A sandboxed runner swaps PATH
    // and HOME for its own.
    PATH: process.env.PATH ?? "",
    HOME: process.env.HOME ?? "",
    GITHUB_WORKSPACE: ctx.tree,
  };
  if (scope.github?.repository !== undefined) {
    env.GITHUB_REPOSITORY = scope.github.repository;
  }
  if (scope.github?.event_name !== undefined) {
    env.GITHUB_EVENT_NAME = scope.github.event_name;
  }
  if (ctx.actionPath !== undefined) {
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
  if (step["working-directory"] !== undefined && step["working-directory"] !== null) {
    const wd = renderTemplate(String(step["working-directory"]), scope);
    if (wd === null) {
      return err(`${label}: cannot resolve working-directory`);
    }
    cwd = resolve(ctx.tree, wd);
  }
  const outDir = await mkdtemp(join(tmpdir(), "willfire-out-"));
  const outFile = join(outDir, "output");
  await writeFile(outFile, "");
  // After the layers, so no `env:` block can redirect where outputs land.
  env.GITHUB_OUTPUT = outFile;
  const r = await ctx.deps.runCommand({
    script,
    shell,
    cwd,
    env,
    mounts: [
      { path: ctx.tree, writable: true },
      ...(ctx.actionRoot !== undefined ? [{ path: ctx.actionRoot, writable: false }] : []),
      { path: outDir, writable: true },
    ],
  });
  if (r.code !== 0) {
    // A step's tooling may put its fatal error on stdout; pnpm does.
    const fromStderr = tailLine(r.stderr);
    const tail = fromStderr === "" ? tailLine(r.stdout) : fromStderr;
    return err(`${label}: exited ${r.code}${tail === "" ? "" : ` (${tail})`}`);
  }
  const outputs = parseGithubOutput(await readFile(outFile, "utf8"));
  if (outputs === null) {
    return err(`${label}: malformed GITHUB_OUTPUT`);
  }
  return { ok: true, v: outputs };
}
