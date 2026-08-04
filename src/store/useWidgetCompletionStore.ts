import { create } from 'zustand';

// Bridges CompleteTaskIntent's queued taps (see widgetSync.ts's
// processPendingWidgetCompletions) to the Today screen. Draining the queue
// only hands ids off here rather than calling completeTask() directly, so
// TodayScreen can play the same checkbox-pop-and-fade animation a normal tap
// gets (via TaskItem's autoComplete prop) before the task actually
// disappears — otherwise a widget completion would just make the row vanish
// with no feedback that anything happened.
interface WidgetCompletionState {
  pendingIds: string[];
  enqueue: (ids: string[]) => void;
  dequeue: (id: string) => void;
}

export const useWidgetCompletionStore = create<WidgetCompletionState>(set => ({
  pendingIds: [],
  enqueue: ids =>
    set(state => ({
      pendingIds: [...state.pendingIds, ...ids.filter(id => !state.pendingIds.includes(id))],
    })),
  dequeue: id => set(state => ({ pendingIds: state.pendingIds.filter(existing => existing !== id) })),
}));
