#!/usr/bin/env bash
# Installs (or reinstalls) the launchd job that runs e2e/nightly.sh every night.
# Run it from the clone kept for the job. See e2e/README.md.
#
#   e2e/install-nightly.sh [--at HH:MM] [--claude]
#   e2e/install-nightly.sh --uninstall
#
# --claude sets E2E_CLAUDE_ON_FAILURE=1, so a failed run asks Claude Code
# (read-only) what went wrong.
set -euo pipefail

label="com.fdsimms.dundundun.e2e-nightly"
plist="$HOME/Library/LaunchAgents/$label.plist"
domain="gui/$(id -u)"
at="03:17"
claude=0

while [ $# -gt 0 ]; do
  case "$1" in
    --at) at="$2"; shift 2 ;;
    --claude) claude=1; shift ;;
    --uninstall)
      launchctl bootout "$domain/$label" 2>/dev/null || true
      rm -f "$plist"
      echo "Removed $label."
      exit 0 ;;
    *) echo "Unknown option: $1" >&2; exit 2 ;;
  esac
done

if ! [[ "$at" =~ ^([01][0-9]|2[0-3]):[0-5][0-9]$ ]]; then
  echo "--at takes a 24-hour time, like 03:17" >&2
  exit 2
fi
hour=$((10#${at%:*}))
minute=$((10#${at#*:}))

dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
logs="$HOME/Library/Logs/dundundun-e2e"
mkdir -p "$logs" "$(dirname "$plist")"

# The job runs a copy of the script outside the clone, so the night's checkout of
# origin/main can't change which script launchd starts.
runner="$logs/nightly.sh"
cp "$dir/e2e/nightly.sh" "$runner"
chmod +x "$runner"

cat > "$plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$label</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/bash</string>
    <string>$runner</string>
  </array>
  <key>EnvironmentVariables</key>
  <dict>
    <key>E2E_DIR</key><string>$dir</string>
    <key>E2E_CLAUDE_ON_FAILURE</key><string>$claude</string>
  </dict>
  <key>StartCalendarInterval</key>
  <dict>
    <key>Hour</key><integer>$hour</integer>
    <key>Minute</key><integer>$minute</integer>
  </dict>
  <key>StandardOutPath</key><string>$logs/launchd.log</string>
  <key>StandardErrorPath</key><string>$logs/launchd.log</string>
</dict>
</plist>
PLIST

launchctl bootout "$domain/$label" 2>/dev/null || true
launchctl bootstrap "$domain" "$plist"

printf 'Installed %s: runs at %02d:%02d against %s.\n' "$label" "$hour" "$minute" "$dir"
echo "Results land in $logs (latest.txt is the last run's one-line result)."
echo "Run it now with: launchctl kickstart $domain/$label"
printf 'To wake the Mac for it: sudo pmset repeat wake MTWRFSU %02d:%02d:00\n' \
  "$hour" "$(( minute >= 5 ? minute - 5 : 0 ))"
