# Personal Todo

A personal todo app built with Expo (React Native). Inspired by Things 3, with a key differentiator: tasks can be hidden until a specific time — either as a one-time snooze or as a daily visibility rule baked into the task itself.

## Key features

- **Tags** — multiple tags per task, filter by tag, group-by-tag toggle
- **Show after time** — a task-level daily rule (e.g. "don't show until 8 PM") that persists across every recurrence
- **Defer until** — one-time snooze to a specific date/time
- **Recurrence** — daily, weekly, monthly, yearly with configurable interval
- **Today view** — only what's actionable right now
- **Later view** — deferred/time-gated tasks, grouped by when they surface
- **Tags view** — browse all tags, tap to see tasks for each
- Swipe left to delete, swipe right to defer, tap circle to complete

## Running on your phone (Expo Go)

```bash
npm install
npx expo start
```

Scan the QR code with the Expo Go app.

## Building for TestFlight

You need an [Apple Developer account](https://developer.apple.com) ($99/yr). No Mac or Xcode required — EAS builds in the cloud.

```bash
npm install -g eas-cli
eas login
eas build:configure        # first time only — fills in your team/app IDs
eas build --platform ios --profile preview
```

The `.ipa` uploads to App Store Connect automatically. Add yourself as a TestFlight tester and install on your phone.

## Visibility model

A task appears in **Today** if all hold:
1. Not completed
2. `deferUntil` is null or in the past
3. Current time ≥ `showAfterTime` (or no rule set)
4. `dueDate` is today/overdue, or no due date

Everything else is in **Later**, sorted by when it becomes visible.

Completing a recurring task creates the next instance with the same `showAfterTime` rule. The one-time `deferUntil` resets.
