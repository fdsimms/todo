import { Alert } from 'react-native';
import { runWhenReady } from '../navigation/navigationRef';
import { openScreenByName } from '../navigation/openScreen';
import { useAlarmStore } from '../store/useAlarmStore';
import { useSettingsStore } from '../store/useSettingsStore';
import { skippableRing } from './alarms';
import { formatTimeOfDay } from './dateUtils';
import { haptics } from './haptics';

/**
 * What the alarm Live Activity's "Skip today" button opens
 * (`dundundun://alarm-skip?id=…`, deepLinks.ts): the Alarms & Reminders screen
 * with a question over it. The button can't skip on its own, because the
 * alarm lives in the app's database and on the device's alarm schedule, which
 * only the app can change.
 *
 * Asked rather than done at once, because a tap on a card on the Lock Screen
 * is easy to make by accident and the alarm is what wakes the person up. A
 * button on the Alarms screen skips without asking (it shows the Undo).
 *
 * Run when the navigator is ready: on a cold launch the link arrives before
 * the alarm store has loaded.
 */
export function promptSkipAlarm(alarmId: string, now: Date = new Date()): void {
  runWhenReady(() => {
    openScreenByName('Reminders');
    const store = useAlarmStore.getState();
    if (!store.initialized) store.initialize();
    const alarm = useAlarmStore.getState().alarms.find(a => a.id === alarmId);
    if (!alarm) {
      Alert.alert('Alarm not found', 'This alarm was deleted, so there is nothing to skip.');
      return;
    }
    const at = skippableRing(alarm, now);
    if (!at) {
      Alert.alert('Nothing to skip', 'This alarm has already rung today, or it is turned off.');
      return;
    }
    const clock = formatTimeOfDay(at, useSettingsStore.getState().use24HourTime);
    Alert.alert(
      `Skip the ${clock} alarm today?`,
      'It stays on and rings again on its next day.',
      [
        { text: 'Keep alarm', style: 'cancel' },
        {
          text: 'Skip today',
          onPress: () => {
            if (useAlarmStore.getState().skipToday(alarmId)) haptics.success();
          },
        },
      ],
    );
  });
}
