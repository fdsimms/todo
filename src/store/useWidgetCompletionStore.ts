import { create } from 'zustand';

// Bridges CompleteTaskIntent's queued taps (see widgetSync.ts's
// processPendingWidgetCompletions) to the Today screen. Draining the queue
// only hands ids off here rather than calling completeTask() directly, so
// TodayScreen can play the same checkbox-pop-and-fade animation a normal tap
// gets (via TaskItem's autoComplete prop) before the task actually
// disappears — otherwise a widget completion would just make the row vanish
// with no feedback that anything happened.
//
// It also carries when each tap happened. The completion runs whenever the app
// next gets to the queue, which can be after the day has turned over, and a
// repeat-after-completion task measured from that moment skipped a day: done
// Monday night, drained Tuesday, next due Wednesday. completeTask claims the
// time (claimTappedAt) rather than every path that finishes one passing it on.

/**
 * How long after an id is queued its tap time can still be claimed. The
 * completion normally follows within seconds (a row's animation, or a question
 * sheet being answered); past this the tap's completion evidently never
 * happened, and a later completion of the same task is a different one that
 * must not be backdated to it.
 */
export const TAP_CLAIM_WINDOW_MS = 30 * 60 * 1000;

interface TapRecord {
  /** ISO time of the tap itself. */
  at: string;
  /** Epoch ms the id was queued here, which the claim window runs from. */
  queuedAt: number;
}

interface WidgetCompletionState {
  pendingIds: string[];
  tappedAt: Record<string, TapRecord>;
  /** `tappedAt` maps id to ISO tap time; an id missing from it was tapped just now. */
  enqueue: (ids: string[], tappedAt?: Record<string, string>) => void;
  dequeue: (id: string) => void;
  /** The tap time for this id's completion, once; undefined if none is live. */
  claimTappedAt: (id: string) => string | undefined;
}

export const useWidgetCompletionStore = create<WidgetCompletionState>((set, get) => ({
  pendingIds: [],
  tappedAt: {},
  enqueue: (ids, tappedAt = {}) =>
    set(state => {
      const now = Date.now();
      const fresh = ids.filter(id => !state.pendingIds.includes(id));
      const records = { ...state.tappedAt };
      for (const id of fresh) {
        const at = tappedAt[id];
        // A time that doesn't parse, or claims to be in the future (a clock
        // changed since the tap), is no better than now.
        const parsed = at ? Date.parse(at) : NaN;
        records[id] = {
          at: Number.isFinite(parsed) && parsed <= now ? new Date(parsed).toISOString() : new Date(now).toISOString(),
          queuedAt: now,
        };
      }
      return { pendingIds: [...state.pendingIds, ...fresh], tappedAt: records };
    }),
  // Leaves the tap time in place: dequeue is TodayScreen claiming the id, and
  // the completion itself lands after that.
  dequeue: id => set(state => ({ pendingIds: state.pendingIds.filter(existing => existing !== id) })),
  claimTappedAt: id => {
    const record = get().tappedAt[id];
    if (!record) return undefined;
    set(state => {
      const { [id]: _claimed, ...rest } = state.tappedAt;
      return { tappedAt: rest };
    });
    return Date.now() - record.queuedAt <= TAP_CLAIM_WINDOW_MS ? record.at : undefined;
  },
}));
