import { parse as parseYaml } from "yaml";
import type { Scope } from "../expr/val.js";
import { parseUses } from "../uses/parseUses.js";
import { calleeInputs } from "./calleeInputs.js";
import type { Workflow, WorkflowReader, WorkflowSource } from "../types.js";

const MAX_REUSABLE_DEPTH = 4;

const SHA_RE = /^[0-9a-f]{40}$/i;

const isSha = (ref: string): boolean => SHA_RE.test(ref);

export interface ResolvedReusable {
  subWf: Workflow | null;
  subSource: WorkflowSource;
  subScope: Scope;
  failure: string | null;
}

export async function resolveReusable(
  uses: string,
  withBlock: unknown,
  depth: number,
  reader: WorkflowReader,
  source: WorkflowSource,
  scoped: Scope,
): Promise<ResolvedReusable> {
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
          subScope = { inputs: calleeInputs(withBlock, subWf ?? {}), github: scoped.github };
        } catch (e) {
          failure = `YAML parse error in ${uses}: ${e}`;
        }
      }
    }
  }
  return { subWf, subSource, subScope, failure };
}
