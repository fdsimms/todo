import { useCallback, useRef } from 'react';

/**
 * Hold a change until the sheet that asked for it has finished dismissing.
 *
 * A sheet whose confirm both closes it and changes what the host renders (a
 * delete that trips a "this is gone" guard, a move that exits selection mode)
 * tears the Modal out of the tree in the very commit meant to dismiss it. iOS
 * never finishes dismissing it and leaves its dim layer over the screen.
 *
 * Close the sheet in the handler as usual, pass the change to `hold`, and give
 * `onDismiss` to the sheet (`SheetModal`, `EditorSheet`, `WhenPicker`,
 * `CategoryPickerSheet`). It runs once, after the sheet is gone. A later `hold`
 * replaces an earlier one that never ran, and cancelling the sheet holds
 * nothing. `onDismiss` is an iOS callback, which is the platform this ships on.
 */
export function useAfterSheetDismiss() {
  const pending = useRef<(() => void) | null>(null);
  const hold = useCallback((run: () => void) => { pending.current = run; }, []);
  const onDismiss = useCallback(() => {
    const run = pending.current;
    pending.current = null;
    run?.();
  }, []);
  return { hold, onDismiss };
}
