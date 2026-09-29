import React, { useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, Alert } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useShallow } from 'zustand/react/shallow';
import { startOfDay } from 'date-fns/startOfDay';
import { addDays } from 'date-fns/addDays';
import { addHours } from 'date-fns/addHours';
import { SheetModal } from './SheetModal';
import { SheetHeader } from './SheetHeader';
import { SheetHeaderButton } from './SheetHeaderButton';
import { CalendarPicker } from './CalendarPicker';
import { useColors } from '../theme/ThemeContext';
import { spacing, radius, font, fontWeight, iconSize, interaction, type Colors } from '../theme';
import { usePersonStore, displayNameOf } from '../store/usePersonStore';
import { usePersonGroupStore } from '../store/usePersonGroupStore';
import { useSettingsStore } from '../store/useSettingsStore';
import { useEventPeopleStore } from '../store/useEventPeopleStore';
import { groupMentionTokens } from '../utils/peopleRegistry';
import { parseQuickEvent } from '../utils/quickEvent';
import { formatTimeOfDay, getCurrentDayStart, getLogicalNow } from '../utils/dateUtils';
import { haptics } from '../utils/haptics';

interface Props {
  visible: boolean;
  onClose: () => void;
}

/**
 * Quick add for a calendar event: one line ("lunch w/ @dustin sat 12pm"),
 * read by `parseQuickEvent` as you type, with the result shown underneath.
 * "Next" opens Apple's new-event sheet filled in from it, where the calendar
 * (Google included) is picked and the event is saved; the people named are
 * linked once it is (`useEventPeopleStore.createEvent`).
 *
 * Its own small sheet rather than a mode of `QuickAddModal`: that one builds a
 * task, and nearly all of it (category, tags, priority, chain steps, the
 * editor hand-off) means nothing for an event. The two share the parsers,
 * which is the part that has to agree.
 *
 * The system sheet is presented on top of this one while it is still open, and
 * this one closes only once the event is saved. A cancel there lands back here
 * with the line intact, and presenting from a sheet mid-dismissal is the thing
 * UIKit refuses.
 */
export function QuickEventSheet({ visible, onClose }: Props) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const people = usePersonStore(useShallow(s => s.people.filter(p => !p.archived)));
  const groups = usePersonGroupStore(useShallow(s => s.groups));
  const groupTokens = useMemo(() => groupMentionTokens(), [people, groups]);
  const dayResetTime = useSettingsStore(s => s.dayResetTime);
  const use24Hour = useSettingsStore(s => s.use24HourTime);
  const createEvent = useEventPeopleStore(s => s.createEvent);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  // A hand-picked start overrides whatever the line itself parses to. Cleared
  // on every text edit, so a schedule phrase typed afterward wins back —
  // otherwise a stale pick from before the last edit would silently stick.
  const [startOverride, setStartOverride] = useState<Date | null>(null);
  const [allDay, setAllDay] = useState(false);
  const [pickerVisible, setPickerVisible] = useState(false);
  const inputRef = useRef<TextInput>(null);

  useEffect(() => {
    if (visible) { setText(''); setBusy(false); setStartOverride(null); setAllDay(false); setPickerVisible(false); }
  }, [visible]);

  const draft = useMemo(() => {
    const byId = new Map(people.map(p => [p.id, p]));
    return parseQuickEvent(text, {
      people,
      groups: groupTokens,
      nameOf: id => { const p = byId.get(id); return p ? displayNameOf(p) : null; },
      now: getLogicalNow(dayResetTime),
      today: getCurrentDayStart(),
      wallClock: new Date(),
    });
  }, [text, people, groupTokens, dayResetTime]);

  const onChangeText = (t: string) => { setText(t); setStartOverride(null); };

  const rawStart = startOverride ?? draft.start;
  const effectiveStart = allDay ? startOfDay(rawStart) : rawStart;
  // All-day events are exclusive on the end date in EventKit — one full day
  // is [date, date + 1), same convention as createAllDayEvent.
  const effectiveEnd = allDay ? addDays(effectiveStart, 1) : addHours(effectiveStart, 1);

  const namedPeople = people.filter(p => draft.personIds.includes(p.id)).map(displayNameOf);
  const when = allDay
    ? effectiveStart.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })
    : `${effectiveStart.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}, ${formatTimeOfDay(effectiveStart, use24Hour)}`;

  const next = async () => {
    if (busy) return;
    haptics.tap();
    setBusy(true);
    const saved = await createEvent(
      { title: draft.title, start: effectiveStart, end: effectiveEnd, allDay },
      draft.personIds
    );
    setBusy(false);
    if (saved) onClose();
  };

  // The typed line is staged until the event is saved, so a swipe-down must
  // ask, the pageSheet rule in CLAUDE.md.
  const handleCancel = () => {
    if (!text.trim()) { onClose(); return; }
    Alert.alert(
      'Discard changes?',
      'You have unsaved changes. Are you sure you want to discard them?',
      [
        { text: 'Keep editing', style: 'cancel' },
        { text: 'Discard', style: 'destructive', onPress: onClose },
      ],
    );
  };

  return (
    <SheetModal
      name="QuickEventSheet"
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={handleCancel}
    >
      <View style={styles.root}>
        <SheetHeader
          title="New event"
          left={<SheetHeaderButton label="Cancel" role="cancel" onPress={handleCancel} minWidth={64} />}
          right={<SheetHeaderButton label="Next" onPress={next} minWidth={64} />}
        />
        <View style={styles.body}>
          <TextInput
            ref={inputRef}
            style={styles.input}
            value={text}
            onChangeText={onChangeText}
            placeholder="e.g. lunch with @name sat 12pm"
            placeholderTextColor={colors.textTertiary}
            autoFocus
            returnKeyType="next"
            onSubmitEditing={next}
            accessibilityLabel="Event, with an optional day, time and @people"
          />
          <View style={styles.preview}>
            <TouchableOpacity
              style={styles.previewRow}
              activeOpacity={interaction.activeOpacity}
              onPress={() => { haptics.tap(); setPickerVisible(true); }}
              accessibilityRole="button"
              accessibilityLabel={`Change date and time, currently ${when}`}
            >
              <Ionicons name="calendar-outline" size={iconSize.sm} color={colors.textSecondary} />
              <Text style={styles.previewText}>{when}</Text>
              <Ionicons name="chevron-forward" size={iconSize.sm} color={colors.textTertiary} />
            </TouchableOpacity>
            {namedPeople.length > 0 && (
              <View style={styles.previewRow}>
                <Ionicons name="people-outline" size={iconSize.sm} color={colors.textSecondary} />
                <Text style={styles.previewText} numberOfLines={2}>With {namedPeople.join(', ')}</Text>
              </View>
            )}
            <View style={styles.sep} />
            <TouchableOpacity
              style={styles.previewRow}
              activeOpacity={interaction.activeOpacity}
              onPress={() => { haptics.tap(); setAllDay(v => !v); }}
              accessibilityRole="switch"
              accessibilityLabel="All day"
              accessibilityState={{ checked: allDay }}
            >
              <Ionicons name="sunny-outline" size={iconSize.sm} color={colors.textSecondary} />
              <Text style={[styles.previewText, styles.toggleLabel]}>All day</Text>
              <View style={[styles.toggle, allDay && styles.toggleOn]}>
                <View style={[styles.toggleKnob, allDay && styles.toggleKnobOn]} />
              </View>
            </TouchableOpacity>
          </View>
          <Text style={styles.hint}>
            Next opens your calendar's event form with this filled in. Pick the calendar and save there.
          </Text>
        </View>
      </View>
      <CalendarPicker
        visible={pickerVisible}
        value={rawStart}
        mode={allDay ? 'date' : 'datetime'}
        title={allDay ? 'Date' : 'Date & time'}
        onConfirm={date => { setStartOverride(date); setPickerVisible(false); }}
        onCancel={() => setPickerVisible(false)}
      />
    </SheetModal>
  );
}

const makeStyles = (colors: Colors) => StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  body: { padding: spacing.md, gap: spacing.md },
  input: {
    backgroundColor: colors.bgSecondary,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.smd,
    color: colors.text,
    fontSize: font.md,
    minHeight: 48,
  },
  preview: {
    backgroundColor: colors.bgSecondary,
    borderRadius: radius.md,
    padding: spacing.md,
    gap: spacing.sm,
  },
  previewRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  previewText: { flex: 1, color: colors.text, fontSize: font.sm, fontWeight: fontWeight.medium },
  toggleLabel: { fontWeight: fontWeight.regular },
  sep: { height: StyleSheet.hairlineWidth, backgroundColor: colors.separator, marginVertical: spacing.xs },
  toggle: {
    width: 46, height: 27, borderRadius: 14,
    backgroundColor: colors.bgQuaternary, justifyContent: 'center', paddingHorizontal: 3,
  },
  toggleOn: { backgroundColor: colors.orange },
  toggleKnob: {
    width: 21, height: 21, borderRadius: 11,
    backgroundColor: colors.bg,
  },
  toggleKnobOn: { backgroundColor: colors.bg, alignSelf: 'flex-end' },
  hint: { color: colors.textSecondary, fontSize: font.xs },
});
