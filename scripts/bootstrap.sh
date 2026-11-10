#!/usr/bin/env bash
set -euo pipefail

# Resolve this checkout, including linked worktrees, regardless of the caller's cwd.
REPO_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

if [[ $# -ne 0 ]]; then
  echo "Usage: ./scripts/bootstrap.sh" >&2
  exit 2
fi

if [[ ! -f .bun-version ]]; then
  echo "Error: missing .bun-version in $REPO_ROOT" >&2
  exit 1
fi
PINNED_VERSION="$(tr -d '[:space:]' < .bun-version)"
if [[ ! "$PINNED_VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  echo "Error: .bun-version must contain a three-part version." >&2
  exit 1
fi
if ! command -v bun >/dev/null 2>&1; then
  echo "Error: install Bun $PINNED_VERSION and put it on PATH, then rerun bootstrap." >&2
  exit 1
fi
ACTUAL_VERSION="$(bun --version)"
if [[ "$ACTUAL_VERSION" != "$PINNED_VERSION" ]]; then
  echo "Error: expected Bun $PINNED_VERSION; found $ACTUAL_VERSION. Select the pinned runtime on PATH." >&2
  exit 1
fi

# Shared dependencies allow one worktree's install to mutate another's toolchain.
if [[ -L node_modules ]]; then
  echo "Error: node_modules is a symlink. Use independent dependencies in this checkout." >&2
  exit 1
fi

bun install --frozen-lockfile
echo "Forge dependencies are ready. Run bun run check to verify this checkout."
