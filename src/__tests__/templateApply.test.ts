import { applyTemplateRun, type TemplateRunSink } from '../utils/templateApply';
import { normalizeTemplateItem } from '../utils/templateUtils';
import { awayNoonIso } from '../utils/awayDates';
import type { Project, Task, TaskTemplate, TemplateItem } from '../types';

// awayDates reaches dateUtils, which reaches the settings store; nothing here
// reads a setting.
jest.mock('../store/useSettingsStore', () => ({
  useSettingsStore: { getState: () => ({ dayResetTime: '00:00', weekStartsOn: 0 }) },
}));

const item = (id: string, title: string, overrides: Partial<TemplateItem> = {}): TemplateItem =>
  normalizeTemplateItem({ id, title, ...overrides });

const makeTemplate = (overrides: Partial<TaskTemplate> = {}): TaskTemplate => ({
  id: 'tpl-1',
  name: 'Template',
  items: [],
  itemGroups: [],
  questions: [],
  createdAt: '2025-01-01T00:00:00.000Z',
  sortOrder: 1,
  category: null,
  applyContainer: 'none',
  schedule: null,
  scheduleLastFiredKey: null,
  anchorsAreAway: false,
  ...overrides,
});

const byId = (...templates: TaskTemplate[]) => new Map(templates.map(t => [t.id, t]));
const select = (...ids: string[]) => new Set(ids);
const NO_ANCHORS = { start: null, end: null };

type Calls = {
  addTask: Array<Parameters<TemplateRunSink['addTask']>[0]>;
  addSubtask: Array<{ parentId: string; title: string }>;
  createStack: Array<{ title: string; category: string | null }>;
  groupTasks: Array<{ taskIds: string[]; title: string; category: string | null }>;
  createProject: Array<{ title: string; options: Parameters<TemplateRunSink['createProject']>[1] }>;
  updateProject: Array<{ id: string; patch: Parameters<TemplateRunSink['updateProject']>[1] }>;
  homeSection: Array<{ sectionId: string; projectId: string; checklist: boolean }>;
  setAnswerGate: Array<{ taskId: string; gate: { taskId: string; answers: string[] } }>;
  setBlockers: Array<{ taskId: string; blockerTaskIds: string[] }>;
};

/**
 * A sink that records every write and hands back ids the way the store would:
 * `task-1`, `task-2`, … in creation order, and likewise per kind.
 */
function makeSink(projects: Record<string, Pick<Project, 'awayStart' | 'deadline'>> = {}) {
  const counters: Record<string, number> = {};
  const next = (kind: string) => `${kind}-${(counters[kind] = (counters[kind] ?? 0) + 1)}`;
  const calls: Calls = {
    addTask: [], addSubtask: [], createStack: [], groupTasks: [], createProject: [],
    updateProject: [], homeSection: [], setAnswerGate: [], setBlockers: [],
  };
  const sink: TemplateRunSink = {
    addTask(draft) {
      calls.addTask.push(draft);
      return { ...draft, id: next('task') } as unknown as Task;
    },
    addSubtask(parentId, title) { calls.addSubtask.push({ parentId, title }); },
    createStack(title, category) {
      calls.createStack.push({ title, category });
      return { id: next('stack') };
    },
    groupTasks(taskIds, title, category) {
      calls.groupTasks.push({ taskIds, title, category });
      return { id: next('section') };
    },
    createProject(title, options) {
      calls.createProject.push({ title, options });
      return { id: next('project') };
    },
    getProject(id) { return projects[id]; },
    updateProject(id, patch) { calls.updateProject.push({ id, patch }); },
    homeSection(sectionId, projectId, checklist) { calls.homeSection.push({ sectionId, projectId, checklist }); },
    setAnswerGate(taskId, gate) { calls.setAnswerGate.push({ taskId, gate }); },
    setBlockers(taskId, blockerTaskIds) { calls.setBlockers.push({ taskId, blockerTaskIds }); },
  };
  return { sink, calls };
}

describe('applyTemplateRun', () => {
  describe('what a run creates', () => {
    it('creates one task per selected item, in item order', () => {
      const tpl = makeTemplate({ items: [item('a', 'Pack'), item('b', 'Book'), item('c', 'Go')] });
      const { sink, calls } = makeSink();
      const created = applyTemplateRun(tpl, byId(tpl), select('a', 'c'), NO_ANCHORS, undefined, sink);
      expect(created.map(t => t.title)).toEqual(['Pack', 'Go']);
      expect(calls.addTask.map(d => d.title)).toEqual(['Pack', 'Go']);
    });

    it('creates nothing, and no container, when the selection expands to nothing', () => {
      const tpl = makeTemplate({ items: [item('a', 'Pack')], applyContainer: 'project' });
      const { sink, calls } = makeSink();
      expect(applyTemplateRun(tpl, byId(tpl), select('missing'), NO_ANCHORS, { runName: 'Trip' }, sink)).toEqual([]);
      expect(calls.createProject).toEqual([]);
      expect(calls.createStack).toEqual([]);
    });

    it('reaches a nested template from a selection that names only its leaves', () => {
      const child = makeTemplate({ id: 'child', items: [item('c1', 'Child task')] });
      const parent = makeTemplate({
        items: [item('ref', 'Child', { refTemplateId: 'child', refTemplateName: 'Child' }), item('p1', 'Parent task')],
      });
      const { sink } = makeSink();
      const created = applyTemplateRun(parent, byId(parent, child), select('c1', 'p1'), NO_ANCHORS, undefined, sink);
      expect(created.map(t => t.title)).toEqual(['Child task', 'Parent task']);
    });
  });

  describe('the container', () => {
    it('stays loose when the run has no name, whatever the template says', () => {
      const tpl = makeTemplate({ items: [item('a', 'Pack')], applyContainer: 'stack' });
      const { sink, calls } = makeSink();
      applyTemplateRun(tpl, byId(tpl), select('a'), NO_ANCHORS, { runName: '  ' }, sink);
      expect(calls.createStack).toEqual([]);
      expect(calls.addTask[0].groupId).toBeUndefined();
    });

    it('files a named stack run under one stack carrying the majority category', () => {
      const tpl = makeTemplate({
        items: [
          item('a', 'Pack', { category: 'Home' }),
          item('b', 'Book', { category: 'Work' }),
          item('c', 'Go', { category: 'Home' }),
        ],
        applyContainer: 'stack',
      });
      const { sink, calls } = makeSink();
      applyTemplateRun(tpl, byId(tpl), select('a', 'b', 'c'), NO_ANCHORS, { runName: 'Trip' }, sink);
      expect(calls.createStack).toEqual([{ title: 'Trip', category: 'Home' }]);
      // Every member adopts the stack's category, the rule groupTasks enforces
      // wherever a stack exists.
      expect(calls.addTask.map(d => [d.groupId, d.category])).toEqual([
        ['stack-1', 'Home'],
        ['stack-1', 'Home'],
        ['stack-1', 'Home'],
      ]);
    });

    it('turns a stack run into a project once its items use sections, homing each section on its page', () => {
      const tpl = makeTemplate({
        items: [item('a', 'Passport', { groupId: 'g1' }), item('b', 'Charger')],
        itemGroups: [{ id: 'g1', title: 'Documents', sortOrder: 0, checklist: true }],
        applyContainer: 'stack',
      });
      const end = new Date(2026, 7, 20);
      const { sink, calls } = makeSink();
      applyTemplateRun(tpl, byId(tpl), select('a', 'b'), { start: null, end }, { runName: 'Trip' }, sink);
      expect(calls.createStack).toEqual([]);
      expect(calls.createProject).toEqual([{ title: 'Trip', options: { deadline: end.toISOString() } }]);
      expect(calls.addTask.map(d => d.projectId)).toEqual(['project-1', 'project-1']);
      expect(calls.groupTasks).toEqual([{ taskIds: ['task-1'], title: 'Documents', category: null }]);
      expect(calls.homeSection).toEqual([{ sectionId: 'section-1', projectId: 'project-1', checklist: true }]);
    });

    it('gives a trip project its away span and no deadline', () => {
      const tpl = makeTemplate({ items: [item('a', 'Pack')], applyContainer: 'project', anchorsAreAway: true });
      const start = new Date(2026, 7, 10);
      const end = new Date(2026, 7, 20);
      const { sink, calls } = makeSink();
      applyTemplateRun(tpl, byId(tpl), select('a'), { start, end }, { runName: 'Lisbon' }, sink);
      expect(calls.createProject).toEqual([
        { title: 'Lisbon', options: { awayStart: awayNoonIso(start), awayEnd: awayNoonIso(end) } },
      ]);
    });

    it('drops an away end with no start rather than storing half a span', () => {
      const tpl = makeTemplate({ items: [item('a', 'Pack')], applyContainer: 'project', anchorsAreAway: true });
      const { sink, calls } = makeSink();
      applyTemplateRun(tpl, byId(tpl), select('a'), { start: null, end: new Date(2026, 7, 20) }, { runName: 'Lisbon' }, sink);
      expect(calls.createProject).toEqual([{ title: 'Lisbon', options: {} }]);
    });

    it('creates the run project in Planning when asked, and ignores the ask with no project to create', () => {
      const tpl = makeTemplate({ items: [item('a', 'Invite')], applyContainer: 'project' });
      const { sink, calls } = makeSink();
      applyTemplateRun(tpl, byId(tpl), select('a'), { start: null, end: null }, { runName: 'Party', planning: true }, sink);
      expect(calls.createProject).toEqual([{ title: 'Party', options: { deadline: null, planning: true } }]);
      const loose = makeSink();
      applyTemplateRun(tpl, byId(tpl), select('a'), { start: null, end: null }, { planning: true }, loose.sink);
      expect(loose.calls.createProject).toEqual([]);
    });

    it('makes a task run one parent with every item as its subtask, stubs flattened onto the parent', () => {
      const tpl = makeTemplate({
        items: [
          item('a', 'Pack', { category: 'Home', subtasks: [{ id: 's1', title: 'Socks' }] }),
          item('b', 'Book', {
            category: 'Home',
            groupId: 'g1',
            answerGate: { itemId: 'a', answers: ['yes'] },
            blockedByItemIds: ['a'],
          }),
        ],
        itemGroups: [{ id: 'g1', title: 'Section', sortOrder: 0 }],
        applyContainer: 'task',
      });
      const { sink, calls } = makeSink();
      const created = applyTemplateRun(
        tpl, byId(tpl), select('a', 'b'), NO_ANCHORS, { runName: 'Trip', personIds: ['p1'] }, sink,
      );
      expect(calls.addTask[0]).toEqual({ title: 'Trip', category: 'Home' });
      expect(created.map(t => t.title)).toEqual(['Pack', 'Book']);
      expect(calls.addTask.slice(1).map(d => d.parentId)).toEqual(['task-1', 'task-1']);
      // The people go on the items; the parent stands for the run and takes none.
      expect(calls.addTask.slice(1).map(d => d.personIds)).toEqual([['p1'], ['p1']]);
      expect(calls.addSubtask).toEqual([{ parentId: 'task-1', title: 'Socks' }]);
      // Sections, gates and blockers only mean anything among top-level tasks.
      expect(calls.groupTasks).toEqual([]);
      expect(calls.setAnswerGate).toEqual([]);
      expect(calls.setBlockers).toEqual([]);
    });
  });

  describe('an existing project', () => {
    it('lands the run in the target project as a stack rather than creating a second project', () => {
      const tpl = makeTemplate({
        items: [item('a', 'Passport', { groupId: 'g1' })],
        itemGroups: [{ id: 'g1', title: 'Documents', sortOrder: 0 }],
        applyContainer: 'project',
      });
      const { sink, calls } = makeSink({ 'proj-9': { awayStart: null, deadline: '2026-09-01T12:00:00.000Z' } });
      applyTemplateRun(tpl, byId(tpl), select('a'), NO_ANCHORS, { runName: 'Trip', targetProjectId: 'proj-9' }, sink);
      expect(calls.createProject).toEqual([]);
      expect(calls.createStack).toEqual([{ title: 'Trip', category: null }]);
      expect(calls.addTask.map(d => d.projectId)).toEqual(['proj-9']);
      expect(calls.homeSection).toEqual([{ sectionId: 'section-1', projectId: 'proj-9', checklist: false }]);
    });

    it('fills in only the deadline the target project has not got', () => {
      const tpl = makeTemplate({ items: [item('a', 'Pack')] });
      const end = new Date(2026, 7, 20);
      const { sink, calls } = makeSink({
        bare: { awayStart: null, deadline: null },
        dated: { awayStart: null, deadline: '2026-01-01T12:00:00.000Z' },
      });
      applyTemplateRun(tpl, byId(tpl), select('a'), { start: null, end }, { targetProjectId: 'bare' }, sink);
      applyTemplateRun(tpl, byId(tpl), select('a'), { start: null, end }, { targetProjectId: 'dated' }, sink);
      expect(calls.updateProject).toEqual([{ id: 'bare', patch: { deadline: end.toISOString() } }]);
    });

    it('fills in a trip project\'s away span the same way', () => {
      const tpl = makeTemplate({ items: [item('a', 'Pack')], anchorsAreAway: true });
      const start = new Date(2026, 7, 10);
      const end = new Date(2026, 7, 20);
      const { sink, calls } = makeSink({
        bare: { awayStart: null, deadline: null },
        away: { awayStart: '2026-01-01T12:00:00.000Z', deadline: null },
      });
      applyTemplateRun(tpl, byId(tpl), select('a'), { start, end }, { targetProjectId: 'bare' }, sink);
      applyTemplateRun(tpl, byId(tpl), select('a'), { start, end }, { targetProjectId: 'away' }, sink);
      expect(calls.updateProject).toEqual([
        { id: 'bare', patch: { awayStart: awayNoonIso(start), awayEnd: awayNoonIso(end) } },
      ]);
    });
  });

  describe('the text', () => {
    it('binds {run} to the run name and fills the other placeholders, stubs included', () => {
      const tpl = makeTemplate({
        items: [
          item('a', 'Pack for {run} with {who}', {
            notes: 'See {who}',
            subtasks: [{ id: 's', title: 'Socks for {run}' }],
          }),
        ],
      });
      const { sink, calls } = makeSink();
      applyTemplateRun(tpl, byId(tpl), select('a'), NO_ANCHORS, { runName: 'Lisbon', placeholders: { who: 'Sam' } }, sink);
      expect(calls.addTask[0].title).toBe('Pack for Lisbon with Sam');
      expect(calls.addTask[0].notes).toBe('See Sam');
      expect(calls.addSubtask).toEqual([{ parentId: 'task-1', title: 'Socks for Lisbon' }]);
    });

    it('lets an answer pick an item\'s variant', () => {
      const tpl = makeTemplate({
        items: [item('a', 'Pack', { variants: [{ questionId: 'q1', answer: 'cold', title: 'Pack the coat' }] })],
      });
      const { sink, calls } = makeSink();
      applyTemplateRun(tpl, byId(tpl), select('a'), NO_ANCHORS, { answers: { q1: 'cold' } }, sink);
      applyTemplateRun(tpl, byId(tpl), select('a'), NO_ANCHORS, { answers: { q1: 'warm' } }, sink);
      expect(calls.addTask.map(d => d.title)).toEqual(['Pack the coat', 'Pack']);
    });
  });

  describe('the wiring between items', () => {
    it('turns an answer gate into a task gate only when the question item was ticked', () => {
      const tpl = makeTemplate({
        items: [item('q', 'Flying?'), item('a', 'Book seats', { answerGate: { itemId: 'q', answers: ['yes'] } })],
      });
      const { sink, calls } = makeSink();
      applyTemplateRun(tpl, byId(tpl), select('q', 'a'), NO_ANCHORS, undefined, sink);
      expect(calls.setAnswerGate).toEqual([{ taskId: 'task-2', gate: { taskId: 'task-1', answers: ['yes'] } }]);
      // A gate on a question nobody will be asked would hold the task back for good.
      applyTemplateRun(tpl, byId(tpl), select('a'), NO_ANCHORS, undefined, sink);
      expect(calls.setAnswerGate).toHaveLength(1);
    });

    it('names blockers by the tasks they became, dropping items that made none', () => {
      const tpl = makeTemplate({
        items: [item('a', 'Passport'), item('b', 'Visa'), item('c', 'Fly', { blockedByItemIds: ['a', 'b'] })],
      });
      const { sink, calls } = makeSink();
      applyTemplateRun(tpl, byId(tpl), select('a', 'c'), NO_ANCHORS, undefined, sink);
      expect(calls.setBlockers).toEqual([{ taskId: 'task-2', blockerTaskIds: ['task-1'] }]);
    });

    it('keys a section by its own template, so a nested template\'s sections never collide with the parent\'s', () => {
      const child = makeTemplate({
        id: 'child',
        items: [item('c1', 'Child doc', { groupId: 'g' })],
        itemGroups: [{ id: 'g', title: 'Child docs', sortOrder: 0 }],
      });
      const parent = makeTemplate({
        items: [
          item('p1', 'Parent doc', { groupId: 'g' }),
          item('ref', 'Child', { refTemplateId: 'child', refTemplateName: 'Child' }),
        ],
        itemGroups: [{ id: 'g', title: 'Parent docs', sortOrder: 0 }],
      });
      const { sink, calls } = makeSink();
      applyTemplateRun(parent, byId(parent, child), select('p1', 'c1'), NO_ANCHORS, undefined, sink);
      expect(calls.groupTasks.map(g => [g.title, g.taskIds])).toEqual([
        ['Parent docs', ['task-1']],
        ['Child docs', ['task-2']],
      ]);
    });
  });
});
