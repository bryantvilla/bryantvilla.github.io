#!/usr/bin/env bash
set -e

echo "==> Fetching remote state..."
git fetch origin

CURRENT_BRANCH=$(git branch --show-current)

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

if [ "$CURRENT_BRANCH" != "develop" ]; then
    echo "==> Returning to branch '$CURRENT_BRANCH'..."
    git checkout "$CURRENT_BRANCH"
fi

echo "✅ 'develop' successfully synchronized with 'main' and verified."
