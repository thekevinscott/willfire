import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Scope } from "../expr/val.js";
import { bindActionInputs } from "./bindActionInputs.js";
import { err } from "./err.js";
import { parseGithubOutput } from "./parseGithubOutput.js";
import { renderEnvLayer } from "./renderEnvLayer.js";
import { tailLine } from "../tailLine.js";
import type { ActionModel, Res, StepModel, WalkCtx } from "./types.js";

/**
 * `node <main>` with inputs bound as `INPUT_*` env vars. What lands in
 * `$GITHUB_OUTPUT` is the whole output surface — a node action's manifest
 * `outputs:` block is documentation, not a mapping.
 */
export async function runNodeAction(
  step: StepModel,
  label: string,
  uses: string,
  action: ActionModel,
  actionDir: string,
  actionRoot: string | undefined,
  usingMajor: number,
  scope: Scope,
  ctx: WalkCtx,
): Promise<Res<Record<string, string>>> {
  if (usingMajor !== ctx.deps.nodeMajor) {
    return err(
      `${label}: action ${uses} wants node ${usingMajor}; the sandbox has node ${ctx.deps.nodeMajor}`,
    );
  }
  if (action?.runs?.pre !== undefined && action.runs.pre !== null) {
    return err(`${label}: action ${uses} declares a pre: step; not modelled`);
  }
  // `post:` runs after the job's own steps, so no job output can depend on it.
  const main = action?.runs?.main;
  if (typeof main !== "string") {
    return err(`${label}: action ${uses} has no runs.main`);
  }
  const env: Record<string, string> = {
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
  for (const layer of [...ctx.envLayers, step.env]) {
    const rendered = renderEnvLayer(layer, scope);
    if (!rendered.ok) {
      return err(`${label}: ${rendered.reason}`);
    }
    Object.assign(env, rendered.v);
  }
  // Unlike a composite's, a node action's input reads are opaque, so every
  // binding must be concrete up front.
  for (const [name, val] of Object.entries(bindActionInputs(action, step.with, scope))) {
    if (val.kind !== "value") {
      return err(`${label}: cannot resolve input '${name}' of ${uses}`);
    }
    env[`INPUT_${name.replace(/ /g, "_").toUpperCase()}`] = String(val.v);
  }
  const outDir = await mkdtemp(join(tmpdir(), "willfire-out-"));
  const outFile = join(outDir, "output");
  await writeFile(outFile, "");
  // After the layers, so no `env:` block can redirect either one.
  env.GITHUB_OUTPUT = outFile;
  env.WILLFIRE_ACTION_MAIN = join(actionDir, main);
  const r = await ctx.deps.runCommand({
    script: 'exec node "$WILLFIRE_ACTION_MAIN"',
    shell: "bash",
    cwd: ctx.tree,
    env,
    mounts: [
      { path: ctx.tree, writable: true },
      ...(actionRoot !== undefined ? [{ path: actionRoot, writable: false }] : []),
      { path: outDir, writable: true },
    ],
  });
  if (r.code !== 0) {
    // `core.setFailed`, how a JS action fails, routes its message to stdout.
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
