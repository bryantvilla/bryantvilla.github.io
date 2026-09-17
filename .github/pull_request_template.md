## Description

<!-- Provide a brief description of your changes and why they are being introduced. -->

## Merge Guidelines to Prevent Conflicts

> [!IMPORTANT]
> **Branch Merge Strategy**:
> - **Feature / Fix PRs into `develop`**: Use **Squash and merge** or **Rebase and merge**.
> - **Release PRs from `develop` into `main`**: **ALWAYS select "Create a merge commit"** (`--no-ff`). Do **NOT** squash `develop` into `main`, as squashing creates disconnected commit histories that lead to recurring merge conflicts.

## Verification Checklist

- [ ] `node scripts/verify-site.js` passes cleanly.
- [ ] `node scripts/test-terminal-aliases.mjs` passes cleanly.
- [ ] `node scripts/verify-desktop.mjs` passes cleanly.
- [ ] `node scripts/test-desktop-selection.mjs` passes cleanly.
- [ ] If CSS or JS was modified, ran `node scripts/version-assets.js` to refresh version hashes.
