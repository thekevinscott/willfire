#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.11"
# dependencies = ["pyyaml"]
# ///
"""Compare predict.py output against what GitHub Actions actually dispatched.

Usage: uv run verify.py --repo owner/name --pr N

Actual ground truth: workflow runs for the PR head SHA with a pull_request
event, and the job entries inside each run (skipped jobs included).
"""

import argparse
import json
import subprocess
import sys

from predict import gh, gh_paginate, predict


def actual_entries(repo, pr_number):
    pr = gh(f"repos/{repo}/pulls/{pr_number}")
    head_sha = pr["head"]["sha"]
    runs = gh_paginate(
        f"repos/{repo}/actions/runs?head_sha={head_sha}&event=pull_request")
    if runs and isinstance(runs[0], dict) and "workflow_runs" in runs[0]:
        runs = [r for page in runs for r in page["workflow_runs"]]
    entries = {}
    incomplete = []
    for run in runs:
        if run["status"] != "completed":
            incomplete.append(run["path"])
        jobs = gh_paginate(f"repos/{repo}/actions/runs/{run['id']}/jobs")
        if jobs and isinstance(jobs[0], dict) and "jobs" in jobs[0]:
            jobs = [j for page in jobs for j in page["jobs"]]
        for j in jobs:
            status = "skipped" if j["conclusion"] == "skipped" else "run"
            entries[(run["path"], j["name"])] = status
    return entries, incomplete


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--repo", required=True)
    ap.add_argument("--pr", required=True, type=int)
    args = ap.parse_args()

    predicted_raw, skip = predict(args.repo, args.pr)
    predicted = {(r["workflow"], r["job"]): r["status"]
                 for r in predicted_raw if r["job"] != "*"}
    unknown_wfs = {r["workflow"] for r in predicted_raw if r["status"] == "unknown"}
    actual, incomplete = actual_entries(args.repo, args.pr)

    if incomplete:
        print(f"WARNING: runs still in progress: {incomplete}")

    ok = True
    for key in sorted(set(predicted) | set(actual)):
        p, a = predicted.get(key), actual.get(key)
        wf, job = key
        if p == a:
            print(f"  OK  {wf} :: {job} :: {a}")
        elif p == "unknown":
            print(f"  ?   {wf} :: {job} :: predicted unknown, actual {a}")
        elif p is None:
            if wf in unknown_wfs:
                print(f"  ?   {wf} :: {job} :: actual {a}, workflow had unknown prediction")
            else:
                ok = False
                print(f"MISS  {wf} :: {job} :: ran ({a}) but was not predicted")
        elif a is None:
            ok = False
            print(f"OVER  {wf} :: {job} :: predicted {p} but never appeared")
        else:
            ok = False
            print(f"DIFF  {wf} :: {job} :: predicted {p}, actual {a}")

    # workflow-level unknowns from prediction
    for r in predicted_raw:
        if r["job"] == "*" and r["status"] == "unknown":
            print(f"  ?   {r['workflow']} :: workflow-level unknown: {r['reason']}")

    print("PASS" if ok else "FAIL")
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()
