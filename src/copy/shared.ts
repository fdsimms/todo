/**
 * Words the app puts on a button in so many places that typing each one out
 * would let the wording drift: "Cancel" alone was hand-written in 141 files.
 *
 * The values are the same words the app already used, so nothing changes on
 * screen; what changes is that there is one place to read them and one place
 * to edit them. `noHandWrittenButtonLabel.test.ts` fails the build on a
 * hand-written copy of any of them.
 *
 * Add a word here once it is spelled out in several files and has to read the
 * same in all of them. A sentence used once belongs beside the code that
 * shows it, where it can be read in context; `npm run copy` finds it either way.
 */
export const BUTTON_LABEL = {
  cancel: 'Cancel',
  delete: 'Delete',
  done: 'Done',
  save: 'Save',
} as const;
