# dundundun

A personal productivity app built with Expo (React Native), started as a Things 3-inspired todo list and grown well past that: task management with a granular visibility model (defer, time-of-day gating, due dates, vacation pauses), recurrence, chains, stacks, projects/categories/tags, and templates — plus a grocery list with aisle sorting and per-store history, recipes, and meal planning. Optional AI suggestions (via a user-supplied Anthropic API key) help fill in task and grocery details, and Face ID app-locking, an Apple Reminders import for voice capture, and a home-screen widget round it out. Everything runs entirely on-device against a local SQLite database — there is no backend, and the Anthropic call is the only network request the app ever makes, opt-in and inert until a key is added.

## Tech stack

- **Expo SDK 54** / React Native 0.81
- **expo-sqlite** — local SQLite database (WAL mode), no backend
- **Zustand** — in-memory store on top of SQLite
- **React Native Reanimated + Gesture Handler** — swipe actions and drag-to-reorder
- **expo-notifications** — scheduled local reminders
- **WidgetKit** — a Today home-screen widget, injected at prebuild by the config plugins in `plugins/`
- TypeScript throughout

## Screens

Four tabs across the bottom:

| Tab | What it shows |
|-----|--------------|
| Today | The main list — see the sub-views below |
| Search | Full-text + fuzzy search across all tasks |
| Projects | Tasks grouped by project |
| More | Opens the side menu (also reachable by edge-swipe from the left) |

The Today tab is really four lenses over the same tasks, switched by the pill row under the header:

| View | What it shows |
|------|--------------|
| Today | Tasks actionable right now (visibility rules applied) |
| Later | Deferred and time-gated tasks, sorted by when they surface |
| Unscheduled | Tasks with no date at all |
| Inbox | Newly captured tasks not yet filed |

The side menu reaches Groceries, Recipes, Meal Plan, Categories, Tags, Stacks, Templates, Logbook, Stats, Waiting, Archived and Settings.

## Running locally

```bash
npm install
npx expo start
```

Scan the QR code with **Expo Go** (iOS/Android) — the app itself runs there, and the widget bridge is lazily required so its absence is a no-op. The **Today widget** is the exception: it's a separate native target, so seeing it needs a development or EAS build (see below).

### Checks

```bash
npx tsc --noEmit   # typecheck
npm test           # ~70 suites, ~2,600 tests, a few seconds
```

CI runs both plus `npx expo export --platform ios` on every PR.

## EAS builds

The project uses [EAS Build](https://docs.expo.dev/build/introduction/) for cloud builds — no Mac or Xcode required. Install the CLI once:

```bash
npm install -g eas-cli
eas login
```

### Build profiles

| Profile | Command | Purpose |
|---------|---------|---------|
| `development` | `eas build --platform ios --profile development` | Custom dev client for on-device debugging |
| `preview` | `eas build --platform ios --profile preview` | Ad-hoc IPA for internal testing (no App Store) |
| `production` | `eas build --platform ios --profile production` | Release build for App Store / TestFlight |

### First-time setup

```bash
eas build:configure   # fills in bundle ID, team ID, and Apple credentials
```

You need an [Apple Developer account](https://developer.apple.com) ($99/yr) to build for a real device.

### TestFlight

```bash
eas build --platform ios --profile preview
```

The `.ipa` uploads to App Store Connect automatically. Add yourself as an internal TestFlight tester and install via the TestFlight app.

### Clean build

If you've changed native dependencies (updated `package.json`, switched SDK version, etc.), force EAS to ignore its remote cache:

```bash
eas build --platform ios --profile <profile> --clear-cache
```

### Submit to App Store

```bash
eas submit --platform ios --profile production
```

Apple ID and ASC app ID are pre-configured in `eas.json`.

## Visibility model

A task appears in **Today** only if none of its four hiding rules apply (`src/utils/visibilityUtils.ts`):

1. `deferUntil` — hidden until a specific day
2. `timeSegments` — hidden until a time of day (morning / afternoon / evening / night)
3. `dueDate` — hidden while it's due on a future day
4. `vacationPause` — hidden while vacation mode is on, without breaking the streak

Everything hidden lands in **Later**, sorted by the earliest moment it surfaces. All of these compare against the configurable `dayResetTime` rather than midnight, so a 2 AM reset means "tomorrow" starts at 2 AM.

Completing a recurring task creates the next instance carrying the same rules. The one-time `deferUntil` resets.

## Task model highlights

- **Priority** — None / Low / Medium / High / Urgent
- **Effort** — XS (~15 min) → XL (day+)
- **Recurrence** — daily, weekly, monthly, yearly with custom interval; can recur from completion date
- **Deadline** — a target date shown as a countdown, separate from `dueDate` and with no effect on visibility
- **Subtasks** — tasks can have a `parentId`
- **Chain** — a task can step through a list of sub-titles one at a time, completing one immediately reveals the next; pairing it with Recurrence makes the whole chain repeat instead of ending after the last item
- **Stacks** — a label several independently-scheduled tasks hang off, with its own row and one-tap cascades
- **Projects, categories, tags** — three independent ways to file a task; it can carry all three
- **Templates** — a saved set of items you can stamp out as real tasks, anchored to a start or end date
- **Streaks** — consecutive completion count tracked per recurring task
- **Archive** — hides a task permanently without erasing its Logbook and Stats history
