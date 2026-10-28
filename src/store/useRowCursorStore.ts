import { create } from 'zustand';

/**
 * Where the keyboard's row cursor is, by task id (`rowCursor.ts`). A store so a
 * row can ask "is it me?" with a selector and re-render only when the answer
 * changes: the screen moving the cursor doesn't touch the other rows, and the
 * two rows it does touch re-render for a boolean flipping, not for a prop
 * threaded through a list nothing memoizes around.
 *
 * Nothing persists it. It is a place to stand, not a record, and it is `null`
 * until a key puts it somewhere.
 */
interface RowCursorState {
  cursorId: string | null;
  setCursor: (id: string | null) => void;
}

export const useRowCursorStore = create<RowCursorState>(set => ({
  cursorId: null,
  setCursor: id => set(state => (state.cursorId === id ? state : { cursorId: id })),
}));
