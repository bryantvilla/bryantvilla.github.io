#!/usr/bin/env bash
set -e

echo "==> Fetching remote state..."
git fetch origin

# Remember where we started (a commit when HEAD is detached) and always go back,
# even if a step below fails.
START_REF=$(git branch --show-current)
[ -n "$START_REF" ] || START_REF=$(git rev-parse HEAD)
return_to_start() {
    if [ "$START_REF" != "develop" ]; then
        echo "==> Returning to '$START_REF'..."
        git checkout --quiet "$START_REF" || echo "⚠️  Could not return to '$START_REF'; finish or abort the work on develop first."
    fi
}
trap return_to_start EXIT

echo "==> Switching to develop..."
git checkout develop
git pull origin develop

echo "==> Merging origin/main into develop..."
git merge origin/main --no-edit

echo "==> Running site verification checks..."
node scripts/verify-site.js
node scripts/test-terminal-aliases.mjs

echo "==> Pushing synced develop to origin..."
git push origin develop

echo "✅ 'develop' successfully synchronized with 'main' and verified."
