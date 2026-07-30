export interface PatchNote {
  message: string;
  date: string;
}

// Hand-maintained release notes shown in the Settings "What's New" popup.
// Add a new entry at the top when a user-facing change ships; keep entries
// short and written for someone who isn't reading the diff.
export const patchNotes: PatchNote[] = [
  { message: 'Focusing a task now waits a moment before switching to the Focus view, so you can star a few tasks in a row', date: '2026-07-30' },
  { message: 'Tasks now respond to a tap anywhere on the row, not just the text', date: '2026-07-30' },
  { message: 'Later Today button now shows a subtle dot instead of a notification-style count', date: '2026-07-30' },
  { message: 'Fixed the task title field appearing off-center while editing', date: '2026-07-30' },
  { message: 'Cycle steps on a task now truncate neatly instead of overflowing when there are a lot of them', date: '2026-07-30' },
  { message: 'Shake to undo now asks for confirmation instead of undoing right away', date: '2026-07-30' },
  { message: "See today's workload at a glance, with AI-assisted help lightening it", date: '2026-07-30' },
  { message: 'Added a deadline field with a subtle countdown badge', date: '2026-07-29' },
  { message: 'Categories can now be reordered by dragging', date: '2026-07-29' },
];
