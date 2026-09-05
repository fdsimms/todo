import {
  isProjectFieldMissing, isProjectBackfillDismissed, projectBackfillCandidates, projectBackfillFieldCounts,
  dismissProjectBackfillField, PROJECT_BACKFILL_FIELDS,
} from '../utils/projectBackfill';
import type { Project } from '../types';

const baseProject: Project = {
  id: 'p1',
  title: 'Kitchen remodel',
  notes: '',
  deadline: null,
  category: null,
  sortOrder: 1,
  archived: false,
  archivedAt: null,
  completed: false,
  completedAt: null,
  ongoing: false,
  createdAt: '2025-01-01T00:00:00.000Z',
  nudgeCadenceDays: 0,
  autoSchedule: false,
  nudgeOptIn: false,
  weekendSource: false,
  reviewDeclinedAt: null,
  backfillDismissedFields: [],
  kind: 'project' as const,
  awayStart: null,
  awayEnd: null,
  awayPauses: false,
  awayPauseDeclinedFor: null,
  destination: null,
  awayListId: null,
  awayListDeclinedFor: null,
};

describe('isProjectFieldMissing', () => {
  it('treats nudgeOptIn false as missing regardless of a seeded cadence', () => {
    expect(isProjectFieldMissing(baseProject, 'nudge')).toBe(true);
    expect(isProjectFieldMissing({ ...baseProject, nudgeCadenceDays: 14 }, 'nudge')).toBe(true);
    expect(isProjectFieldMissing({ ...baseProject, nudgeOptIn: true }, 'nudge')).toBe(false);
  });
});

describe('projectBackfillCandidates', () => {
  it('excludes completed and archived projects', () => {
    const projects: Project[] = [
      { ...baseProject, id: 'a' },
      { ...baseProject, id: 'b', completed: true },
      { ...baseProject, id: 'c', archived: true },
    ];
    expect(projectBackfillCandidates(projects, 'nudge').map(p => p.id)).toEqual(['a']);
  });

  it('sorts candidates by title', () => {
    const projects: Project[] = [
      { ...baseProject, id: 'a', title: 'Zebra' },
      { ...baseProject, id: 'b', title: 'Apple' },
    ];
    expect(projectBackfillCandidates(projects, 'nudge').map(p => p.id)).toEqual(['b', 'a']);
  });

  it('excludes a project dismissed for that field, but not for another', () => {
    const projects: Project[] = [
      { ...baseProject, id: 'a', backfillDismissedFields: ['nudge'] },
      { ...baseProject, id: 'b', backfillDismissedFields: [] },
    ];
    expect(projectBackfillCandidates(projects, 'nudge').map(p => p.id)).toEqual(['b']);
  });
});

describe('isProjectBackfillDismissed / dismissProjectBackfillField', () => {
  it('is false until the field has been dismissed', () => {
    expect(isProjectBackfillDismissed(baseProject, 'nudge')).toBe(false);
  });

  it('dismissing appends the field id', () => {
    const patch = dismissProjectBackfillField(baseProject, 'nudge');
    expect(patch.backfillDismissedFields).toEqual(['nudge']);
    expect(isProjectBackfillDismissed({ ...baseProject, ...patch }, 'nudge')).toBe(true);
  });

  it('preserves other dismissed fields already on the project', () => {
    const project = { ...baseProject, backfillDismissedFields: ['other'] };
    expect(dismissProjectBackfillField(project, 'nudge').backfillDismissedFields).toEqual(['other', 'nudge']);
  });

  it('dismissing twice does not duplicate the entry', () => {
    const project = { ...baseProject, backfillDismissedFields: ['nudge'] };
    expect(dismissProjectBackfillField(project, 'nudge').backfillDismissedFields).toEqual(['nudge']);
  });
});

describe('projectBackfillFieldCounts', () => {
  it('counts each field independently, skipping completed/archived', () => {
    const projects: Project[] = [
      { ...baseProject, id: 'a', nudgeOptIn: true },
      { ...baseProject, id: 'b' },
      { ...baseProject, id: 'c', completed: true },
    ];
    // 'a' has opted into nudges but neither has been nominated as a weekend
    // source, so the two fields count different sets of the same projects.
    expect(projectBackfillFieldCounts(projects)).toEqual({ nudge: 1, weekendSource: 2 });
  });

  it('covers every declared backfillable field', () => {
    const counts = projectBackfillFieldCounts([baseProject]);
    for (const field of PROJECT_BACKFILL_FIELDS) {
      expect(counts[field.id]).toBe(1);
    }
  });

  it('does not count a project dismissed for that field', () => {
    // Dismissal is per field: saying "never chase me about this project" is not
    // saying "never suggest it for a weekend".
    const project = { ...baseProject, backfillDismissedFields: ['nudge'] };
    expect(projectBackfillFieldCounts([project])).toEqual({ nudge: 0, weekendSource: 1 });
  });

  it('reads weekendSource as missing until it is switched on', () => {
    // The flag is the whole setting, so "missing" is just "off" — there is no
    // seeded sibling value to distinguish unanswered from declined, which is why
    // 'nudge' has to read its gate rather than its cadence.
    expect(isProjectFieldMissing(baseProject, 'weekendSource')).toBe(true);
    expect(isProjectFieldMissing({ ...baseProject, weekendSource: true }, 'weekendSource')).toBe(false);
  });
});
