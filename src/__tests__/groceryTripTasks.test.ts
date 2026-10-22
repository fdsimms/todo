import type { Task } from '../types';

const visible = (_task: Task) => true;
import { tripTasksToComplete } from '../utils/groceryTripTasks';

jest.mock('../store/useSettingsStore', () => ({
  useSettingsStore: { getState: () => ({ dayResetTime: '00:00' }) },
}));
jest.mock('../store/useCategoryStore', () => ({
  useCategoryStore: { getState: () => ({ categories: [], getCategoryByName: () => null }) },
}));

// deepLinks.ts's readers, by the same rule, without importing a module that
// brings React Native along (see TripLinkReaders).
const groceriesLinkUrl = (shopId?: string) => `dundundun://groceries${shopId ? `?shop=${shopId}` : ''}`;
const links = {
  isGroceriesUrl: (url: string) => url.startsWith('dundundun://groceries'),
  groceriesUrlShop: (url: string) => /[?&]shop=([^&]+)/.exec(url)?.[1] ?? null,
};
const pick = (tasks: Task[], shopId: string | null, isVisible = visible) => tripTasksToComplete(tasks, shopId, isVisible, links);

const task = (overrides: Partial<Task>): Task =>
  ({
    id: 't',
    title: 'Get groceries',
    completed: false,
    archived: false,
    parentId: null,
    linkUrl: groceriesLinkUrl(),
    polarity: 'positive',
    targetCount: null,
    deliverableKind: null,
    chainItems: [],
    chainIndex: 0,
    ...overrides,
  }) as Task;

const ids = (tasks: Task[]) => tasks.map(t => t.id);

describe('tripTasksToComplete (#3699)', () => {
  it('checks off the stop at the store the trip finished at, and a plain Get groceries', () => {
    const tasks = [
      task({ id: 'costco', linkUrl: groceriesLinkUrl('costco') }),
      task({ id: 'cvs', linkUrl: groceriesLinkUrl('cvs') }),
      task({ id: 'plain' }),
      task({ id: 'other link', linkUrl: 'https://example.com' }),
      task({ id: 'no link', linkUrl: null }),
    ];
    expect(ids(pick(tasks, 'costco'))).toEqual(['costco', 'plain']);
  });

  it('answers only the plain one when the trip named no store', () => {
    const tasks = [task({ id: 'costco', linkUrl: groceriesLinkUrl('costco') }), task({ id: 'plain' })];
    expect(ids(pick(tasks, null))).toEqual(['plain']);
  });

  it('matches by the link, so a renamed stop still counts', () => {
    const tasks = [task({ id: 'renamed', title: 'Costco run', linkUrl: groceriesLinkUrl('costco') })];
    expect(ids(pick(tasks, 'costco'))).toEqual(['renamed']);
  });

  it('leaves a task that is not on Today now, which is what keeps a future occurrence safe', () => {
    const tasks = [task({ id: 'today' }), task({ id: 'saturday' })];
    expect(ids(pick(tasks, null, t => t.id === 'today'))).toEqual(['today']);
  });

  it('leaves done, archived and subtask rows, and the kinds a trip cannot answer for', () => {
    const tasks = [
      task({ id: 'done', completed: true }),
      task({ id: 'filed', archived: true }),
      task({ id: 'sub', parentId: 'p' }),
      task({ id: 'asks', deliverableKind: 'text' } as Partial<Task>),
      task({ id: 'quota', targetCount: 3 }),
      task({ id: 'negative', polarity: 'negative' } as Partial<Task>),
    ];
    expect(pick(tasks, null)).toEqual([]);
  });
});
