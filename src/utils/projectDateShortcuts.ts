import { addDays } from 'date-fns/addDays';
import { differenceInCalendarDays } from 'date-fns/differenceInCalendarDays';
import type { Project } from '../types';

/**
 * Days counted back from a project's own date, offered in the date picker for
 * a task in that project: "2 weeks before the party" is how the work is
 * thought about, and without these the person worked each date out by hand.
 */

export interface ProjectDateAnchor {
  /** What the row is headed, e.g. "Before the deadline". */
  label: string;
  /** The project's date, at noon. */
  date: Date;
}

export interface ProjectDateShortcut {
  /** "On the day", "1 day", "1 week". */
  label: string;
  date: Date;
}

/**
 * The date a task in this project can be counted back from: the departure for
 * a trip that hasn't left yet, otherwise the deadline. Null when the project
 * has neither, or the date has already gone by.
 */
export function projectDateAnchor(
  project: Pick<Project, 'deadline' | 'awayStart'> | null | undefined,
  today: Date,
): ProjectDateAnchor | null {
  if (!project) return null;
  const noon = (iso: string) => { const d = new Date(iso); d.setHours(12, 0, 0, 0); return d; };
  if (project.awayStart && differenceInCalendarDays(new Date(project.awayStart), today) >= 0) {
    return { label: 'Before you leave', date: noon(project.awayStart) };
  }
  if (project.deadline && differenceInCalendarDays(new Date(project.deadline), today) >= 0) {
    return { label: 'Before the deadline', date: noon(project.deadline) };
  }
  return null;
}

const STEPS: Array<{ days: number; label: string }> = [
  { days: 0, label: 'On the day' },
  { days: 1, label: '1 day' },
  { days: 3, label: '3 days' },
  { days: 7, label: '1 week' },
  { days: 14, label: '2 weeks' },
  { days: 28, label: '4 weeks' },
];

/** The shortcuts that still land today or later; a step into the past is left out. */
export function projectDateShortcuts(anchor: ProjectDateAnchor, today: Date): ProjectDateShortcut[] {
  return STEPS
    .map(step => ({ label: step.label, date: addDays(anchor.date, -step.days) }))
    .filter(s => differenceInCalendarDays(s.date, today) >= 0);
}
