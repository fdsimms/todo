export interface PatchNote {
  message: string;
  date: string;
}

// The list itself lives in patchNotesData.ts, generated from the fragment
// files in src/patchNotes/entries/ by scripts/build-patch-notes.js (runs on
// install/test/start). Add a new fragment there instead of editing an array
// here — every PR touching a different file is what keeps this conflict-free.
export { patchNotes } from './patchNotesData';
