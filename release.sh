#!/usr/bin/env bash
set -euo pipefail

# release.sh - bump version, tag, and push. The house ritual, as in wryme and hum.
# Usage: ./release.sh [patch|minor|major]
#
# Core: package.json, which src/version.ts reads, so the hello and the CLI
# speak the same number. No lockfile rides this repo.

EXTRA_VERSIONED_FILES=()

BRANCH="$(git branch --show-current)"
if [[ "$BRANCH" != "main" ]]; then
  echo "error: must be on main (currently on '$BRANCH')" >&2
  exit 1
fi

git fetch origin main
git reset --hard origin/main

OLD_VER="$(node -p "require('./package.json').version")"
IFS='.' read -r MAJOR MINOR PATCH <<< "$OLD_VER"
case "${1:-patch}" in
  patch) NEW_VER="$MAJOR.$MINOR.$((PATCH + 1))" ;;
  minor) NEW_VER="$MAJOR.$((MINOR + 1)).0" ;;
  major) NEW_VER="$((MAJOR + 1)).0.0" ;;
  *)
    echo "error: unknown bump type '${1}' (use patch|minor|major)" >&2
    exit 1
    ;;
esac

VERSIONED_FILES=(package.json "${EXTRA_VERSIONED_FILES[@]}")

for f in "${VERSIONED_FILES[@]}"; do
  if ! grep -q "\"$OLD_VER\"" "$f"; then
    echo "error: $f does not contain version $OLD_VER (files out of sync?)" >&2
    exit 1
  fi
done

for f in "${VERSIONED_FILES[@]}"; do
  sed -i '' -e "s/\"version\": \"$OLD_VER\"/\"version\": \"$NEW_VER\"/" "$f"
done

if ! git diff --quiet -- "${VERSIONED_FILES[@]}"; then
  git add "${VERSIONED_FILES[@]}"
  git commit -m "chore: bump to $NEW_VER"
fi

TAG="v$NEW_VER"
git tag -a "$TAG" -m "v$NEW_VER"
git push origin main --tags
echo "Released $TAG ✓"
