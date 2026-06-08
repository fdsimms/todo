import type { Task } from '../types';
import { getDayStart, getCurrentDayStart } from './dateUtils';
import { useSettingsStore } from '../store/useSettingsStore';

function getTimeOfDayThreshold(timeOfDay: NonNullable<Task['timeOfDay']>): Date {
  const { morningStart, afternoonStart, eveningStart } = useSettingsStore.getState();
  const hhmm = timeOfDay === 'morning' ? morningStart
    : timeOfDay === 'afternoon' ? afternoonStart
    : eveningStart;
  const [h, m] = hhmm.split(':').map(Number);
  const t = new Date();
  t.setHours(h, m, 0, 0);
  return t;
}

export function isTaskVisible(task: Task): boolean {
  if (task.completed) return false;

  const now = new Date();
  const { dayResetTime } = useSettingsStore.getState();

  // deferUntil is day-level: hidden until that logical day arrives
  if (task.deferUntil) {
    const deferDayStart = getDayStart(new Date(task.deferUntil), dayResetTime);
    const todayStart = getCurrentDayStart();
    if (deferDayStart > todayStart) return false;
  }

  // timeOfDay: hidden until that time segment starts each day
  if (task.timeOfDay) {
    const threshold = getTimeOfDayThreshold(task.timeOfDay);
    if (now < threshold) return false;
  }

  if (task.dueDate) {
    const taskDayStart = getDayStart(new Date(task.dueDate), dayResetTime);
    const todayStart = getCurrentDayStart();
    if (taskDayStart > todayStart) return false;
  }

  return true;
}

export function isTaskDeferred(task: Task): boolean {
  if (task.completed) return false;
  return !isTaskVisible(task);
}

export function getVisibleAt(task: Task): Date {
  const now = new Date();
  const { dayResetTime } = useSettingsStore.getState();
  const candidates: Date[] = [];
  const todayStart = getCurrentDayStart();

  const applyTimeOfDay = (base: Date): Date => {
    if (!task.timeOfDay) return base;
    const threshold = getTimeOfDayThreshold(task.timeOfDay);
    const result = new Date(base);
    result.setHours(threshold.getHours(), threshold.getMinutes(), 0, 0);
    return result;
  };

  // deferUntil - day-level block
  if (task.deferUntil) {
    const deferDayStart = getDayStart(new Date(task.deferUntil), dayResetTime);
    if (deferDayStart > todayStart) {
      candidates.push(applyTimeOfDay(deferDayStart));
    }
  }

  // timeOfDay - time-level block within today (only when not already pushed to future day)
  if (task.timeOfDay && candidates.length === 0) {
    const threshold = getTimeOfDayThreshold(task.timeOfDay);
    if (threshold > now) candidates.push(threshold);
  }

  // dueDate - day-level block
  if (task.dueDate) {
    const taskStart = getDayStart(new Date(task.dueDate), dayResetTime);
    if (taskStart > todayStart) {
      const candidate = applyTimeOfDay(taskStart);
      // Only add if later than any existing candidate
      if (candidates.length === 0 || candidate > candidates[candidates.length - 1]) {
        candidates.push(candidate);
      }
    }
  }

  if (candidates.length === 0) return now;
  return candidates.reduce((latest, d) => (d > latest ? d : latest));
}
