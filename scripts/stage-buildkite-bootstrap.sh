#!/bin/bash
set -euo pipefail

if [[ $# != 1 || ! -d "$1" || -L "$1" ]]; then
  echo 'Usage: stage-buildkite-bootstrap.sh <empty staging directory>' >&2
  exit 2
fi
stage="$(cd -- "$1" && pwd -P)"
source="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd -P)"
if [[ "$stage/" == "$source/"* ]] || [[ -n "$(ls -A -- "$stage")" ]]; then
  echo 'Use an empty staging directory outside the reviewed source.' >&2
  exit 2
fi
cd "$source"
if [[ "$(uname -s)" != Linux || "$(bun --version)" != "$(<.bun-version)" ]]; then
  echo 'Staging requires Linux and the pinned Bun version.' >&2
  exit 2
fi

cc -std=c11 -O2 -Wall -Wextra -Werror -static \
  scripts/buildkite-bootstrap-hook.c -o "$stage/command"
bun build --compile --no-compile-autoload-dotenv --no-compile-autoload-bunfig \
  src/buildkite-host-dispatch.ts --outfile "$stage/forge-buildkite-dispatch"
install -m 0555 scripts/verify-trusted-install.sh "$stage/verify-trusted-install.sh"
