import { subDays } from 'date-fns/subDays';
import {
  MAX_PROJECT_REVIEW_TASKS,
  PROJECT_REVIEW_LINK_URL,
  declinedToday,
  describeProjectQuiet,
  projectQuietDays,
  projectReviewLinkUrl,
  projectReviewProjectId,
  projectReviewTitle,
  projectsReviewedToday,
  staleProjectReviewTasks,
  wantedProjectReviews,
} from '../utils/projectReviewTasks';
import type { ProjectStall } from '../utils/projectPull';
import type { GeneratedKind, Project, Task } from '../types';

const settingsState = { dayResetTime: '00:00', vacationMode: false };

jest.mock('../store/useSettingsStore', () => ({
  useSettingsStore: { getState: () => settingsState },
}));

jest.mock('../store/useCategoryStore', () => ({
  useCategoryStore: {
    getState: () => ({ getCategoryByName: () => null, categories: [] }),
  },
}));

const makeProject = (overrides: Partial<Project> = {}): Project => ({
  id: 'p1',
  title: 'Kitchen renovation',
  notes: '',
  deadline: null,
  category: null,
  sortOrder: 0,
  archived: false,
  archivedAt: null,
  completed: false,
  completedAt: null,
  ongoing: false,
  createdAt: subDays(new Date(), 60).toISOString(),
  nudgeCadenceDays: 14,
  autoSchedule: false,
  nudgeOptIn: true,
  reviewDeclinedAt: null,
  backfillDismissedFields: [],
  kind: 'project' as const,
  ...overrides,
});

// Only the fields these readers actually touch — the full Task is 80 columns
// wide and none of the rest is consulted here.
type ReviewRow = Pick<Task, 'generatedKind' | 'generatedSourceId' | 'completed' | 'archived'>;

const makeRow = (
  generatedSourceId: string | null,
  overrides: Partial<ReviewRow> = {}
): ReviewRow => ({
  generatedKind: 'projectReview' as GeneratedKind,
  generatedSourceId,
  completed: false,
  archived: false,
  ...overrides,
});

const makeStall = (project: Project, quietDays = 21): ProjectStall => ({
  project,
  members: [],
  pullable: [],
  lastTouchedAt: subDays(new Date(), quietDays).toISOString(),
  quietDays,
  cadenceDays: project.nudgeCadenceDays,
  overdueBy: quietDays - project.nudgeCadenceDays,
});

describe('projectReviewLinkUrl', () => {
  it('scopes the pull sheet to one project', () => {
    expect(projectReviewLinkUrl('p1')).toBe('dundundun://projects?pull=p1');
  });

  it('falls back to the bare link rather than minting one that scopes to nothing', () => {
    expect(projectReviewLinkUrl('')).toBe(PROJECT_REVIEW_LINK_URL);
  });
});

describe('projectReviewProjectId', () => {
  it('reads the source id back off a review task', () => {
    expect(projectReviewProjectId(makeRow('p1') as Task)).toBe('p1');
  });

  it('refuses another generator holding the same column', () => {
    // The whole reason this goes through generatedSourceOf: one column carries
    // five generators' source ids, and a grocery item's id read as a project
    // would scope the sheet to a project that does not exist.
    const useUp = makeRow('grocery-7', { generatedKind: 'groceryUseUp' });
    expect(projectReviewProjectId(useUp as Task)).toBeNull();
  });
});

describe('projectReviewTitle', () => {
  it('names the verb, so the row still reads as itself away from Today', () => {
    expect(projectReviewTitle(makeProject())).toBe('Review Kitchen renovation');
  });
});

describe('declinedToday', () => {
  it('is false for a project that has never been declined', () => {
    expect(declinedToday(makeProject())).toBe(false);
  });

  it('is true for today’s stamp', () => {
    expect(declinedToday(makeProject({ reviewDeclinedAt: new Date().toISOString() }))).toBe(true);
  });

  it('expires on its own at the day rollover', () => {
    // The reason this is a stamp rather than a boolean: swiping the row away
    // means "not today", and nothing has to remember to clear it.
    const yesterday = subDays(new Date(), 1).toISOString();
    expect(declinedToday(makeProject({ reviewDeclinedAt: yesterday }))).toBe(false);
  });
});

describe('wantedProjectReviews', () => {
  it('names each quiet project, in the order the stalls arrive', () => {
    const a = makeProject({ id: 'a', title: 'Kitchen renovation' });
    const b = makeProject({ id: 'b', title: 'Tax return' });
    expect(wantedProjectReviews([makeStall(a, 21), makeStall(b, 9)])).toEqual([
      { projectId: 'a', title: 'Review Kitchen renovation', quietDays: 21 },
      { projectId: 'b', title: 'Review Tax return', quietDays: 9 },
    ]);
  });

  it('caps the set, however many projects have gone quiet', () => {
    const stalls = Array.from({ length: 8 }, (_, i) =>
      makeStall(makeProject({ id: `p${i}`, title: `Project ${i}` }))
    );
    expect(wantedProjectReviews(stalls)).toHaveLength(MAX_PROJECT_REVIEW_TASKS);
  });

  it('skips a project on auto-schedule, which is already having its next task dated', () => {
    const drip = makeProject({ id: 'a', autoSchedule: true });
    expect(wantedProjectReviews([makeStall(drip)])).toEqual([]);
  });

  it('skips a project already dealt with today', () => {
    const project = makeProject({ id: 'a' });
    expect(wantedProjectReviews([makeStall(project)], new Set(['a']))).toEqual([]);
  });

  it('skips a project declined today, and offers it again tomorrow', () => {
    const declined = makeProject({ id: 'a', reviewDeclinedAt: new Date().toISOString() });
    expect(wantedProjectReviews([makeStall(declined)])).toEqual([]);

    const stale = makeProject({ id: 'a', reviewDeclinedAt: subDays(new Date(), 1).toISOString() });
    expect(wantedProjectReviews([makeStall(stale)])).toHaveLength(1);
  });
});

describe('projectsReviewedToday', () => {
  const row = (overrides: Partial<Task>) => ({
    generatedKind: 'projectReview' as GeneratedKind,
    generatedSourceId: 'a',
    completed: false,
    completedAt: null,
    archived: false,
    archivedAt: null,
    ...overrides,
  });

  it('names a project whose review task was ticked off today', () => {
    expect([...projectsReviewedToday([
      row({ completed: true, completedAt: new Date().toISOString() }),
    ])]).toEqual(['a']);
  });

  it('counts archiving too, this app’s other “I’ve dealt with this”', () => {
    expect([...projectsReviewedToday([
      row({ archived: true, archivedAt: new Date().toISOString() }),
    ])]).toEqual(['a']);
  });

  it('forgets it once the day turns, so a project can ask again', () => {
    const yesterday = subDays(new Date(), 1).toISOString();
    expect([...projectsReviewedToday([
      row({ completed: true, completedAt: yesterday }),
    ])]).toEqual([]);
  });

  it('ignores a live row, which has nothing to say about being dealt with', () => {
    expect([...projectsReviewedToday([row({})])]).toEqual([]);
  });
});

describe('staleProjectReviewTasks', () => {
  it('names a task whose project has stopped being quiet', () => {
    const stalls = [makeStall(makeProject({ id: 'a' }))];
    const rows = [makeRow('a'), makeRow('b')];
    // 'b' was dated from this very row, which is exactly the case nothing else
    // would clean up: no mutation of a task knows a row is describing it.
    expect(staleProjectReviewTasks(rows, stalls)).toEqual([rows[1]]);
  });

  // The cap decides who gets a *new* task, not who keeps one. Losing a ranking
  // contest must not delete a row the user has already deferred to Saturday.
  it('keeps a task for a project pushed out of the capped set', () => {
    const stalls = Array.from({ length: 5 }, (_, i) =>
      makeStall(makeProject({ id: `p${i}`, title: `Project ${i}` }))
    );
    const rows = [makeRow('p4')];
    expect(wantedProjectReviews(stalls).map(w => w.projectId)).not.toContain('p4');
    expect(staleProjectReviewTasks(rows, stalls)).toEqual([]);
  });

  it('clears one for a project switched to auto-schedule, which is being handled', () => {
    const stalls = [makeStall(makeProject({ id: 'a', autoSchedule: true }))];
    const rows = [makeRow('a')];
    expect(staleProjectReviewTasks(rows, stalls)).toEqual(rows);
  });

  it('leaves a completed or archived row alone', () => {
    // The user dealt with it. A completed row is the record of that, and
    // archiving is this app's other explicit "stop showing me this".
    const rows = [
      makeRow('gone', { completed: true }),
      makeRow('gone', { archived: true }),
    ];
    expect(staleProjectReviewTasks(rows, [])).toEqual([]);
  });

  it('ignores tasks from every other generator', () => {
    const rows = [makeRow('grocery-7', { generatedKind: 'groceryUseUp' })];
    expect(staleProjectReviewTasks(rows, [])).toEqual([]);
  });

  it('clears everything when nothing is stalled, which is what vacation looks like', () => {
    const rows = [makeRow('a'), makeRow('b')];
    expect(staleProjectReviewTasks(rows, [])).toEqual(rows);
  });
});

describe('projectQuietDays', () => {
  it('counts from the newest member completion', () => {
    const project = makeProject();
    const members = [
      { completedAt: subDays(new Date(), 30).toISOString() },
      { completedAt: subDays(new Date(), 5).toISOString() },
      { completedAt: null },
    ];
    expect(projectQuietDays(project, members)).toBe(5);
  });

  it('falls back to the project’s own creation, so one that never finished anything still ages', () => {
    const project = makeProject({ createdAt: subDays(new Date(), 12).toISOString() });
    expect(projectQuietDays(project, [])).toBe(12);
  });

  it('renders no chip at all for a project that is gone', () => {
    // A row can outlive its project by up to one sweep. "Quiet 0 days" there
    // would be the app stating something false about it.
    expect(projectQuietDays(null, [])).toBeNull();
  });
});

describe('describeProjectQuiet', () => {
  it('says it plainly, and gets the singular right', () => {
    expect(describeProjectQuiet(1)).toBe('Quiet 1 day');
    expect(describeProjectQuiet(21)).toBe('Quiet 21 days');
  });
});
