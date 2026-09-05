#!/usr/bin/env bash
# Creates the probe repo under thekevinbot, pushes workflows, opens probe PRs.
set -euo pipefail

REPO=thekevinbot/willrun-probe
HERE="$(cd "$(dirname "$0")" && pwd)"
cd "$HERE/tests/fixtures/willrun-probe"

# --- repo + main ---
gh repo create "$REPO" --public \
  --description "Probe repo for GitHub Actions dispatch prediction"
git init -b main
git add -A
git commit -m "seed: probe workflows and files"
git remote add origin "git@github.com:$REPO.git"
git push -u origin main

# --- dev branch (for base-branch filter tests) ---
git branch dev
git push origin dev

# --- disable disabled.yml via API ---
gh api -X PUT "repos/$REPO/actions/workflows/disabled.yml/disable"

# --- tag remote-v0, whose content differs from main on purpose ---
# The cross-repo probe needs the callee to exist at two refs that disagree, so
# a name observed in a check says which ref GitHub read. The fixture tree mirrors main;
# the tag is main's files with the two jobs renamed back. See its README.md.
git checkout -b tmp-v0 main
sed -i 's/^  r-inner-at-main:$/  r-inner:/' .github/workflows/remote-reusable.yml
sed -i 's/^  deep-at-main:$/  deep-at-v0:/' .github/workflows/remote-inner.yml
git commit -am "seed: remote-reusable callee, the version tag remote-v0 pins"
git tag remote-v0
git push origin remote-v0
git checkout main
git branch -D tmp-v0

# remote-caller.yml pins that same commit by SHA as well as by tag, so that the
# two spellings can be compared. Point it at the tag this run just created.
sed -i "s#remote-reusable.yml@[0-9a-f]\{40\}#remote-reusable.yml@$(git rev-parse remote-v0^{commit})#" \
  .github/workflows/remote-caller.yml
git commit -am "seed: point the SHA-pinned call at this repo's remote-v0"
git push origin main

mkpr() {  # mkpr <branch> <base> <title>
  local branch=$1 base=$2 title=$3
  gh pr create --repo "$REPO" --head "$branch" --base "$base" \
    --title "$title" --body "probe PR"
}

# PR1: src change -> main
git checkout -b pr1-src main
echo change >> src/app.txt
git commit -am "pr1: src change"
git push origin pr1-src
mkpr pr1-src main "pr1: src change into main"

# PR2: docs-only -> main
git checkout -b pr2-docs main
mkdir -p docs
echo notes > docs/notes.md
git add docs
git commit -m "pr2: docs only"
git push origin pr2-docs
mkpr pr2-docs main "pr2: docs-only into main"

# PR3: [skip ci] -> main
git checkout -b pr3-skip main
echo skipchange >> src/app.txt
git commit -am "pr3: src change [skip ci]"
git push origin pr3-skip
mkpr pr3-skip main "pr3: skip-ci commit"

# PR4: vendor-only src change -> main (negation edge)
git checkout -b pr4-vendor main
mkdir -p src/vendor
echo vendored > src/vendor/lib.txt
git add src/vendor
git commit -m "pr4: vendor-only change"
git push origin pr4-vendor
mkpr pr4-vendor main "pr4: vendor-only src change"

# PR5: src change -> dev (base-branch filter)
git checkout -b pr5-into-dev dev
echo devchange >> src/app.txt
git commit -am "pr5: src change into dev"
git push origin pr5-into-dev
mkpr pr5-into-dev dev "pr5: src change into dev"

# PR6: 301-file diff, the src file sorting last (truncation probe)
git checkout -b pr6-many main
mkdir -p generated
for i in $(seq -w 0 299); do echo "$i" > "generated/f$i.txt"; done
echo zzz > src/zzz.txt
git add generated src/zzz.txt
git commit -m "pr6: 301 files, src file sorts last"
git push origin pr6-many
mkpr pr6-many main "pr6: 301-file diff"

# PR7 was a one-off (predictor code under src/) and is closed.

# PR8: plain src change -> main. Nothing special about the diff; this PR
# exists so `names.yml` and `names-caller.yml` dispatch, and their job names
# can be read back as ground truth for check-name resolution. The expected
# names live in willfire's src/names.test.ts.
git checkout -b pr8-names main
echo namecheck >> src/app.txt
git commit -am "pr8: src change for the check-name probes"
git push origin pr8-names
mkpr pr8-names main "pr8: check-name resolution probes"

# PR9: touch both cross-repo probe paths. `remote-caller.yml` and
# `remote-bad.yml` are scoped to a file each so they stay out of PRs 1-8's
# predictions; this is the PR that makes them fire. The expected names live in
# willfire's src/names.test.ts.
git checkout -b pr9-remote main
echo "remote probe change" >> src/remote.txt
echo "remote bad probe change" >> src/remote-bad.txt
git commit -am "pr9: touch both remote-probe paths"
git push origin pr9-remote
mkpr pr9-remote main "pr9: remote reusable workflow probes"

# PRs 10-12: the stacked-PR probe for issue #30, replicating dirsql#1002's
# stack shape. Recorded result: stack-aware dispatch never engaged here (it is
# a per-repo rollout), so shape alone does not change dispatch. PR11, the
# parent, stays open so PRs 10 and 12 keep the stack shape.
git checkout -b stack-base main
echo stackchange >> src/app.txt
git commit -am "pr30: advance stack-base past main"
git push origin stack-base

git checkout -b pr30-head stack-base
echo childchange >> src/app.txt
git commit -am "pr30: child change"
git push origin pr30-head
mkpr pr30-head stack-base "pr30: stacked PR, base even with main"

mkpr stack-base main "pr30 parent: stack-base into main"

git checkout -b pr30-head2 stack-base
echo childchange2 >> src/app.txt
git commit -am "pr30: second child, opened after the parent"
git push origin pr30-head2
mkpr pr30-head2 stack-base "pr30 child2: opened under an existing parent PR"

# PR11 (opened as #14): is a `${{ }}` written as an element of a matrix list
# literal interpolated, and does the interpolated value reach the check name?
# `matrix-expr.yml` is scoped to a path of its own so it stays out of the other
# PRs' predictions; this is the PR that makes it fire. The expected names live
# in willfire's tests/integration/names.test.ts.
git checkout -b pr11-matrix-expr main
echo "matrix expr probe" > src/matrix-expr.txt
git add src/matrix-expr.txt
git commit -m "pr11: touch the matrix-expr probe path"
git push origin pr11-matrix-expr
mkpr pr11-matrix-expr main "pr11: expression inside a matrix list element"

git checkout main
echo "done"
