# Personal Todo

A personal todo app built with Expo (React Native). Inspired by Things 3, with a key differentiator: tasks can be hidden until a specific time — either as a one-time snooze or as a daily visibility rule baked into the task itself.

## Tech stack

- **Expo SDK 56** / React Native 0.81
- **expo-sqlite** — local SQLite database (WAL mode), no backend
- **Zustand** — in-memory store on top of SQLite
- **React Native Reanimated + Gesture Handler** — swipe actions and drag-to-reorder
- **expo-notifications** — scheduled local reminders
- TypeScript throughout

## Screens

| Tab | What it shows |
|-----|--------------|
| Today | Tasks actionable right now (visibility rules applied) |
| Focus | Starred/flagged tasks with badge count |
| Later | Deferred and time-gated tasks, grouped by when they surface |
| Someday | Parked tasks with no date |
| Projects | Tasks grouped by project |
| Tags | All tags; tap to filter tasks by tag |
| Search | Full-text + fuzzy search across all tasks |
| Logbook | Completed tasks |
| Stats | Completion streaks and activity |

## Running locally

```bash
npm install
npx expo start
```

Scan the QR code with **Expo Go** (iOS/Android). All features work in Expo Go — the app only uses modules that ship with it.

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

A task appears in **Today** if all hold:

1. Not completed
2. `deferUntil` is null or in the past
3. Current time ≥ `showAfterTime` (or no rule set)
4. `dueDate` is today/overdue, or no due date

Everything else lands in **Later**, sorted by when it becomes visible.

Completing a recurring task creates the next instance with the same `showAfterTime` rule. The one-time `deferUntil` resets.

## Task model highlights

- **Priority** — None / Low / Medium / High / Urgent
- **Effort** — XS (~15 min) → XL (day+)
- **Recurrence** — daily, weekly, monthly, yearly with custom interval; can recur from completion date
- **Subtasks** — tasks can have a `parentId`
- **Cycle items** — a recurring task can rotate through a list of sub-titles on each recurrence
- **Streaks** — consecutive completion count tracked per recurring task
