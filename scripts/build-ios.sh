#!/bin/sh
# Local release build (eas build --local) whose .ipa goes to one folder shared by every app, named
# <date>_<time>_<app>.ipa so a plain sort by name puts the newest build last, whichever app it is.
# Set IOS_BUILDS_DIR to use a folder other than ~/Builds. Extra arguments go to eas (e.g. --clear-cache).
set -e
APP="dundundun"
DIR="${IOS_BUILDS_DIR:-$HOME/Builds}"
mkdir -p "$DIR"
OUT="$DIR/$(date +%Y-%m-%d_%H%M)_$APP.ipa"
npx eas-cli@latest build --platform ios --profile production --local --output "$OUT" "$@"
echo "Build saved to $OUT"
