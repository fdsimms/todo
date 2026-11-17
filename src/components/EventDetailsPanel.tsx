import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, StyleSheet, Text, TouchableOpacity, View, type StyleProp, type TextStyle } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { format } from 'date-fns/format';
import { useShallow } from 'zustand/react/shallow';
import { InlineAction } from './InlineAction';
import { useColors } from '../theme/ThemeContext';
import { font, iconSize, interaction, lineHeight, spacing, type Colors } from '../theme';
import { useCalendarStore } from '../store/useCalendarStore';
import { useEventPeopleStore } from '../store/useEventPeopleStore';
import { usePersonStore } from '../store/usePersonStore';
import { useSettingsStore } from '../store/useSettingsStore';
import { addEventDetailPerson, addEventDetailPlace, skipEventDetails } from '../store/eventDetailActions';
import { eventDetailEntries, type EventDetailEntry } from '../utils/eventDetailTasks';
import type { BusyEvent } from '../utils/calendarBusy';
import { formatTimeOfDay } from '../utils/dateUtils';
import { placeSubtitle, type PlaceResult } from '../utils/places';
import { searchPlaces } from '../services/placeSearch';
import { haptics } from '../utils/haptics';
import { isDemoModeActive } from '../utils/demoState';

/** The day and time under an event's title: "Fri, Nov 20 · 7:00 PM". */
function whenLabel(event: BusyEvent): string {
  const start = new Date(event.start);
  const day = format(start, 'EEE, MMM d');
  return event.allDay ? `${day} · All day` : `${day} · ${formatTimeOfDay(start)}`;
}

/**
 * The row's chip text, "3 events": how many the panel lists. A component of
 * its own so only an event details row subscribes to the calendar for it.
 */
export function EventDetailsCount({ style }: { style: StyleProp<TextStyle> }) {
  const count = useEventDetailEntries().length;
  return (
    <Text style={style} numberOfLines={1}>
      {`${count} ${count === 1 ? 'event' : 'events'}`}
    </Text>
  );
}

/**
 * The events the task asks about, read live off the stores so an answer shows
 * at once. Mounted only for an event details row, so no other row subscribes.
 */
function useEventDetailEntries(): EventDetailEntry[] {
  const events = useCalendarStore(s => s.events);
  const people = usePersonStore(useShallow(s => s.people.filter(p => !p.archived)));
  const links = useEventPeopleStore(s => s.links);
  const peopleFor = useEventPeopleStore(s => s.peopleFor);
  const skipped = useSettingsStore(s => s.eventDetailsSkipped);
  return useMemo(
    // Nothing in a demo: the window is the real calendar, and matching it
    // against the demo's invented people is the leak docs/arch/people.md's
    // "Calendar events offered as history" gate exists for.
    () => (isDemoModeActive() ? [] : eventDetailEntries(events, people, peopleFor, skipped, new Date())),
    // `links` is what peopleFor reads, so a link made here re-reads the list.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [events, people, links, peopleFor, skipped],
  );
}

/**
 * The event details task's expanded panel: each upcoming event whose title
 * names a person or a place, with an Add for each and a ✕ to skip the event.
 * See src/utils/eventDetailTasks.ts for what is offered and why.
 */
export function EventDetailsPanel({ taskId }: { taskId: string }) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const entries = useEventDetailEntries();
  const people = usePersonStore(s => s.people);
  const mapsOn = useSettingsStore(s => s.placeSuggestionsEnabled);

  // The Apple Maps match for each place, looked up once per name and only
  // with the switch on (searchPlaces refuses otherwise). Shown before the tap
  // so the address that will be written is on screen first.
  const [matches, setMatches] = useState<Record<string, PlaceResult | null>>({});
  // Names already asked about, so one still in flight isn't asked again.
  const asked = useRef(new Set<string>());
  const placeKey = entries
    .flatMap(e => (e.place && !e.place.done ? [e.place.text] : []))
    .join('\n');
  useEffect(() => {
    if (!mapsOn) return;
    let mounted = true;
    for (const text of new Set(placeKey.split('\n').filter(Boolean))) {
      if (asked.current.has(text)) continue;
      asked.current.add(text);
      void searchPlaces(text).then(results => {
        if (mounted) setMatches(prev => ({ ...prev, [text]: results[0] ?? null }));
      });
    }
    return () => { mounted = false; };
  }, [mapsOn, placeKey]);

  // A place write is a round trip to the calendar; hold the button while it's out.
  const [savingPlace, setSavingPlace] = useState<string | null>(null);
  const savingRef = useRef(false);

  const addPlace = async (event: BusyEvent, text: string) => {
    if (savingRef.current) return;
    savingRef.current = true;
    setSavingPlace(event.id + event.start);
    haptics.tap();
    const match = mapsOn ? matches[text] ?? null : null;
    const saved = await addEventDetailPlace(event, text, match, taskId);
    savingRef.current = false;
    setSavingPlace(null);
    if (!saved) {
      Alert.alert(
        'Couldn’t add the place',
        `${event.title || 'The event'} couldn’t be changed. Check that the app can edit your calendar in Settings, then try again.`,
      );
    }
  };

  if (entries.length === 0) {
    return <Text style={styles.empty}>Nothing left to add.</Text>;
  }

  return (
    <View>
      {entries.map((entry, index) => {
        const { event } = entry;
        const key = `${event.id}|${event.start}`;
        const match = entry.place && mapsOn ? matches[entry.place.text] ?? null : null;
        const address = match ? placeSubtitle(match) ?? match.address : null;
        return (
          // The first block sits under the panel's own divider, so only the
          // ones after it draw a line.
          <View key={key} style={[styles.event, index > 0 && styles.eventDivided]}>
            <View style={styles.eventHeader}>
              <View style={styles.eventText}>
                <Text style={styles.eventTitle} numberOfLines={1}>{event.title || 'Event'}</Text>
                <Text style={styles.eventWhen}>{whenLabel(event)}</Text>
              </View>
              <TouchableOpacity
                activeOpacity={interaction.activeOpacity}
                onPress={() => { haptics.tap(); skipEventDetails(event, taskId); }}
                hitSlop={10}
                accessibilityRole="button"
                accessibilityLabel={`Skip ${event.title || 'this event'}`}
              >
                <Ionicons name="close" size={iconSize.sm} color={colors.textTertiary} />
              </TouchableOpacity>
            </View>

            {entry.people.map(({ personId, done }) => {
              const person = people.find(p => p.id === personId);
              if (!person) return null;
              return (
                <View key={personId} style={styles.suggestion}>
                  <Ionicons name="person-outline" size={iconSize.sm} color={colors.textSecondary} style={styles.icon} />
                  <Text style={[styles.name, styles.grow]} numberOfLines={1}>{person.name}</Text>
                  {done ? (
                    <Added colors={colors} styles={styles} />
                  ) : (
                    <InlineAction
                      label="Add"
                      onPress={() => { haptics.tap(); addEventDetailPerson(event, personId, taskId); }}
                      accessibilityLabel={`Add ${person.name} to ${event.title || 'this event'}`}
                    />
                  )}
                </View>
              );
            })}

            {entry.place && (
              <View style={styles.suggestion}>
                <Ionicons name="location-outline" size={iconSize.sm} color={colors.textSecondary} style={styles.icon} />
                <View style={styles.grow}>
                  <Text style={styles.name} numberOfLines={1}>{match?.name ?? entry.place.text}</Text>
                  {address && !entry.place.done && <Text style={styles.detail} numberOfLines={1}>{address}</Text>}
                </View>
                {entry.place.done ? (
                  <Added colors={colors} styles={styles} />
                ) : (
                  <InlineAction
                    label="Add"
                    disabled={savingPlace === key}
                    onPress={() => { void addPlace(event, entry.place!.text); }}
                    accessibilityLabel={`Add ${entry.place.text} as the place for ${event.title || 'this event'}`}
                  />
                )}
              </View>
            )}
          </View>
        );
      })}
    </View>
  );
}

function Added({ colors, styles }: { colors: Colors; styles: ReturnType<typeof makeStyles> }) {
  return (
    <View style={styles.added} accessibilityLabel="Added">
      <Ionicons name="checkmark" size={iconSize.sm} color={colors.greenText} />
      <Text style={styles.addedText}>Added</Text>
    </View>
  );
}

const makeStyles = (colors: Colors) => StyleSheet.create({
  empty: { color: colors.textSecondary, fontSize: font.xs },
  // Each event is its own block, divided by the app's separator at a full
  // point so the blocks read apart in both themes.
  event: { paddingVertical: spacing.sm },
  eventDivided: {
    borderTopWidth: 1,
    borderTopColor: colors.separator,
    paddingTop: spacing.smd,
  },
  // The title wins the row; the ✕ is the short fixed sibling beside it.
  eventHeader: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm },
  eventText: { flex: 1 },
  eventTitle: { color: colors.text, fontSize: font.sm, lineHeight: lineHeight.sm },
  eventWhen: { color: colors.textSecondary, fontSize: font.xs, marginTop: 1 },
  suggestion: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginTop: spacing.sm,
    minHeight: 28,
  },
  icon: { width: iconSize.md, textAlign: 'center' },
  // The name or place takes what the Add leaves, never the other way round.
  grow: { flex: 1 },
  name: { color: colors.text, fontSize: font.sm },
  detail: { color: colors.textSecondary, fontSize: font.xs, marginTop: 1 },
  added: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  addedText: { color: colors.greenText, fontSize: font.sm },
});
