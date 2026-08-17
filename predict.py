#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.11"
# dependencies = ["pyyaml"]
# ///
"""Predict the set of CI check entries GitHub Actions will create for a PR.

Usage: uv run predict.py --repo owner/name --pr N [--json]

Output: one line per predicted check entry:
  <workflow path> :: <job display name> :: run|skipped|unknown
"""

import argparse
import itertools
import json
import re
import subprocess
import sys

# ---------------------------------------------------------------- gh helpers


def gh(path, *args):
    cmd = ["gh", "api", path, *args]
    out = subprocess.run(cmd, capture_output=True, text=True)
    if out.returncode != 0:
        raise RuntimeError(f"gh api {path} failed: {out.stderr.strip()}")
    return json.loads(out.stdout)


def gh_paginate(path):
    cmd = ["gh", "api", "--paginate", path]
    out = subprocess.run(cmd, capture_output=True, text=True)
    if out.returncode != 0:
        raise RuntimeError(f"gh api {path} failed: {out.stderr.strip()}")
    # --paginate concatenates JSON arrays; parse leniently
    dec = json.JSONDecoder()
    items, s, i = [], out.stdout.strip(), 0
    while i < len(s):
        obj, j = dec.raw_decode(s, i)
        items.extend(obj if isinstance(obj, list) else [obj])
        while j < len(s) and s[j] in " \n\r\t":
            j += 1
        i = j
    return items


def fetch_file(repo, ref, path):
    out = subprocess.run(
        ["gh", "api", f"repos/{repo}/contents/{path}?ref={ref}",
         "-H", "Accept: application/vnd.github.raw+json"],
        capture_output=True, text=True)
    if out.returncode != 0:
        return None
    return out.stdout


# ------------------------------------------------- GitHub filter pattern glob
# Grammar per docs: * (any chars except /), ** (any chars), ? (zero or one of
# preceding char), + (one or more of preceding char), [ranges], leading ! negates.


def pattern_to_regex(pat):
    i, out = 0, []
    while i < len(pat):
        c = pat[i]
        if c == "*":
            if i + 1 < len(pat) and pat[i + 1] == "*":
                out.append(".*")
                i += 2
                continue
            out.append("[^/]*")
        elif c == "?":
            out.append("?")
        elif c == "+":
            out.append("+")
        elif c == "[":
            j = pat.index("]", i + 1)
            out.append(pat[i:j + 1])
            i = j
        elif c == "\\":
            i += 1
            out.append(re.escape(pat[i]))
        else:
            out.append(re.escape(c))
        i += 1
    return re.compile("^" + "".join(out) + "$")


def match_filters(value, patterns):
    """Order-sensitive match: last matching pattern wins; ! negates."""
    matched = False
    for pat in patterns:
        neg = pat.startswith("!")
        p = pat[1:] if neg else pat
        if pattern_to_regex(p).match(value):
            matched = not neg
    return matched


# ------------------------------------------------------------ trigger checks

SKIP_RE = re.compile(
    r"\[(skip ci|ci skip|no ci|skip actions|actions skip)\]", re.IGNORECASE)
SKIP_TRAILER_RE = re.compile(r"^skip-checks:\s*true", re.IGNORECASE | re.MULTILINE)

DEFAULT_TYPES = {"opened", "synchronize", "reopened"}


def get_pr_trigger(wf):
    """Return the on.pull_request config (or MISSING). Handles YAML 'on'->True."""
    on = wf.get("on", wf.get(True))
    if on is None:
        return "MISSING"
    if isinstance(on, str):
        return {} if on == "pull_request" else "MISSING"
    if isinstance(on, list):
        return {} if "pull_request" in on else "MISSING"
    if isinstance(on, dict):
        if "pull_request" in on:
            return on["pull_request"] or {}
        return "MISSING"
    return "MISSING"


def workflow_dispatches(wf, ctx):
    """Return (verdict, reason). verdict in dispatch|no-dispatch|unknown."""
    trig = get_pr_trigger(wf)
    if trig == "MISSING":
        return "no-dispatch", "no pull_request trigger"

    types = set(trig.get("types", DEFAULT_TYPES))
    if ctx["action"] not in types:
        return "no-dispatch", f"action {ctx['action']!r} not in types {sorted(types)}"

    if "branches" in trig and "branches-ignore" in trig:
        return "unknown", "both branches and branches-ignore set"
    if "branches" in trig:
        if not match_filters(ctx["base_ref"], trig["branches"]):
            return "no-dispatch", f"base branch {ctx['base_ref']!r} not in branches"
    if "branches-ignore" in trig:
        if match_filters(ctx["base_ref"], trig["branches-ignore"]):
            return "no-dispatch", "base branch in branches-ignore"

    if "paths" in trig and "paths-ignore" in trig:
        return "unknown", "both paths and paths-ignore set"
    if "paths" in trig:
        if not any(match_filters(f, trig["paths"]) for f in ctx["files"]):
            return "no-dispatch", "no changed file matches paths"
    if "paths-ignore" in trig:
        if all(match_filters(f, trig["paths-ignore"]) for f in ctx["files"]):
            return "no-dispatch", "all changed files match paths-ignore"

    return "dispatch", "trigger matched"


# ---------------------------------------------------------------- job expansion


def expand_matrix(strategy):
    """Return list of matrix combination dicts, or None if dynamic."""
    matrix = (strategy or {}).get("matrix")
    if matrix is None:
        return [None]
    if isinstance(matrix, str):  # ${{ fromJSON(...) }} etc.
        return None
    include = matrix.get("include", [])
    exclude = matrix.get("exclude", [])
    if isinstance(include, str) or isinstance(exclude, str):
        return None
    axes = {k: v for k, v in matrix.items() if k not in ("include", "exclude")}
    for v in axes.values():
        if not isinstance(v, list):
            return None
    combos = [dict(zip(axes, vals)) for vals in itertools.product(*axes.values())]
    combos = [c for c in combos
              if not any(all(c.get(k) == v for k, v in ex.items()) for ex in exclude)]
    extra = []
    for inc in include:
        overlapping = {k: v for k, v in inc.items() if k in axes}
        targets = [c for c in combos
                   if all(c.get(k) == v for k, v in overlapping.items())]
        if overlapping and targets:
            for c in targets:
                c.update(inc)
        else:
            extra.append(dict(inc))
    combos.extend(extra)
    return combos or [None]


def render_name(template, combo):
    def sub(m):
        expr = m.group(1).strip()
        if expr.startswith("matrix.") and combo:
            return str(combo.get(expr[len("matrix."):], ""))
        return m.group(0)
    return re.sub(r"\$\{\{(.*?)\}\}", sub, template)


def job_display_name(job_id, job, combo):
    if "name" in job:
        name = render_name(str(job["name"]), combo)
    else:
        name = job_id
        if combo:
            name += " (" + ", ".join(str(v) for v in combo.values()) + ")"
    return name


def eval_if(cond, ctx):
    """Return run|skipped|unknown for a job-level if."""
    if cond is None:
        return "run"
    c = str(cond).strip()
    c = re.sub(r"^\$\{\{(.*)\}\}$", r"\1", c).strip()
    if c in ("false", "False"):
        return "skipped"
    if c in ("true", "True") or c == "always()":
        return "run"
    m = re.match(r"github\.event_name\s*(==|!=)\s*'([^']*)'$", c)
    if m:
        eq = (m.group(2) == "pull_request")
        hit = eq if m.group(1) == "==" else not eq
        return "run" if hit else "skipped"
    return "unknown"


def expand_jobs(wf, ctx, repo, ref, depth=0, prefix=""):
    """Yield (display_name, status, reason) for all jobs in a workflow dict."""
    entries = []
    jobs = wf.get("jobs", {})
    statuses = {}  # job_id -> run|skipped|unknown (for needs propagation)
    for job_id, job in jobs.items():
        job = job or {}
        status = eval_if(job.get("if"), ctx)
        reason = f"if: {job.get('if')!r}" if job.get("if") is not None else ""
        # needs propagation: a job whose dependency is skipped is skipped,
        # unless its if contains always()
        needs = job.get("needs", [])
        needs = [needs] if isinstance(needs, str) else needs
        cond = str(job.get("if") or "")
        if status != "skipped" and "always()" not in cond:
            for n in needs:
                if statuses.get(n) == "skipped":
                    status, reason = "skipped", f"needs {n!r} which is skipped"
                elif statuses.get(n) == "unknown" and status == "run":
                    status, reason = "unknown", f"needs {n!r} whose status is unknown"
        statuses[job_id] = status

        if "uses" in job:  # reusable workflow call
            uses = job["uses"]
            base_name = prefix + job_display_name(job_id, {**job, "name": job.get("name", job_id)}, None)
            if depth >= 1:
                entries.append((base_name, "unknown", "nested reusable workflow"))
                continue
            m = re.match(r"^\./(.+)$", uses)
            if not m:
                entries.append((base_name, "unknown", f"non-local reusable: {uses}"))
                continue
            content = fetch_file(repo, ref, m.group(1))
            if content is None:
                entries.append((base_name, "unknown", f"cannot fetch {uses}"))
                continue
            sub_wf = yaml_load(content)
            if status == "skipped":
                entries.append((base_name, "skipped", reason))
                continue
            sub = expand_jobs(sub_wf, ctx, repo, ref, depth + 1,
                              prefix=base_name + " / ")
            entries.extend(sub)
            continue

        combos = expand_matrix(job.get("strategy"))
        if combos is None:
            entries.append((prefix + job_id, "unknown", "dynamic matrix"))
            continue
        for combo in combos:
            entries.append((prefix + job_display_name(job_id, job, combo),
                            status, reason))
    return entries


def yaml_load(content):
    import yaml
    return yaml.safe_load(content)


# ------------------------------------------------------------------- pipeline


def predict(repo, pr_number):
    pr = gh(f"repos/{repo}/pulls/{pr_number}")
    ctx = {
        "action": "synchronize" if pr["commits"] > 1 else "opened",
        "base_ref": pr["base"]["ref"],
        "files": [f["filename"]
                  for f in gh_paginate(f"repos/{repo}/pulls/{pr_number}/files")],
    }
    head_sha = pr["head"]["sha"]
    head_msg = gh(f"repos/{repo}/commits/{head_sha}")["commit"]["message"]

    results = []
    if SKIP_RE.search(head_msg) or SKIP_TRAILER_RE.search(head_msg):
        return results, "head commit message contains a skip instruction"

    workflows = gh_paginate(f"repos/{repo}/actions/workflows")
    for w in workflows:
        path = w["path"]
        if not path.startswith(".github/workflows/"):
            continue
        if w["state"] != "active":
            results.append({"workflow": path, "job": "*", "status": "no-dispatch",
                            "reason": f"workflow state: {w['state']}"})
            continue
        content = fetch_file(repo, head_sha, path)
        if content is None:
            results.append({"workflow": path, "job": "*", "status": "unknown",
                            "reason": "cannot fetch workflow file at head"})
            continue
        try:
            wf = yaml_load(content)
        except Exception as e:
            results.append({"workflow": path, "job": "*", "status": "unknown",
                            "reason": f"YAML parse error: {e}"})
            continue
        verdict, reason = workflow_dispatches(wf, ctx)
        if verdict != "dispatch":
            results.append({"workflow": path, "job": "*", "status": verdict,
                            "reason": reason})
            continue
        for name, status, jreason in expand_jobs(wf, ctx, repo, head_sha):
            results.append({"workflow": path, "job": name, "status": status,
                            "reason": jreason or reason})
    return results, None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--repo", required=True)
    ap.add_argument("--pr", required=True, type=int)
    ap.add_argument("--json", action="store_true")
    args = ap.parse_args()

    results, skip = predict(args.repo, args.pr)
    if args.json:
        print(json.dumps({"entries": results, "skip": skip}, indent=2))
        return
    if skip:
        print(f"# {skip} -> nothing dispatches")
        return
    for r in results:
        if r["job"] == "*":
            print(f"# {r['workflow']} :: {r['status']} ({r['reason']})")
        else:
            print(f"{r['workflow']} :: {r['job']} :: {r['status']}")


if __name__ == "__main__":
    main()
