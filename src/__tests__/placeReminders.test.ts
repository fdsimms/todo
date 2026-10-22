import type { Task } from '../types';
import type { SavedPlace } from '../utils/savedPlaces';
import {
  MAX_PLACE_REMINDERS,
  describePlaceReminder,
  placeRemindersToCancel,
  wantedPlaceReminders,
} from '../utils/placeReminders';

const home: SavedPlace = { id: 'home', name: 'Home', text: '1 Main St', latitude: 40.7, longitude: -74, moodTag: false } as SavedPlace;
const typed: SavedPlace = { id: 'typed', name: 'Gym', text: 'Gym', latitude: null, longitude: null, moodTag: false } as SavedPlace;

const task = (over: Partial<Task> = {}) => ({
  id: 't1', title: 'Take the recycling out', completed: false, archived: false, dueDate: null,
  reminderPlaceId: 'home', reminderPlaceOn: 'arrive', ...over,
}) as Task;

describe('wantedPlaceReminders', () => {
  it('arms an open task at a pinned place, ringing on arrival', () => {
    expect(wantedPlaceReminders([task()], [home], () => true)).toEqual([{
      id: 'place:t1', taskId: 't1', title: 'Take the recycling out', body: 'Arriving at Home',
      latitude: 40.7, longitude: -74, radius: 150, onEntry: true,
    }]);
  });

  it('rings on leaving when asked to', () => {
    const [r] = wantedPlaceReminders([task({ reminderPlaceOn: 'leave' })], [home], () => true);
    expect(r.onEntry).toBe(false);
    expect(r.body).toBe('Leaving Home');
  });

  it('arms nothing for a done, archived, held-back task, or one at a place with no pin', () => {
    expect(wantedPlaceReminders([task({ completed: true })], [home], () => true)).toEqual([]);
    expect(wantedPlaceReminders([task({ archived: true })], [home], () => true)).toEqual([]);
    expect(wantedPlaceReminders([task()], [home], () => false)).toEqual([]);
    expect(wantedPlaceReminders([task({ reminderPlaceId: 'typed' })], [typed], () => true)).toEqual([]);
    expect(wantedPlaceReminders([task({ reminderPlaceId: 'gone' })], [home], () => true)).toEqual([]);
  });

  it('keeps the soonest due under the cap, undated last', () => {
    const many = Array.from({ length: MAX_PLACE_REMINDERS + 2 }, (_, i) =>
      task({ id: `t${i}`, dueDate: i === 0 ? null : new Date(2026, 9, 1 + i).toISOString() }));
    const ids = wantedPlaceReminders(many, [home], () => true).map(r => r.taskId);
    expect(ids).toHaveLength(MAX_PLACE_REMINDERS);
    expect(ids).not.toContain('t0');
    expect(ids[0]).toBe('t1');
  });
});

describe('placeRemindersToCancel', () => {
  it('cancels only place reminders that are no longer wanted', () => {
    const wanted = wantedPlaceReminders([task()], [home], () => true);
    expect(placeRemindersToCancel(['place:t1', 'place:old', 'other'], wanted)).toEqual(['place:old']);
  });
});

describe('describePlaceReminder', () => {
  it('reads as arriving unless told otherwise', () => {
    expect(describePlaceReminder(null, 'Home')).toBe('Arriving at Home');
  });
});
