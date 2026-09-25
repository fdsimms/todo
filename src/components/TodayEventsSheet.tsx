import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Linking, TouchableOpacity } from 'react-native';
import { useShallow } from 'zustand/react/shallow';
import { SheetModal } from './SheetModal';
import Ionicons from '@expo/vector-icons/Ionicons';
import type { BusyEvent } from '../utils/calendarBusy';
import { formatTimeOfDay } from '../utils/dateUtils';
import { directionsUrl } from '../utils/maps';
import { haptics } from '../utils/haptics';
import { useColors } from '../theme/ThemeContext';
import { spacing, radius, font, fontWeight, iconSize, interaction, type Colors } from '../theme';
import { SheetHeaderButton } from './SheetHeaderButton';
import { SheetHeader } from './SheetHeader';
import { PressableScale } from './PressableScale';
import { SegmentedControl } from './SegmentedControl';
import { useEventReminderStore } from '../store/useEventReminderStore';
import {
  EVENT_REMINDER_OFFSETS,
  describeEventReminderOffset,
  eventReminderKey,
} from '../utils/eventReminders';
import { useHiddenEventsStore } from '../store/useHiddenEventsStore';
import { hiddenEventKey } from '../utils/hiddenEvents';
import { animateLayout } from '../utils/layoutAnimation';
import { useTaskStore } from '../store/useTaskStore';
import { useSettingsStore } from '../store/useSettingsStore';
import { taskFieldsFromEvent } from '../utils/calendarEventImport';
import { useEventPeopleStore } from '../store/useEventPeopleStore';
import { usePersonStore, displayNameOf } from '../store/usePersonStore';
import { peopleForEvent, suggestedEventPeople, defaultNewEventSpan } from '../utils/eventPeople';
import { getCurrentDayStart } from '../utils/dateUtils';
import { isDemoModeActive } from '../utils/demoState';
import { InlineAction } from './InlineAction';

/** `null` is the "no reminder" segment — distinct from 0, which is a real offset (at start time). */
type OffsetChoice = number | null;

/** Which of a row's two fold-out panels is open. One at a time across the sheet. */
type OpenPanel = { key: string; panel: 'reminder' | 'people' };

interface Props {
  visible: boolean;
  onClose: () => void;
  /** Today's live events, in start order — see eventsIn. */
  events: BusyEvent[];
  /**
   * Title/color per calendar id, keyed the same way `BusyEvent.calendarId`
   * is. Omit (or pass an empty map) to leave every row untagged — the caller
   * only fills this in once more than one calendar is being read, same gate
   * `eventContextRows` uses for the Today list.
   */
  calendarsById?: Readonly<Record<string, { title: string; color: string }>>;
  /** Header title. Defaults to today's; the Calendar screen names its day. */
  title?: string;
  /**
   * The day these events are on, which is where "New event" starts. Defaults
   * to the current logical day.
   */
  day?: Date;
}

/**
 * The full read of today's calendar (#1489) — what an event row on Today opens
 * into (see `DayContextRow`; it replaced the strip this used to hang off).
 *
 * Deliberately not a calendar view: no grid, no hour rows, no laying events
 * out against a clock face. It's a plain time-ordered list, same footprint as
 * `CategoryOrderSheet` — a header and rows, nothing else on screen — because
 * that's all the question "what else is on today" needs answered. Each row
 * shows the time (or "All day"), the title, and location when EventKit has
 * one. The event itself is still read-only (see `calendarSync.ts`); a
 * location gets a directions button (opening the system Maps app isn't a
 * write to the event, so it doesn't break that rule), the bell lets a
 * row carry a lightweight local reminder — see `src/utils/eventReminders.ts`
 * for why that's a small standalone mechanism rather than a `Task` — and the
 * eye lets a row stop showing up here and on Today at all, the same way and
 * for the same reason (`src/utils/hiddenEvents.ts`).
 *
 * **All-day events don't get the bell, but do get the eye.** "N minutes
 * before start" means "before local midnight" for an all-day event, which
 * isn't a useful reminder the way it's used here (a birthday, a holiday) —
 * but a birthday you don't want reminding about is exactly the case hiding
 * is for, so that button isn't timed-event-only.
 *
 * **The person button links an event to people on the People list**
 * (`src/utils/eventPeople.ts`). That link is the app's own metadata and never
 * an attendee on the event, so nothing is sent to anybody. People the title
 * already names are listed first as a suggestion, and are still a tap each:
 * a title match is a guess, and only the user says who a plan is with. A task
 * added from a linked row carries the same people.
 */
export function TodayEventsSheet({ visible, onClose, events, calendarsById, title, day }: Props) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const remindersByKey = useEventReminderStore(s => s.remindersByKey);
  const setReminder = useEventReminderStore(s => s.setReminder);
  const clearReminder = useEventReminderStore(s => s.clearReminder);
  const hiddenByKey = useHiddenEventsStore(s => s.hiddenByKey);
  const hideEvent = useHiddenEventsStore(s => s.hideEvent);
  const unhideEvent = useHiddenEventsStore(s => s.unhideEvent);
  const [openPanel, setOpenPanel] = useState<OpenPanel | null>(null);
  const eventPeople = useEventPeopleStore(s => s.links);
  const setEventPeople = useEventPeopleStore(s => s.setPeople);
  const createEvent = useEventPeopleStore(s => s.createEvent);
  const allPeople = usePersonStore(useShallow(s => s.people));
  const people = useMemo(() => allPeople.filter(p => !p.archived), [allPeople]);
  // Which rows have had a task added *from this sheet, since it opened*, and
  // deliberately nothing more. It is feedback for a tap, not a claim that the
  // task still exists: nothing links a task to the event it was copied from
  // (that would be a `Task` column and a reconcile, which is the event-rule
  // generator's job, not this button's), so the honest scope of the record is
  // the one interaction it is confirming. Tapping twice adds two tasks, the
  // same as tapping "+" twice anywhere else does.
  const [addedKeys, setAddedKeys] = useState<readonly string[]>([]);

  // Closing forgets which rows were ticked, so reopening never shows a
  // checkmark against a task the user may since have deleted — the mark says
  // "you just added one", and once the sheet has gone it has nothing left to
  // be about. Same call `RuleListSheet` makes about its own expanded row.
  useEffect(() => {
    if (!visible) setAddedKeys([]);
  }, [visible]);

  const togglePanel = (key: string, panel: OpenPanel['panel']) => {
    animateLayout();
    setOpenPanel(current => (current?.key === key && current.panel === panel ? null : { key, panel }));
  };

  const togglePerson = (event: BusyEvent, personId: string) => {
    haptics.tap();
    const linked = peopleForEvent(eventPeople, event);
    setEventPeople(
      event,
      linked.includes(personId) ? linked.filter(id => id !== personId) : [...linked, personId]
    );
  };

  // Today, at the next whole hour; the system sheet is where the user changes
  // any of it, including which calendar (Google or otherwise) it goes in.
  const newEvent = async () => {
    haptics.tap();
    const today = getCurrentDayStart();
    const { start, end } = defaultNewEventSpan(day ?? today, today, new Date());
    await createEvent({ title: '', start, end });
  };

  // Same no-canOpenURL, silently-ignore-failure pattern as TaskItem's
  // link/call/text/email buttons — see maps.ts for why https: needs no check.
  // Copies one event onto the task list, filed under the same category the
  // day's own event rows already render under (`calendarEventCategory`) — the
  // task and the event it came from are one subject to the person reading
  // Today, the call `calendarReviewTasks.ts` makes for its own row.
  //
  // Writes the task outright rather than opening `TaskEditor` pre-filled the
  // way an imported confirmation does. Two reasons: there is nothing to review
  // (the date is the event's own, not a read of anything), and adding a task
  // for each of three back-to-back meetings should not cost three round trips
  // out of this list and back.
  const addTaskForEvent = (event: BusyEvent, key: string) => {
    haptics.success();
    const category = useSettingsStore.getState().calendarEventCategory;
    useTaskStore.getState().addTask({
      ...taskFieldsFromEvent(event),
      category: category ?? undefined,
      personIds: peopleForEvent(eventPeople, event),
    });
    animateLayout();
    setAddedKeys(keys => (keys.includes(key) ? keys : [...keys, key]));
  };

  const openDirections = async (location: string) => {
    const url = directionsUrl(location);
    if (!url) return;
    haptics.tap();
    try {
      await Linking.openURL(url);
    } catch {
      // silently ignore — no toast infra for this row-level action
    }
  };

  return (
    <SheetModal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={styles.root}>
        <SheetHeader
          title={title ?? 'Today’s events'}
          left={<View style={styles.headerSpacer} />}
          right={<SheetHeaderButton label="Done" onPress={onClose} minWidth={64} />}
        />

        <ScrollView contentContainerStyle={styles.list}>
          {events.map(event => {
            const calendar = calendarsById?.[event.calendarId];
            const key = eventReminderKey(event);
            const reminder = remindersByKey[key];
            const reminderOpen = openPanel?.key === key && openPanel.panel === 'reminder';
            const peopleOpen = openPanel?.key === key && openPanel.panel === 'people';
            const hidden = hiddenEventKey(event) in hiddenByKey;
            const linkedIds = peopleForEvent(eventPeople, event);
            const linkedNames = people.filter(p => linkedIds.includes(p.id)).map(displayNameOf);
            return (
              <View key={key}>
                <View style={[styles.row, hidden && styles.rowHidden]}>
                  <View style={styles.rowIcon}>
                    <Ionicons name="calendar-outline" size={iconSize.sm} color={colors.accent} />
                  </View>
                  <View style={styles.rowInfo}>
                    <Text style={styles.rowTitle} numberOfLines={2}>{event.title || 'Event'}</Text>
                    <View style={styles.rowMetaRow}>
                      <Text style={styles.rowTime}>
                        {event.allDay
                          ? 'All day'
                          : `${formatTimeOfDay(new Date(event.start))} – ${formatTimeOfDay(new Date(event.end))}`}
                      </Text>
                      {/* Which calendar, when it's worth saying — see Props.calendarsById. */}
                      {calendar && (
                        <View style={styles.rowCalendarTag}>
                          <View style={[styles.calendarDot, { backgroundColor: calendar.color }]} />
                          <Text style={styles.rowTime} numberOfLines={1}>{calendar.title}</Text>
                        </View>
                      )}
                    </View>
                    {linkedNames.length > 0 && (
                      <Text style={styles.rowPeople} numberOfLines={1}>With {linkedNames.join(', ')}</Text>
                    )}
                    {!!event.location && (
                      <View style={styles.locationRow}>
                        <Text style={styles.rowLocation} numberOfLines={1}>{event.location}</Text>
                        <PressableScale
                          onPress={() => openDirections(event.location!)}
                          hitSlop={8}
                          accessibilityLabel={`Get directions to ${event.location}`}
                        >
                          <Ionicons name="navigate-outline" size={iconSize.sm} color={colors.accent} />
                        </PressableScale>
                      </View>
                    )}
                  </View>
                  <View style={styles.rowActions}>
                    <PressableScale hitSlop={8}
                      style={styles.actionButton}
                      onPress={() => addTaskForEvent(event, key)}
                      accessibilityLabel={`Add a task for ${event.title || 'this event'}`}
                    >
                      <Ionicons
                        name={addedKeys.includes(key) ? 'checkmark-circle' : 'add-circle-outline'}
                        size={iconSize.sm}
                        color={addedKeys.includes(key) ? colors.green : colors.textTertiary}
                      />
                    </PressableScale>
                    {people.length > 0 && (
                      <PressableScale hitSlop={8}
                        style={styles.actionButton}
                        onPress={() => togglePanel(key, 'people')}
                        haptic
                        accessibilityLabel={
                          linkedNames.length > 0
                            ? `With ${linkedNames.join(', ')}. Tap to change who this is with.`
                            : `Choose who ${event.title || 'this event'} is with`
                        }
                      >
                        <Ionicons
                          name={linkedIds.length > 0 ? 'people' : 'people-outline'}
                          size={iconSize.sm}
                          color={linkedIds.length > 0 ? colors.accent : colors.textTertiary}
                        />
                      </PressableScale>
                    )}
                    {!event.allDay && (
                      <PressableScale hitSlop={8}
                        style={styles.actionButton}
                        onPress={() => togglePanel(key, 'reminder')}
                        haptic
                        accessibilityLabel={
                          reminder
                            ? `Reminder set, ${describeEventReminderOffset(reminder.offsetMinutes).toLowerCase()}. Tap to change.`
                            : `Set a reminder for ${event.title || 'this event'}`
                        }
                      >
                        <Ionicons
                          name={reminder ? 'notifications' : 'notifications-outline'}
                          size={iconSize.sm}
                          color={reminder ? colors.accent : colors.textTertiary}
                        />
                      </PressableScale>
                    )}
                    <PressableScale hitSlop={8}
                      style={styles.actionButton}
                      onPress={() => (hidden ? unhideEvent(event) : hideEvent(event))}
                      haptic
                      accessibilityLabel={
                        hidden
                          ? `Show ${event.title || 'this event'} on Today again`
                          : `Hide ${event.title || 'this event'} from Today`
                      }
                    >
                      <Ionicons
                        name={hidden ? 'eye-off' : 'eye-off-outline'}
                        size={iconSize.sm}
                        color={hidden ? colors.accent : colors.textTertiary}
                      />
                    </PressableScale>
                  </View>
                </View>

                {peopleOpen && (
                  <View style={styles.reminderPanel}>
                    <Text style={styles.panelHint}>
                      Who this is with. Only this app sees it; nobody is invited.
                    </Text>
                    <View style={styles.pillRow}>
                      {orderPeopleForEvent(people, event.title, linkedIds).map(p => {
                        const on = linkedIds.includes(p.id);
                        return (
                          <TouchableOpacity
                            key={p.id}
                            style={[styles.pill, on && styles.pillActive]}
                            onPress={() => togglePerson(event, p.id)}
                            activeOpacity={interaction.activeOpacity}
                            accessibilityRole="checkbox"
                            accessibilityState={{ checked: on }}
                          >
                            <Text style={[styles.pillText, on && styles.pillTextActive]}>{displayNameOf(p)}</Text>
                          </TouchableOpacity>
                        );
                      })}
                    </View>
                  </View>
                )}

                {reminderOpen && (
                  <View style={styles.reminderPanel}>
                    <SegmentedControl<OffsetChoice>
                      label="Reminder"
                      columns={3}
                      value={reminder ? reminder.offsetMinutes : null}
                      onChange={value => {
                        if (value === null) clearReminder(event);
                        else setReminder(event, value);
                      }}
                      options={[
                        { value: null, label: 'Off' },
                        ...EVENT_REMINDER_OFFSETS.map(minutes => ({
                          value: minutes,
                          label: minutes === 0 ? 'At start' : describeEventReminderOffset(minutes).replace(' before', ''),
                        })),
                      ]}
                    />
                  </View>
                )}
              </View>
            );
          })}
          {/* Nothing to create in a demo: the event would land in the real calendar. */}
          {!isDemoModeActive() && (
            <View style={styles.newEventRow}>
              <InlineAction icon="add" label="New event" surface="page" onPress={newEvent} />
            </View>
          )}
        </ScrollView>
      </View>
    </SheetModal>
  );
}

/**
 * The picker's order: anybody the title names comes first (the suggestion),
 * then everybody else in the user's own list order.
 */
function orderPeopleForEvent<P extends { id: string; name: string; nickname: string }>(
  people: readonly P[],
  title: string,
  linkedIds: readonly string[]
): P[] {
  const suggested = suggestedEventPeople(title, people, linkedIds);
  return [
    ...people.filter(p => suggested.includes(p.id)),
    ...people.filter(p => !suggested.includes(p.id)),
  ];
}

const makeStyles = (colors: Colors) => StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  headerSpacer: { width: 64 },
  list: { paddingTop: spacing.md, paddingBottom: spacing.xl },
  // Same inset-grouped card footprint as CategoryOrderSheet's rows.
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.md,
    backgroundColor: colors.bgSecondary,
    marginHorizontal: spacing.md,
    marginVertical: spacing.xxs,
    borderRadius: radius.md,
    paddingVertical: spacing.smd,
    paddingHorizontal: spacing.md,
  },
  rowIcon: {
    width: 32,
    height: 32,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.accentSubtle,
  },
  rowInfo: { flex: 1, gap: spacing.xxs },
  rowTitle: { color: colors.text, fontSize: font.md, fontWeight: fontWeight.medium },
  rowMetaRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  rowTime: { color: colors.textSecondary, fontSize: font.sm },
  rowCalendarTag: { flexDirection: 'row', alignItems: 'center', gap: 4, flexShrink: 1 },
  calendarDot: { width: 6, height: 6, borderRadius: radius.full },
  locationRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  rowLocation: { flexShrink: 1, color: colors.textTertiary, fontSize: font.xs },
  rowPeople: { color: colors.textSecondary, fontSize: font.xs },
  panelHint: { color: colors.textSecondary, fontSize: font.xs, marginBottom: spacing.sm },
  pillRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  pill: {
    paddingHorizontal: spacing.smd,
    paddingVertical: spacing.xsm,
    borderRadius: radius.full,
    backgroundColor: colors.bgTertiary,
  },
  pillActive: { backgroundColor: colors.accent },
  pillText: { color: colors.text, fontSize: font.sm },
  pillTextActive: { color: colors.onAccent, fontWeight: fontWeight.medium },
  newEventRow: { flexDirection: 'row', marginHorizontal: spacing.md, marginTop: spacing.md },
  // A hidden event stays in this list (it's how you find your way back to
  // un-hiding it) but reads as put-away, the same dimming a completed task
  // row gets elsewhere in the app.
  rowHidden: { opacity: 0.5 },
  rowActions: { flexDirection: 'row', alignItems: 'center' },
  actionButton: {
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  reminderPanel: {
    marginHorizontal: spacing.md,
    marginTop: -2,
    marginBottom: spacing.sm,
    backgroundColor: colors.bgSecondary,
    borderBottomLeftRadius: radius.md,
    borderBottomRightRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.sm + 2,
    paddingTop: spacing.xs,
  },
});
