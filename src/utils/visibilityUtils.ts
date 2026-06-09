import type { Task, TimeOfDay, Category } from '../types';
import { getDayStart, getCurrentDayStart } from './dateUtils';
import { useSettingsStore } from '../store/useSettingsStore';
import { useCategoryStore } from '../store/useCategoryStore';

function getTimeOfDayThreshold(timeOfDay: TimeOfDay): Date {
  const { morningStart, afternoonStart, eveningStart } = useSettingsStore.getState();
  const hhmm = timeOfDay === 'morning' ? morningStart
    : timeOfDay === 'afternoon' ? afternoonStart
    : eveningStart;
  const [h, m] = hhmm.split(':').map(Number);
  const t = new Date();
  t.setHours(h, m, 0, 0);
  return t;
}

function isCategoryScheduleActive(category: string | null): boolean {
  if (!category) return true;
  const cat = useCategoryStore.getState().getCategoryByName(category);
  if (!cat || !cat.scheduleDays || !cat.scheduleStart || !cat.scheduleEnd) return true;

  const now = new Date();
  const dayOfWeek = now.getDay();
  if (!cat.scheduleDays.includes(dayOfWeek)) return false;

  const nowMins = now.getHours() * 60 + now.getMinutes();
  const [sh, sm] = cat.scheduleStart.split(':').map(Number);
  const [eh, em] = cat.scheduleEnd.split(':').map(Number);
  return nowMins >= sh * 60 + sm && nowMins < eh * 60 + em;
}

function getNextCategoryWindowStart(cat: Category): Date | null {
  if (!cat.scheduleDays || !cat.scheduleStart || !cat.scheduleEnd) return null;

  const now = new Date();
  const [sh, sm] = cat.scheduleStart.split(':').map(Number);
  const nowMins = now.getHours() * 60 + now.getMinutes();
  const startMins = sh * 60 + sm;
  const dayOfWeek = now.getDay();

  if (cat.scheduleDays.includes(dayOfWeek) && nowMins < startMins) {
    const next = new Date(now);
    next.setHours(sh, sm, 0, 0);
    return next;
  }

  for (let i = 1; i <= 7; i++) {
    const candidate = new Date(now);
    candidate.setDate(candidate.getDate() + i);
    if (cat.scheduleDays.includes(candidate.getDay())) {
      candidate.setHours(sh, sm, 0, 0);
      return candidate;
    }
  }

  return null;
}

function earliestSegmentThreshold(segments: TimeOfDay[]): Date | null {
  if (segments.length === 0) return null;
  return segments
    .map(s => getTimeOfDayThreshold(s))
    .reduce((min, t) => (t < min ? t : min));
}

export function isTaskVisible(task: Task): boolean {
  if (task.completed) return false;

  if (task.vacationPause && useSettingsStore.getState().vacationMode) return false;

  const now = new Date();
  const { dayResetTime } = useSettingsStore.getState();

  if (task.deferUntil) {
    const deferDayStart = getDayStart(new Date(task.deferUntil), dayResetTime);
    const todayStart = getCurrentDayStart();
    if (deferDayStart > todayStart) return false;
  }

  if (task.timeSegments.length > 0) {
    const threshold = earliestSegmentThreshold(task.timeSegments)!;
    if (now < threshold) return false;
  }

  if (task.dueDate) {
    const taskDayStart = getDayStart(new Date(task.dueDate), dayResetTime);
    const todayStart = getCurrentDayStart();
    if (taskDayStart > todayStart) return false;
  }

  if (!isCategoryScheduleActive(task.category)) return false;

  return true;
}

export function isTaskDeferred(task: Task): boolean {
  if (task.completed) return false;
  if (task.vacationPause && useSettingsStore.getState().vacationMode) return false;
  return !isTaskVisible(task);
}

// True when a task is hidden solely because its time-of-day segment hasn't started yet today.
// Excludes tasks deferred to a future day or due on a future day.
export function isUpcomingToday(task: Task): boolean {
  if (task.completed || !task.timeOfDay) return false;
  if (task.vacationPause && useSettingsStore.getState().vacationMode) return false;

  const now = new Date();
  const { dayResetTime } = useSettingsStore.getState();
  const todayStart = getCurrentDayStart();

  if (task.deferUntil) {
    const deferDayStart = getDayStart(new Date(task.deferUntil), dayResetTime);
    if (deferDayStart > todayStart) return false;
  }

  if (task.dueDate) {
    const taskDayStart = getDayStart(new Date(task.dueDate), dayResetTime);
    if (taskDayStart > todayStart) return false;
  }

  const threshold = getTimeOfDayThreshold(task.timeOfDay);
  return now < threshold;
}

export function getVisibleAt(task: Task): Date {
  const now = new Date();
  const { dayResetTime } = useSettingsStore.getState();
  const candidates: Date[] = [];
  const todayStart = getCurrentDayStart();

  const applyTimeSegments = (base: Date): Date => {
    const threshold = earliestSegmentThreshold(task.timeSegments);
    if (!threshold) return base;
    const result = new Date(base);
    result.setHours(threshold.getHours(), threshold.getMinutes(), 0, 0);
    return result;
  };

  if (task.deferUntil) {
    const deferDayStart = getDayStart(new Date(task.deferUntil), dayResetTime);
    if (deferDayStart > todayStart) {
      candidates.push(applyTimeSegments(deferDayStart));
    }
  }

  if (task.timeSegments.length > 0 && candidates.length === 0) {
    const threshold = earliestSegmentThreshold(task.timeSegments)!;
    if (threshold > now) candidates.push(threshold);
  }

  if (task.dueDate) {
    const taskStart = getDayStart(new Date(task.dueDate), dayResetTime);
    if (taskStart > todayStart) {
      const candidate = applyTimeSegments(taskStart);
      if (candidates.length === 0 || candidate > candidates[candidates.length - 1]) {
        candidates.push(candidate);
      }
    }
  }

  if (task.category) {
    const cat = useCategoryStore.getState().getCategoryByName(task.category);
    if (cat) {
      const nextWindow = getNextCategoryWindowStart(cat);
      if (nextWindow && nextWindow > now) candidates.push(nextWindow);
    }
  }

  if (candidates.length === 0) return now;
  return candidates.reduce((latest, d) => (d > latest ? d : latest));
}

export function getSegmentLabels(task: Task): string[] {
  const SEG_LABELS: Record<string, string> = { morning: 'Morning', afternoon: 'Afternoon', evening: 'Evening' };
  return task.timeSegments.map(s => SEG_LABELS[s]);
}
