import { useEventTaskLinkStore, EVENT_TASK_LINKS_SETTING_KEY } from '../store/useEventTaskLinkStore';
import { dbGetSetting, dbSetSetting } from '../db/database';
import { eventTaskKey, tasksForEvent } from '../utils/eventTaskLinks';

jest.mock('../db/database', () => ({
  dbGetSetting: jest.fn().mockReturnValue(null),
  dbSetSetting: jest.fn(),
}));
jest.mock('../store/useSettingsStore', () => ({
  useSettingsStore: { getState: () => ({ dayResetTime: '00:00', weekStartsOn: 0 }) },
}));

const event = { id: 'e1', title: 'Dinner', start: '2099-01-10T18:00:00.000Z', end: '2099-01-10T20:00:00.000Z' };

beforeEach(() => {
  jest.clearAllMocks();
  (dbGetSetting as jest.Mock).mockReturnValue(null);
  useEventTaskLinkStore.setState({ links: {}, loaded: false });
});

it('loads stored links and drops the ones long past', () => {
  const keep = { key: 'a', eventId: 'e1', eventStart: event.start, eventEnd: event.end, title: '', taskIds: ['t1'] };
  const drop = { key: 'b', eventId: 'e2', eventStart: '2000-01-01T00:00:00.000Z', eventEnd: '2000-01-01T01:00:00.000Z', title: '', taskIds: ['t2'] };
  (dbGetSetting as jest.Mock).mockReturnValue(JSON.stringify({ a: keep, b: drop }));
  useEventTaskLinkStore.getState().initialize();
  expect(Object.keys(useEventTaskLinkStore.getState().links)).toEqual(['a']);
});

it('records tasks and persists them', () => {
  useEventTaskLinkStore.getState().addTasks(event, ['t1']);
  expect(tasksForEvent(useEventTaskLinkStore.getState().links, event)).toEqual(['t1']);
  expect(dbSetSetting).toHaveBeenCalledWith(EVENT_TASK_LINKS_SETTING_KEY, expect.stringContaining('t1'));
});

it('writes nothing for an empty list', () => {
  useEventTaskLinkStore.getState().addTasks(event, []);
  expect(dbSetSetting).not.toHaveBeenCalled();
});

it('rekeys onto the moved occurrence', () => {
  useEventTaskLinkStore.getState().addTasks(event, ['t1']);
  const moved = { ...event, start: '2099-01-12T18:00:00.000Z', end: '2099-01-12T20:00:00.000Z' };
  useEventTaskLinkStore.getState().rekey(eventTaskKey(event), moved);
  expect(tasksForEvent(useEventTaskLinkStore.getState().links, moved)).toEqual(['t1']);
  expect(tasksForEvent(useEventTaskLinkStore.getState().links, event)).toEqual([]);
});
