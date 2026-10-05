// notifications.ts reaches expo-notifications, the AlarmKit bridge and two
// stores; the route needs only its two button identifiers.
jest.mock('../utils/notifications', () => ({
  COMPLETE_ACTION_IDENTIFIER: 'complete',
  SNOOZE_ACTION_IDENTIFIER: 'snooze',
}));

import { routeNotificationTap } from '../utils/notificationTapRoute';

/** What expo-notifications reports for a plain tap on the notification body. */
const TAP = 'expo.modules.notifications.actions.DEFAULT';

describe('routeNotificationTap', () => {
  it('does nothing for a payload with no task and no flag', () => {
    expect(routeNotificationTap(undefined, TAP)).toEqual({ kind: 'none' });
    expect(routeNotificationTap({}, TAP)).toEqual({ kind: 'none' });
    // A button needs a task to act on.
    expect(routeNotificationTap({}, 'complete')).toEqual({ kind: 'none' });
  });

  it('opens Today for a plain tap on a task reminder', () => {
    expect(routeNotificationTap({ taskId: 't1' }, TAP)).toEqual({ kind: 'open', taskId: 't1' });
  });

  it('tells the two reminder buttons apart by their identifier', () => {
    expect(routeNotificationTap({ taskId: 't1' }, 'complete')).toEqual({ kind: 'complete', taskId: 't1' });
    expect(routeNotificationTap({ taskId: 't1' }, 'snooze')).toEqual({ kind: 'snooze', taskId: 't1' });
  });

  it('dismisses a completion timer whatever button the tap reports', () => {
    expect(routeNotificationTap({ taskId: 't1', completionTimer: true }, TAP))
      .toEqual({ kind: 'completionTimer', taskId: 't1' });
    expect(routeNotificationTap({ taskId: 't1', completionTimer: true }, 'complete'))
      .toEqual({ kind: 'completionTimer', taskId: 't1' });
  });

  it('answers the agenda before the task gate, carrying the line it was scheduled with', () => {
    expect(routeNotificationTap({ dailyAgenda: true, agendaSpoken: 'Three things today.' }, TAP))
      .toEqual({ kind: 'agenda', spokenLine: 'Three things today.' });
    // A line it was scheduled without is no line, not an empty utterance.
    expect(routeNotificationTap({ dailyAgenda: true, agendaSpoken: '' }, TAP))
      .toEqual({ kind: 'agenda', spokenLine: null });
    expect(routeNotificationTap({ dailyAgenda: true }, TAP)).toEqual({ kind: 'agenda', spokenLine: null });
    // Even a payload that also names a task goes to the agenda.
    expect(routeNotificationTap({ dailyAgenda: true, taskId: 't1' }, 'complete'))
      .toEqual({ kind: 'agenda', spokenLine: null });
  });

  it('lands the trip reminder on the finish sheet ahead of everything else', () => {
    expect(routeNotificationTap({ activeTripReminder: true }, TAP)).toEqual({ kind: 'activeTrip' });
    expect(routeNotificationTap({ activeTripReminder: true, dailyAgenda: true, taskId: 't1' }, 'snooze'))
      .toEqual({ kind: 'activeTrip' });
  });
});
