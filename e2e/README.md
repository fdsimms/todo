# End-to-end tests

[Maestro](https://maestro.dev) flows that drive the real app in an iOS simulator, plus a nightly
job to run them on a Mac. Nothing here runs in CI: a simulator needs macOS, and GitHub's macOS
runners use up this repo's Actions minutes about ten times as fast as Linux ones.

They cover what Jest can't. The suite has no component renderer, so a sheet that never appears, a
tap that does nothing, or a screen that crashes on open passes every unit test.

## What's covered

| Flow | Checks |
|---|---|
| `maestro/quick-add-complete.yaml` | A fresh install opens on Today; quick add from the FAB adds a task there; checking it off removes it |

That's deliberately one flow for now: the path the app is used for most. Add flows to
`maestro/` and the nightly job picks them up.

Selectors are accessibility labels and visible text, since the app sets no `testID`s. Renaming a
label a flow taps (the FAB's "Add task", a checkbox's "Complete …") breaks the flow, and the
nightly run is where that shows up.

Not reachable from a simulator at all: Screen Time shields, NFC, most of Apple Health, and the
widget, Watch app and Live Activities (they aren't React Native screens).

## Running a flow by hand

On a Mac with Xcode, [Maestro](https://docs.maestro.dev/getting-started/installing-maestro) (it
needs Java 17+) and a booted simulator:

```bash
npx expo run:ios --configuration Release --no-bundler   # or a debug build with Metro running
maestro test e2e/maestro/quick-add-complete.yaml
```

`maestro studio` opens an inspector for finding a new selector.

## The nightly job

`nightly.sh` checks out `origin/main`, regenerates `ios/`, erases and boots a simulator, builds
and installs a Release build, runs every flow, and posts a macOS notification with the result.
Each run gets a folder under `~/Library/Logs/dundundun-e2e/` holding `run.log`, `summary.txt`,
the JUnit `report.xml` and Maestro's screenshots; `latest.txt` there is the last run in one line.

**It needs a clone of its own.** It checks out `origin/main` and rewrites `ios/`, so it would
trample work in progress. It refuses to start in a clone with uncommitted changes rather than
discarding them.

```bash
git clone <this repo's URL> ~/dundundun-e2e
cd ~/dundundun-e2e
e2e/install-nightly.sh                  # runs at 03:17; --at 01:30 to pick a time
e2e/install-nightly.sh --claude         # same, and a failed run asks Claude Code why
launchctl kickstart gui/$(id -u)/com.fdsimms.dundundun.e2e-nightly   # run it now, once
e2e/install-nightly.sh --uninstall
```

The Mac has to be awake and you logged in, since the simulator needs a user session. The
installer prints a `pmset` line that wakes the Mac a few minutes ahead of the run. A run missed
while it slept starts when it next wakes.

The first build compiles React Native from source (`buildReactNativeFromSource` in `app.json`),
so expect a long first night; later ones reuse Xcode's derived data where they can.

### With `--claude`

A failed run calls Claude Code headlessly (`claude -p`), with read-only tools, to work out which
step failed and whether the app or the flow is at fault. The answer is written to that run's
`claude-diagnosis.md`. It doesn't edit, commit or push anything. A passing night doesn't call it,
so it costs nothing on the nights that pass. It needs `claude` installed and signed in on the Mac.
