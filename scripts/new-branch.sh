#!/usr/bin/env bash
set -e

if [ -z "$1" ]; then
    echo "Usage: ./scripts/new-branch.sh <branch-name>"
    exit 1
fi

BRANCH_NAME="$1"

echo "==> Fetching latest remote branches..."
git fetch origin

echo "==> Checking out develop..."
git checkout develop

echo "==> Pulling latest origin/develop..."
git pull origin develop

echo "==> Ensuring develop has latest origin/main..."
git merge origin/main --no-edit || {
    echo "Conflict detected between main and develop. Resolve conflicts before branching."
    exit 1
}

echo "==> Creating and switching to new branch '$BRANCH_NAME'..."
git checkout -b "$BRANCH_NAME"

echo "✅ Ready! You are on clean branch '$BRANCH_NAME' branched from synchronized develop."
