#!/usr/bin/env bash
set -euo pipefail

# Checks that a trusted Forge install is the approved repository, commit and Bun pin.
# See docs/trusted-install-check.md for what this does and does not establish.
# Run a copy the host keeps outside the install: a copy inside it is what is being checked.

# Byte-wise character ranges, whatever locale the caller has.
export LC_ALL=C

usage() {
  echo "Error: $1" >&2
  echo "Usage: scripts/verify-trusted-install.sh --install <absolute-dir> --repository <owner/name> --commit <40-hex>" >&2
  exit 2
}

# Messages are fixed: no path, URL, file content or environment value is printed.
fail() {
  echo "Error: $1" >&2
  exit 1
}

unset INSTALL REPOSITORY COMMIT
while [[ $# -gt 0 ]]; do
  case "$1" in
    --install) name=INSTALL ;;
    --repository) name=REPOSITORY ;;
    --commit) name=COMMIT ;;
    *) usage "unknown argument." ;;
  esac
  [[ -z "${!name+given}" ]] || usage "$1 was given more than once."
  [[ $# -ge 2 && "$2" != --* ]] || usage "$1 needs a value."
  printf -v "$name" '%s' "$2"
  shift 2
done
if [[ -z "${INSTALL+given}" || -z "${REPOSITORY+given}" || -z "${COMMIT+given}" ]]; then
  usage "--install, --repository and --commit are all required."
fi
# A trailing slash or dot component would let the symlink test below look through a link.
if [[ "$INSTALL" != /* || "$INSTALL" == */ || "$INSTALL/" == */./* || "$INSTALL/" == */../* ]]; then
  usage "--install must be an absolute path with no trailing slash and no . or .. component."
fi
if [[ ! "$REPOSITORY" =~ ^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$ || "/$REPOSITORY/" == */./* || "/$REPOSITORY/" == */../* ]]; then
  usage "--repository must be owner/name in letters, digits, hyphens, underscores and dots."
fi
if [[ ! "$COMMIT" =~ ^[0-9a-f]{40}$ ]]; then
  usage "--commit must be 40 lowercase hexadecimal characters."
fi

# A job environment must not point Git at another repository, index, object store or configuration.
# The user and system configuration are not read either, so no safe.directory entry applies:
# Git refuses an install that the user running this check does not own.
unset "${!GIT_@}"
export GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_NOSYSTEM=1

# The install's own configuration is still read. These options override what could hide a
# difference there: a replace ref swapping the commit's content, a file-system monitor (a program
# Git would run and then believe), an ignored executable bit, and relaxed stat comparison.
# Optional locks are off so the check leaves the index as it found it. Git's stderr is dropped
# because it can quote the remote URL.
run_git() {
  git --no-replace-objects --no-optional-locks \
    -c core.fsmonitor=false -c core.fileMode=true -c core.trustctime=true -c core.checkStat=default \
    -C "$INSTALL" "$@" 2>/dev/null
}

# 1. The install path.
if [[ ! -d "$INSTALL" || -L "$INSTALL" ]]; then
  fail "the install path is not an existing directory, or it is a symlink."
fi

# 2. The top level of a work tree: not a subdirectory, a bare repository or a redirected work tree.
if [[ "$(run_git rev-parse --show-toplevel)" != "$(cd "$INSTALL" && pwd -P)" ]]; then
  fail "the install path is not the top level of a Git work tree owned by the user running this check."
fi

# 3. HEAD.
if [[ "$(run_git rev-parse --verify HEAD)" != "$COMMIT" ]]; then
  fail "the install's HEAD is not the expected commit."
fi

# 4. The origin remote, as Git would use it, compared without printing it.
ORIGIN="$(run_git remote get-url --all origin)" || ORIGIN=""
if [[ "$ORIGIN" != "https://github.com/$REPOSITORY.git" && "$ORIGIN" != "https://github.com/$REPOSITORY" ]]; then
  fail "the install's origin remote is not the expected GitHub repository over HTTPS."
fi

# 5. The working tree. Status reports modified, staged, untracked and ignored files, but it
# trusts cached stat data and configured filters, so every tracked regular file is also hashed
# unfiltered and compared with the commit's own blob.
TREE_MESSAGE="the install's working tree is not exactly the expected commit."
STATUS="$(run_git status --porcelain --untracked-files=all --ignored=matching --ignore-submodules=none)" || fail "$TREE_MESSAGE"
[[ -z "$STATUS" ]] || fail "$TREE_MESSAGE"
FILES="$(run_git ls-tree -r --full-tree "$COMMIT" | grep '^100')" || fail "$TREE_MESSAGE"
EXPECTED="$(cut -f1 <<<"$FILES" | cut -d' ' -f3)"
ACTUAL="$(cut -f2- <<<"$FILES" | run_git hash-object --no-filters --stdin-paths)" || fail "$TREE_MESSAGE"
[[ "$ACTUAL" == "$EXPECTED" ]] || fail "$TREE_MESSAGE"

# 6. Index flags that make status skip a file, and submodules, which status does not look inside.
ENTRIES="$(run_git ls-files -v --stage)" || ENTRIES=""
if grep -qv '^H ' <<<"$ENTRIES"; then
  fail "the install's index has entries flagged assume-unchanged or skip-worktree."
fi
if grep -q '^H 160000 ' <<<"$ENTRIES"; then
  fail "the install has submodules."
fi

# 7. The Bun pin. This compares the version Bun reports, not the binary.
PIN_MESSAGE="the install has no .bun-version holding a three-part version."
[[ -f "$INSTALL/.bun-version" ]] || fail "$PIN_MESSAGE"
PINNED_VERSION="$(tr -d '[:space:]' <"$INSTALL/.bun-version")"
[[ "$PINNED_VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || fail "$PIN_MESSAGE"
if ! command -v bun >/dev/null 2>&1; then
  fail "bun is not on PATH."
fi
ACTUAL_VERSION="$(bun --version 2>/dev/null)" || ACTUAL_VERSION=""
if [[ "$ACTUAL_VERSION" != "$PINNED_VERSION" ]]; then
  fail "the Bun on PATH is not the version the install's .bun-version pins."
fi

echo "trusted install verified: $REPOSITORY $COMMIT bun $PINNED_VERSION"
