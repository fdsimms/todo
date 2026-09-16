import { useState } from 'react';

/**
 * Whether a sheet that is only wanted some of the time belongs in the tree at
 * all: false until the first time it opens, true from then on.
 *
 * ## What it is for
 *
 * **A sheet must never be unmounted while it is on screen.** `SheetModal`
 * closes by holding the real `Modal` open for one more commit so the
 * keyboard's dismissal is queued ahead of it (see that file); tearing the
 * component down instead skips that hold entirely, and the race it exists to
 * prevent — a stranded touch handler on whatever renders underneath, no crash,
 * no error — is back. That shipped as the log-a-meal prompt freezing Today,
 * which returned `null` when there was nothing pending rather than lowering
 * `visible`.
 *
 * The obvious fix is to mount every sheet unconditionally and toggle `visible`,
 * which most of the app already does. It is the wrong fix for a sheet hanging
 * off a list row: neither task list virtualises, so every row on Today is
 * mounted, and an unopened `WhenPicker` still runs its hooks — one of which
 * subscribes to the whole task list for the Suggest button. A screenful of
 * rows meant a screenful of those re-rendering on every store write, which is
 * why those sheets were mounted lazily in the first place.
 *
 * So: lazily, and then permanently. A row nobody opens a picker on pays
 * nothing, and a row somebody does keeps the sheet mounted for the rest of its
 * life, which costs one idle component and buys the ordered close.
 *
 * ```tsx
 * const mountPicker = useSheetMount(pickerOpen);
 * ...
 * {mountPicker && <WhenPicker visible={pickerOpen} onCancel={...} />}
 * ```
 *
 * `visible` is the open state, never a bare `visible`: a constant `true` means
 * the only way the sheet can close is by leaving the tree, which is the bug
 * this exists to remove. `noUnmountedSheet.test.ts` fails the build on one.
 */
export function useSheetMount(open: boolean): boolean {
  const [mounted, setMounted] = useState(open);
  // Applied during render so the sheet mounts in the same commit it was asked
  // for, rather than a frame later — the same reason SheetModal takes its own
  // opening edge during render. Guarded, and it touches nothing outside this
  // hook, so there is no side effect in the render pass.
  if (open && !mounted) setMounted(true);
  return mounted;
}
