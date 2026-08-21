#!/bin/bash
# Installs dependencies so tests and the typechecker work in Claude Code on the web.
# node_modules is not checked in, and postinstall does two required steps:
#   patch-package         — applies patches/react-native+0.81.5.patch (see CLAUDE.md)
#   build:patchnotes      — generates src/utils/patchNotes*.ts, which are gitignored
#                           but imported by app code, so tsc fails without them
set -euo pipefail

echo '{"async": true, "asyncTimeout": 300000}'

# Local machines already have a working checkout; only the web sandbox needs this.
if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

cd "$CLAUDE_PROJECT_DIR"

# npm install (not ci) so a cached container reuses the existing node_modules.
npm install --no-audit --no-fund

# CocoaPods, for `pod install` when iterating on the native iOS targets under
# targets/ and plugins/ (see docs/native-targets.md). The sandbox has no
# Xcode, so pod can resolve/write the Pods project but can't build it — pass
# --allow-root when running it, since this container runs as root.
gem install cocoapods --no-document
echo "export PATH=\"$(ruby -e 'puts Gem.bindir'):\$PATH\"" >> "$CLAUDE_ENV_FILE"
