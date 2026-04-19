#!/usr/bin/env bash
set -euo pipefail

DRY_RUN=false
VERSION=""

for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY_RUN=true ;;
    *) VERSION="$arg" ;;
  esac
done

if [[ -z "$VERSION" ]]; then
  echo "Usage: $0 <version> [--dry-run]"
  echo "Example: $0 0.2.0"
  exit 1
fi

if [[ ! "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+(-[a-zA-Z0-9.]+)?$ ]]; then
  echo "Error: version must be semver (e.g. 0.2.0 or 0.2.0-rc.1)"
  exit 1
fi

run() {
  if [[ "$DRY_RUN" == true ]]; then
    echo "[dry-run] $*"
  else
    "$@"
  fi
}

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

echo "→ Checking working tree..."
if [[ -n "$(git status --porcelain)" ]]; then
  echo "Error: working tree is not clean. Commit or stash changes first."
  exit 1
fi

CURRENT_BRANCH="$(git rev-parse --abbrev-ref HEAD)"
if [[ "$CURRENT_BRANCH" != "main" ]]; then
  echo "Error: must be on main branch (current: $CURRENT_BRANCH)"
  exit 1
fi

echo "→ Fetching origin..."
git fetch origin  # always fetch — read-only, safe in dry-run

LOCAL="$(git rev-parse HEAD)"
REMOTE="$(git rev-parse origin/main)"
if [[ "$LOCAL" != "$REMOTE" ]]; then
  echo "Error: local main is not up to date with origin/main. Run: git pull"
  exit 1
fi

if git rev-parse "v$VERSION" >/dev/null 2>&1; then
  echo "Error: tag v$VERSION already exists"
  exit 1
fi

echo "→ Running CI..."
run bun run ci

echo "→ Bumping versions to $VERSION..."
run node -e "
  const fs = require('fs');
  ['packages/cli/package.json', 'packages/desktop/package.json', 'package.json'].forEach(p => {
    const pkg = JSON.parse(fs.readFileSync(p, 'utf8'));
    pkg.version = '$VERSION';
    fs.writeFileSync(p, JSON.stringify(pkg, null, 2) + '\n');
    console.log('  updated', p);
  });
"

run git add packages/cli/package.json packages/desktop/package.json package.json
run git commit -m "chore: release v$VERSION"
run git tag -a "v$VERSION" -m "v$VERSION"

echo "→ Pushing to origin..."
run git push origin main
run git push origin "v$VERSION"

echo ""
echo "✓ Tagged v$VERSION and pushed to origin."
echo ""
echo "GitHub Actions will now build binaries and publish the release:"
echo "  https://github.com/vboctor/fink/actions"
echo ""
echo "Prerequisites (if not already set):"
echo "  - NPM_TOKEN repo secret on GitHub (Automation token from npmjs.com)"
