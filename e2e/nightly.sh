#!/usr/bin/env bash
# Nightly Maestro run on a Mac: build main for the simulator, run every flow in
# e2e/maestro/, record the result. See e2e/README.md for setup.
#
# Runs in a clone kept for this job alone (E2E_DIR), never the one you work in:
# it checks out origin/main, regenerates ios/ and erases a simulator. It refuses
# to start if that clone has uncommitted changes rather than discarding them.
#
# Environment (all optional):
#   E2E_DIR                clone to run in (default: the clone holding this script)
#   E2E_SIMULATOR          simulator name or UDID (default: first available iPhone)
#   E2E_LOG_ROOT           where each run's report goes (default: ~/Library/Logs/dundundun-e2e)
#   E2E_CLAUDE_ON_FAILURE  1 to have Claude Code diagnose a failed run (read-only)

# Everything lives inside main() because the run checks out origin/main and then
# refreshes the copy launchd starts (install-nightly.sh), either of which can
# rewrite this very file mid-run. Bash reads a script as it goes, but it reads a
# whole function before running it, so the run in progress is unaffected.
main() {
  set -euo pipefail

  # launchd starts jobs with a bare PATH, so put back the usual install locations.
  export PATH="$HOME/.maestro/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"
  if [ -s "$HOME/.nvm/nvm.sh" ]; then
    # shellcheck disable=SC1091
    . "$HOME/.nvm/nvm.sh" >/dev/null
  fi

  local dir="${E2E_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
  local log_root="${E2E_LOG_ROOT:-$HOME/Library/Logs/dundundun-e2e}"
  local run_dir
  run_dir="$log_root/$(date +%Y-%m-%d_%H%M%S)"
  mkdir -p "$run_dir"

  # One run at a time: a slow build must not overlap the next night's.
  local lock="$log_root/.lock"
  if ! mkdir "$lock" 2>/dev/null; then
    echo "Another run holds $lock; skipping." | tee "$run_dir/summary.txt"
    exit 0
  fi
  trap 'rmdir "$lock"' EXIT

  exec > >(tee "$run_dir/run.log") 2>&1
  echo "dundundun e2e: $(date)"

  for tool in git node npm npx xcrun maestro; do
    if ! command -v "$tool" >/dev/null; then
      finish "$run_dir" "setup" "$tool is not on PATH"
    fi
  done

  cd "$dir"
  if [ -n "$(git status --porcelain)" ]; then
    finish "$run_dir" "setup" "$dir has uncommitted changes; this job needs a clone of its own"
  fi
  git fetch --quiet origin main
  git checkout --quiet --detach origin/main
  local commit
  commit="$(git rev-parse --short HEAD)"
  echo "Testing $commit: $(git log -1 --format=%s)"
  # launchd starts a copy of this script that lives outside the clone. Refresh it
  # from main, so a change to the script reaches tomorrow night's run.
  local self="${BASH_SOURCE[0]}"
  if [ "$self" != "$dir/e2e/nightly.sh" ]; then
    cp "$dir/e2e/nightly.sh" "$self"
  fi

  npm ci --no-audit --no-fund || finish "$run_dir" "npm ci" "see run.log" "$commit"
  # --clean so ios/ always matches app.json and plugins/ on this commit.
  npx expo prebuild --platform ios --clean || finish "$run_dir" "prebuild" "see run.log" "$commit"

  local udid
  udid="$(pick_simulator)" || finish "$run_dir" "setup" "no simulator matches '${E2E_SIMULATOR:-iPhone}'" "$commit"
  echo "Simulator: $udid"
  # Erased every night, so each run starts from a fresh install.
  xcrun simctl shutdown "$udid" 2>/dev/null || true
  xcrun simctl erase "$udid"
  xcrun simctl boot "$udid"
  xcrun simctl bootstatus "$udid" -b

  # Release bundles the JS into the app, so no Metro server has to be running.
  npx expo run:ios --configuration Release --device "$udid" --no-bundler \
    || finish "$run_dir" "build" "see run.log" "$commit"

  local status=0
  maestro --device "$udid" test e2e/maestro \
    --format junit --output "$run_dir/report.xml" \
    --debug-output "$run_dir/debug" || status=$?

  if [ "$status" -ne 0 ]; then
    if [ "${E2E_CLAUDE_ON_FAILURE:-0}" = "1" ] && command -v claude >/dev/null; then
      diagnose "$run_dir" "$commit"
    fi
    finish "$run_dir" "maestro" "flows failed; report.xml and debug/ hold the details" "$commit"
  fi
  finish "$run_dir" "" "all flows passed" "$commit"
}

# Prints the UDID of E2E_SIMULATOR (a name or a UDID), or of the first available
# iPhone when it is unset. Device names change with each Xcode, hence the default.
pick_simulator() {
  xcrun simctl list devices available --json | node -e '
    const want = process.argv[1];
    const devices = Object.values(JSON.parse(require("fs").readFileSync(0, "utf8")).devices).flat();
    const hit = want
      ? devices.find((d) => d.udid === want || d.name === want)
      : devices.find((d) => d.name.startsWith("iPhone"));
    if (!hit) process.exit(1);
    console.log(hit.udid);
  ' "${E2E_SIMULATOR:-}"
}

# Asks Claude Code what went wrong, with read-only tools, into claude-diagnosis.md.
# It reads; it doesn't edit, commit or push.
diagnose() {
  local run_dir="$1" commit="$2"
  echo "Asking Claude Code to diagnose…"
  claude -p "The nightly Maestro run of this app failed on commit $commit. The JUnit report is $run_dir/report.xml, and $run_dir/debug holds Maestro's screenshots and logs for each flow; the flows are in e2e/maestro/. Work out which step failed and why, and whether it's a bug in the app or in the flow (a changed label, a timing assumption). Name the files and lines involved, and suggest a fix. Don't change any files." \
    --allowedTools "Read" "Grep" "Glob" "Bash(git log:*)" "Bash(git show:*)" "Bash(git diff:*)" \
    > "$run_dir/claude-diagnosis.md" 2>&1 || echo "Claude Code exited with an error; see claude-diagnosis.md"
}

# Writes summary.txt (and latest.txt beside the runs), posts a notification, and
# exits: 0 on a pass, 1 on a failure. An empty stage means the run passed.
finish() {
  local run_dir="$1" stage="$2" detail="$3" commit="${4:-unknown}"
  local line
  if [ -z "$stage" ]; then
    line="PASS $commit: $detail"
  else
    line="FAIL $commit at $stage: $detail"
  fi
  echo "$line" | tee "$run_dir/summary.txt"
  echo "$line ($run_dir)" > "$(dirname "$run_dir")/latest.txt"
  osascript -e "display notification \"$line\" with title \"dundundun e2e\"" 2>/dev/null || true
  [ -z "$stage" ] && exit 0 || exit 1
}

main "$@"
