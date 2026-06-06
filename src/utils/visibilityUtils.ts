import type { Task } from '../types';
import { getDayStart, getCurrentDayStart } from './dateUtils';
import { useSettingsStore } from '../store/useSettingsStore';

export function isTaskVisible(task: Task): boolean {
  if (task.completed) return false;
  if (task.someday) return false;

  const now = new Date();

  if (task.deferUntil && new Date(task.deferUntil) > now) return false;

  if (task.showAfterTime) {
    const [h, m] = task.showAfterTime.split(':').map(Number);
    const threshold = new Date();
    threshold.setHours(h, m, 0, 0);
    if (now < threshold) return false;
  }

  // Use the configurable day-reset time so "today" doesn't flip at midnight
  if (task.dueDate) {
    const { dayResetTime } = useSettingsStore.getState();
    const taskDayStart = getDayStart(new Date(task.dueDate), dayResetTime);
    const todayStart = getCurrentDayStart();
    if (taskDayStart > todayStart) return false;
  }

  return true;
}

export function isTaskDeferred(task: Task): boolean {
  if (task.completed) return false;
  if (task.someday) return false;
  return !isTaskVisible(task);
}

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
    const { dayResetTime } = useSettingsStore.getState();
    const taskStart = getDayStart(new Date(task.dueDate), dayResetTime);
    const todayStart = getCurrentDayStart();
    if (taskStart > todayStart) candidates.push(taskStart);
  }

  if (candidates.length === 0) return now;
  return candidates.reduce((latest, d) => (d > latest ? d : latest));
}
