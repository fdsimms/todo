#!/bin/bash
# Installs dependencies so tests and the typechecker work in Claude Code on the
# web, then warms the two caches the verification loop depends on.
#
# node_modules is not checked in, and postinstall does three required steps:
#   patch-package         — applies patches/react-native+<version>.patch, which is
#                           named for the exact RN version and re-cut on every
#                           bump (see CLAUDE.md)
#   build:patchnotes      — generates src/utils/patchNotes*.ts, which are gitignored
#                           but imported by app code, so tsc fails without them
#   setup-git-hooks       — points core.hooksPath at .githooks/ and registers the
#                           generated-doc merge driver
set -euo pipefail

echo '{"async": true, "asyncTimeout": 300000}'

# Local machines already have a working checkout; only the web sandbox needs this.
if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

cd "$CLAUDE_PROJECT_DIR"

# npm install (not ci) so a cached container reuses the existing node_modules.
npm install --no-audit --no-fund

# Both caches are gitignored, so a fresh container starts cold: the first
# typecheck costs ~27s against ~4s warm, and the first jest run pays for the
# whole Babel transform of 300-odd suites. Warming them here spends the
# container's idle startup time instead of the session's first verification
# run. Neither is allowed to fail the hook — a red tree is the session's
# problem to look at, not a reason to have no dependencies installed.
npx tsc --noEmit >/dev/null 2>&1 || true
npx jest --silent >/dev/null 2>&1 || true
