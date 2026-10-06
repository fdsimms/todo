import { create } from 'zustand';
import type { SavedEventFields } from '../utils/savedEvents';

export interface SaveAs {
  title: string;
  fields: SavedEventFields;
  start: Date;
}

/** The event a person just added by hand, for `EventCreatedToast`. */
export interface CreatedEvent {
  id: string;
  start: Date;
  /** What a Save on the toast keeps (`savedEvents.ts`); absent when the event is already a saved one. */
  saveAs?: SaveAs;
  /** Distinguishes two saves in a row, so the toast restarts its timer. */
  key: number;
}

interface EventCreatedToastState {
  created: CreatedEvent | null;
  announce: (id: string, start: Date, saveAs?: SaveAs) => void;
  clear: () => void;
}

let counter = 0;

/**
 * Only the quick event card announces here, because it is the one write a
 * person watches happen. The meal, deadline and agent-requested events are
 * written unattended and never raise a toast.
 */
export const useEventCreatedToastStore = create<EventCreatedToastState>(set => ({
  created: null,
  announce: (id, start, saveAs) => set({ created: { id, start, saveAs, key: ++counter } }),
  clear: () => set({ created: null }),
}));
