import { create } from 'zustand';
import type { TodayBoardPane } from '../utils/twoPane';

/**
 * Whether Today is drawing its board (`todayWideLayout: 'board'` on a two-pane
 * window, on the Today view), and if so whether a task is open in its pane:
 * null while it isn't a board. Written by `TodayScreen` and read by
 * `FloatingLayer`, which sits outside the navigator: the board is the whole
 * column while nothing is open, so the undo bar and the add button's neighbors
 * span it, and the column less the pane while a task is
 * (`floatingLayerInsetFor`). A store for `useFocusedRouteStore`'s reason: the
 * navigator is memoized, and this changes with every open and close.
 */
interface TodayPaneState {
  board: TodayBoardPane | null;
  setBoard: (board: TodayBoardPane | null) => void;
}

export const useTodayPaneStore = create<TodayPaneState>(set => ({
  board: null,
  setBoard: board => set(state => (state.board === board ? state : { board })),
}));
