import React, { useState } from 'react';
import { Alert, TouchableOpacity, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useFocusEffect } from '@react-navigation/native';
import { useColors } from '../../theme/ThemeContext';
import { iconSize } from '../../theme';
import { CountStepper } from '../../components/CountStepper';
import { animateLayout } from '../../utils/layoutAnimation';
import { haptics } from '../../utils/haptics';
import { eventMemoryKey } from '../../utils/eventMemory';
import {
  BOOK_EVERY_MONTHS_MAX,
  describeSavedEvent,
  readSavedEvents,
  removeSavedEvent,
  sortedSavedEvents,
  updateSavedEvent,
  writeSavedEvents,
  type SavedEvent,
} from '../../utils/savedEvents';
import { useSettingsStore } from '../../store/useSettingsStore';
import { useTaskStore } from '../../store/useTaskStore';
import { ensureGeneratedTaskCategory } from '../../store/useCategoryStore';
import { SettingsRow } from './SettingsRow';
import { makeSettingsStyles } from './settingsStyles';

/** Where + lands from Off: a yearly checkup is the common case. */
const BOOK_EVERY_START = 12;

/**
 * The events kept for re-adding, in Settings › Calendar. Events are saved from
 * the toast after adding one; this is where they are removed, and where one
 * gets a booking reminder ("Book Optometrist" once a year has passed). Length,
 * place and alert aren't edited here: adding the event again updates them.
 *
 * Reads the list when the screen gains focus, the way `SavedPlacesRows` does.
 */
export function SavedEventsRows() {
  const colors = useColors();
  const styles = makeSettingsStyles(colors);
  const [events, setEvents] = useState<SavedEvent[]>([]);
  const [open, setOpen] = useState(false);
  const bookEventTasks = useSettingsStore(s => s.bookEventTasks);
  const setBookEventTasks = useSettingsStore(s => s.setBookEventTasks);
  const anyInterval = events.some(e => e.bookEveryMonths !== null);

  useFocusEffect(React.useCallback(() => { setEvents(readSavedEvents()); }, []));

  const commit = (next: SavedEvent[], animate = true) => {
    if (animate) animateLayout();
    writeSavedEvents(next);
    setEvents(next);
    if (next.length === 0) setOpen(false);
  };

  // Giving an event an interval is the opt-in, so it switches the generator on
  // (and gives it a category) rather than leaving a stepper that does nothing.
  const setBookInterval = (event: SavedEvent, months: number | null) => {
    commit(updateSavedEvent(events, event.title, { bookEveryMonths: months }), false);
    if (months !== null && !bookEventTasks) {
      setBookEventTasks(true);
      ensureGeneratedTaskCategory('bookEvent', { force: true });
    }
    useTaskStore.getState().checkBookEventTasks();
  };

  const remove = (event: SavedEvent) => {
    Alert.alert(
      `Remove ${event.title}?`,
      'It stops showing when you start a new event, on all your devices. Events already on your calendar stay.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Remove', style: 'destructive', onPress: () => {
          haptics.warning();
          commit(removeSavedEvent(events, event.title));
          useTaskStore.getState().checkBookEventTasks();
        } },
      ],
    );
  };

  return (
    <>
      <View style={styles.sep} />
      <SettingsRow
        entryId="savedEvents"
        icon="bookmark-outline"
        iconColor={events.length > 0 ? colors.accent : undefined}
        label="Saved events"
        hint={events.length === 0
          ? 'Tap Save after adding an event. It is then listed when you start a new event, filled in except for the day.'
          : anyInterval && !bookEventTasks
            ? 'Booking reminders are off. Turn on "Book saved events" in Automations to get them.'
            : 'Listed when you start a new event. Tapping one fills in everything but the day.'}
        value={events.length > 0 ? String(events.length) : undefined}
        expanded={events.length > 0 ? open : undefined}
        onPress={events.length > 0 ? () => { animateLayout(); setOpen(v => !v); } : undefined}
        accessibilityLabel="Saved events"
      />
      {open && sortedSavedEvents(events).map(event => (
        <React.Fragment key={eventMemoryKey(event.title)}>
          <View style={styles.sep} />
          <SettingsRow
            icon="calendar-outline"
            label={event.title}
            hint={describeSavedEvent(event)}
            alwaysShowHint
            tight
            trailing={(
              <TouchableOpacity
                onPress={() => remove(event)}
                hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
                accessibilityRole="button"
                accessibilityLabel={`Remove ${event.title}`}
              >
                <Ionicons name="trash-outline" size={iconSize.sm} color={colors.red} />
              </TouchableOpacity>
            )}
          />
          <View style={styles.cadenceRow}>
            <CountStepper
              value={event.bookEveryMonths}
              onChange={next => setBookInterval(event, next)}
              min={1}
              max={BOOK_EVERY_MONTHS_MAX}
              allowNull
              start={BOOK_EVERY_START}
              emptyLabel="No reminder"
              format={n => (n === 1 ? 'Book monthly' : `Book every ${n} mo`)}
              label={`Months between booking ${event.title}`}
              describeValue={n => (n === null
                ? 'No booking reminder'
                : `A task to book it ${n === 1 ? 'a month' : `${n} months`} after the last one`)}
            />
          </View>
        </React.Fragment>
      ))}
    </>
  );
}
