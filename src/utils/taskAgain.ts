import type { Effort, Priority, Task, TimeOfDay } from '../types';
import { formatDuration } from './effort';

/**
 * What doing a finished task again brings with it: what it was about and
 * where it was filed. Never when it was due, whether it repeated or anything
 * about how it went, since those belong to the time it was done.
 */
export interface AgainFields {
  category: string | null;
  tags: string[];
  priority: Priority;
  effort: Effort;
  estimatedMinutes: number | null;
  linkUrl: string | null;
}

export function againFields(task: Task): AgainFields {
  return {
    category: task.category,
    tags: [...task.tags],
    priority: task.priority,
    effort: task.effort,
    estimatedMinutes: task.estimatedMinutes,
    linkUrl: task.linkUrl,
  };
}

/**
 * The same fields as one line, for saying what picking a past task will fill
 * in before it is picked ("Home · 10m · #balcony"). Null when it brings
 * nothing but its title.
 */
export function describeAgainFields(fields: AgainFields): string | null {
  const parts = [
    fields.category,
    fields.estimatedMinutes !== null ? formatDuration(fields.estimatedMinutes) : null,
    fields.tags.length > 0 ? fields.tags.map(t => `#${t}`).join(' ') : null,
    fields.linkUrl ? 'Link' : null,
  ].filter((p): p is string => !!p);
  return parts.length > 0 ? parts.join(' · ') : null;
}

/**
 * A new task's draft from a finished one, for the Logbook's "Do again": the
 * fields above plus the rest of what it was about (notes, people, contact
 * details, its time of day and its subtasks' titles), with no date, so the
 * editor opens it as a fresh task to adjust and save. A project is kept only
 * while it is still open.
 */
export function againDraft(task: Task, subtaskTitles: readonly string[], projectOpen: boolean): {
  title: string;
  notes: string;
  category: string | null;
  tags: string[];
  priority: Priority;
  effort: Effort;
  estimatedMinutes: number | null;
  linkUrl: string | null;
  timeSegments: TimeOfDay[];
  personIds: string[];
  phoneNumber: string | null;
  emailAddress: string | null;
  location: string | null;
  projectId: string | null;
  subtaskTitles: string[];
} {
  return {
    title: task.title,
    notes: task.notes,
    ...againFields(task),
    timeSegments: [...task.timeSegments],
    personIds: [...(task.personIds ?? [])],
    phoneNumber: task.phoneNumber,
    emailAddress: task.emailAddress,
    location: task.location,
    projectId: projectOpen ? task.projectId : null,
    subtaskTitles: [...subtaskTitles],
  };
}
