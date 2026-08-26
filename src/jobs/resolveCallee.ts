import { parse as parseYaml } from "yaml";
import type { Scope } from "../expr/val.js";
import { parseUses } from "../uses/parseUses.js";
import type { Workflow, WorkflowReader, WorkflowSource } from "../types.js";
import { calleeInputs } from "./calleeInputs.js";

/**
 * GitHub allows a reusable-workflow call chain four levels deep. Past that the
 * run itself fails, so anything deeper is not a name we could predict anyway.
 * Probe-verified to three levels: `call-nested / Mid Call / inner`.
 *
 * A cross-repo hop costs the same one level as a local one, so a chain that
 * mixes the two is counted the same way.
 */
const MAX_REUSABLE_DEPTH = 4;

/** `ref` is already a commit id, so resolving it is a no-op. */
const SHA_RE = /^[0-9a-f]{40}$/i;

const isSha = (ref: string): boolean => SHA_RE.test(ref);

export interface ResolvedCallee {
  subWf: Workflow | null;
  /** Where the callee's own `./` calls will resolve. A remote `uses:` moves
   * this to the callee's repo and pinned ref; a local one leaves it alone. */
  subSource: WorkflowSource;
  /** What `inputs.*` means on the other side of the call. */
  subScope: Scope;
  failure: string | null;
}

/** Resolve the called workflow once, not once per matrix combination. */
export async function resolveCallee(
  uses: string,
  withBlock: unknown,
  source: WorkflowSource,
  reader: WorkflowReader,
  depth: number,
  scoped: Scope,
): Promise<ResolvedCallee> {
  let subWf: Workflow | null = null;
  let failure: string | null = null;
  let subSource: WorkflowSource = source;
  let subScope: Scope = {};
  const target = parseUses(uses);
  if (depth + 1 > MAX_REUSABLE_DEPTH) {
    failure = `reusable workflow nested deeper than ${MAX_REUSABLE_DEPTH} levels`;
  } else if (target == null) {
    failure = `unresolvable reusable reference: ${uses}`;
  } else {
    // A local `./` call stays on the caller's source, which is already
    // pinned to a commit. A cross-repo one arrives as whatever the `uses:`
    // string spelled — `@v0` — and has to be resolved before anything is
    // read from it, so the file that gets read and the commit the
    // prediction names are the same one.
    let resolved: WorkflowSource | null = source;
    if (target.source != null) {
      const { ref } = target.source;
      const sha = isSha(ref) ? ref : await reader.resolveRef(target.source);
      resolved = sha == null ? null : { ...target.source, sha };
    }
    if (resolved == null) {
      failure = `cannot resolve ref for ${uses}`;
    } else {
      subSource = resolved;
      const content = await reader.fetchWorkflow(target.path, subSource);
      if (content == null) {
        failure = `cannot fetch ${uses}`;
      } else {
        try {
          subWf = parseYaml(content);
          // `inputs.*` changes at the call boundary; `github.*` does not.
          // A callee's jobs run in the caller's repo, so the facts seeded
          // at the top of the prediction stay true all the way down.
          subScope = {
            inputs: calleeInputs(withBlock, subWf ?? {}, scoped),
            github: scoped.github,
          };
        } catch (e) {
          failure = `YAML parse error in ${uses}: ${e}`;
        }
      }
    }
  }
  return { subWf, subSource, subScope, failure };
}
