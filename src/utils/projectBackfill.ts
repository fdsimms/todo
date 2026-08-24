import type { Project } from '../types';

/**
 * A project-level field the Backfill screen can walk and fill in, one
 * project at a time — the same mechanism as `fieldBackfill.ts`/
 * `categoryBackfill.ts`, over `Project`. Its own module for the same reason
 * `categoryBackfill.ts` is: the shape of "missing" and "apply" doesn't match
 * the task fields (no subtask/completed-vs-archived split the same way,
 * different store), and `nudge` in particular isn't a plain toggle — turning
 * it on means picking a cadence, not just flipping a switch, closer to the
 * task side's `estimate` field than to `streak`/`vacation`.
 *
 * Deliberately NOT covering `autoSchedule`: it's only meaningful once a
 * project already has `nudgeOptIn` and a non-zero `nudgeCadenceDays`, the
 * same "meaningless until a sibling is already set" shape that kept
 * `streakRequiresWindow` off the task-side list.
 */
export type ProjectBackfillFieldId = 'nudge' | 'sequential';

export interface ProjectBackfillFieldDef {
  id: ProjectBackfillFieldId;
  /** The row's own label in ProjectEditor — reused here so the field reads
   * as the same setting wherever it's found. */
  label: string;
  /** One line explaining what the field does, shown under its row on the
   * field-picker step. */
  hint: string;
}

// Order matters: the order these render in on the field-picker step. Same
// order ProjectEditor's own Nudges/Order cards use.
export const PROJECT_BACKFILL_FIELDS: ProjectBackfillFieldDef[] = [
  {
    id: 'nudge',
    label: 'Nudge cadence',
    hint: 'How long a project can sit with nothing scheduled before the gone-quiet nudge picks it up.',
  },
  {
    id: 'sequential',
    label: 'Do these in order',
    hint: 'Only the top task is open; the rest unlock as you finish it.',
  },
];

/** Whether `project` still has `fieldId` at its default (off) — the backfill queue's inclusion test. */
export function isProjectFieldMissing(project: Project, fieldId: ProjectBackfillFieldId): boolean {
  switch (fieldId) {
    // The gate, not the cadence value: a project can carry a seeded
    // nudgeCadenceDays (see useProjectStore's createProject, which reads the
    // Settings default) while nudgeOptIn is still false, and that project is
    // still "missing" this field until it's deliberately opted in.
    case 'nudge':
      return !project.nudgeOptIn;
    case 'sequential':
      return !project.sequential;
  }
}

/**
 * Whether the user has told the backfill screen not to ask about `fieldId`
 * on this project again — "this one genuinely never needs a nudge", not
 * "not right now" (that's the screen's own session-only `skippedIds`, which
 * never touches the project itself). See `Project.backfillDismissedFields`.
 */
export function isProjectBackfillDismissed(project: Project, fieldId: ProjectBackfillFieldId): boolean {
  return project.backfillDismissedFields.includes(fieldId);
}

// A completed or archived project is finished/filed away, not something to
// keep chasing — same exclusion `classifyProject` (projectPull.ts) already
// makes before it ever offers a project up.
export function projectBackfillCandidates(projects: Project[], fieldId: ProjectBackfillFieldId): Project[] {
  return projects
    .filter(p =>
      !p.archived && !p.completed &&
      isProjectFieldMissing(p, fieldId) && !isProjectBackfillDismissed(p, fieldId)
    )
    .sort((a, b) => a.title.localeCompare(b.title));
}

/** How many projects are still at the default for each field, for the field-picker step's counts. */
export function projectBackfillFieldCounts(projects: Project[]): Record<ProjectBackfillFieldId, number> {
  const counts = { nudge: 0, sequential: 0 } as Record<ProjectBackfillFieldId, number>;
  for (const p of projects) {
    if (p.archived || p.completed) continue;
    for (const field of PROJECT_BACKFILL_FIELDS) {
      if (isProjectFieldMissing(p, field.id) && !isProjectBackfillDismissed(p, field.id)) counts[field.id]++;
    }
  }
  return counts;
}

/**
 * The patch that records "leave this field off" for `project` — appended to
 * whatever else is already dismissed, deduped, so dismissing twice is a
 * no-op rather than growing the array. Same shape as the task/category-side
 * `dismissBackfillField`/`dismissCategoryBackfillField`.
 */
export function dismissProjectBackfillField(
  project: Project, fieldId: ProjectBackfillFieldId
): Pick<Project, 'backfillDismissedFields'> {
  return {
    backfillDismissedFields: project.backfillDismissedFields.includes(fieldId)
      ? project.backfillDismissedFields
      : [...project.backfillDismissedFields, fieldId],
  };
}
