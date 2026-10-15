import { useCallback, useEffect, useRef, useState } from 'react';
import type { MedicationLog } from '../types';
import { restoreDose } from '../utils/doseRecording';
import { haptics } from '../utils/haptics';

/** How long the "Dose deleted" undo stays up. Same as `UndoBar`'s. */
const UNDO_MS = 6000;

/**
 * The undo for deleting a dose from the dose sheet. `deleted` is the row as it
 * was, for the host's `SheetUndoBar`; `remember` is the sheet's `onDeleted`;
 * `undo` puts the dose back (`restoreDose`) and clears the bar.
 */
export function useDeletedDoseUndo() {
  const [deleted, setDeleted] = useState<MedicationLog | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  const remember = useCallback((log: MedicationLog) => {
    if (timer.current) clearTimeout(timer.current);
    setDeleted(log);
    timer.current = setTimeout(() => setDeleted(null), UNDO_MS);
  }, []);

  const undo = useCallback(() => {
    if (!deleted) return;
    haptics.tap();
    restoreDose(deleted);
    if (timer.current) clearTimeout(timer.current);
    setDeleted(null);
  }, [deleted]);

  // Swiped away by hand: the dose stays deleted, the offer to bring it back goes.
  const dismiss = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    setDeleted(null);
  }, []);

  return { deleted, remember, undo, dismiss };
}
