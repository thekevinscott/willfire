#!/usr/bin/env bash
# Creates the probe repo under thekevinbot, pushes workflows, opens probe PRs.
set -euo pipefail

REPO=thekevinbot/willrun-probe
HERE="$(cd "$(dirname "$0")" && pwd)"
cd "$HERE/probe"

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

git checkout main
echo "done"
