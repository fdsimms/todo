import { useRef } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useTaskStore } from '../store/useTaskStore';
import type { Task } from '../types';

const NO_TASKS: Task[] = [];

/**
 * The task list for a sheet that only reads it while it is open.
 *
 * A sheet is mounted whether or not it is showing, and a bare
 * `useTaskStore(s => s.tasks)` re-renders it, and recomputes every memo keyed on
 * the list, on every task write for as long as the screen is up. Completing one
 * task on Today ran that for a dozen closed sheets nobody was looking at.
 *
 * While `open` this is the live list. Once closed it keeps returning the last
 * list it saw, the same array, so the selector never reports a change and the
 * sheet stops re-rendering. It does not fall back to an empty list, which is
 * what `QuickAddModal` does and which would blank a sheet in the middle of its
 * own dismissal: iOS keeps rendering a modal's content until the animation has
 * finished, and `SheetModal` holds the close a commit besides. A sheet that has
 * never opened holds an empty list, and shows nothing, so that costs nothing.
 *
 * It catches up in the render that opens the sheet, since `open` is already
 * true when the selector runs, so an effect keyed on `visible` reads the
 * current list rather than a stale one.
 *
 * `shallow` keeps the `useShallow` that a few call sites had (a new array with
 * the same tasks in it is not a change). It is a per-call-site constant, never
 * a value that flips between renders.
 */
export function useTasksWhileOpen(open: boolean, { shallow = false }: { shallow?: boolean } = {}): Task[] {
  const last = useRef<Task[]>(NO_TASKS);
  const select = (s: { tasks: Task[] }) => (open ? s.tasks : last.current);
  const selectShallow = useShallow(select);
  const tasks = useTaskStore(shallow ? selectShallow : select);
  if (open) last.current = tasks;
  return tasks;
}
