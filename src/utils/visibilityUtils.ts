import { startOfDay } from 'date-fns';
import type { Task } from '../types';

/** True if the task should appear in the Today list right now. */
export function isTaskVisible(task: Task): boolean {
  if (task.completed) return false;

  const now = new Date();

  if (task.deferUntil && new Date(task.deferUntil) > now) return false;

  if (task.showAfterTime) {
    const [h, m] = task.showAfterTime.split(':').map(Number);
    const threshold = new Date();
    threshold.setHours(h, m, 0, 0);
    if (now < threshold) return false;
  }

  // Future-dated tasks belong in Later, not Today
  if (task.dueDate) {
    const due = startOfDay(new Date(task.dueDate));
    const today = startOfDay(now);
    if (due > today) return false;
  }

  return true;
}

/** True if the task should appear in the Later list. */
export function isTaskDeferred(task: Task): boolean {
  if (task.completed) return false;
  return !isTaskVisible(task);
}

/**
 * Returns the datetime when the task will next become visible,
 * used to sort and group the Later list.
 */
export function getVisibleAt(task: Task): Date {
  const now = new Date();
  const candidates: Date[] = [];

  if (task.deferUntil) {
    const d = new Date(task.deferUntil);
    if (d > now) candidates.push(d);
  }

  if (task.showAfterTime) {
    const [h, m] = task.showAfterTime.split(':').map(Number);
    const t = new Date();
    t.setHours(h, m, 0, 0);
    if (t > now) candidates.push(t);
  }

  if (task.dueDate) {
    const d = new Date(task.dueDate);
    const todayEnd = new Date();
    todayEnd.setHours(23, 59, 59, 999);
    if (d > todayEnd) candidates.push(startOfDay(d));
  }

  if (candidates.length === 0) return now;
  return candidates.reduce((latest, d) => (d > latest ? d : latest));
}
