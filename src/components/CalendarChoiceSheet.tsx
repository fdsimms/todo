import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Linking, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import type { Calendar as DeviceCalendar } from 'expo-calendar/legacy';
import { useColors } from '../theme/ThemeContext';
import { spacing, radius, font, fontWeight, iconSize, interaction, type Colors } from '../theme';
import { haptics } from '../utils/haptics';
import {
  getCalendarPermission,
  listWritableCalendars,
  requestCalendarPermission,
} from '../utils/calendarSync';
import { EmptyNote } from './EmptyNote';
import { InlineAction } from './InlineAction';
import { SheetHeader } from './SheetHeader';
import { SheetHeaderButton } from './SheetHeaderButton';
import { SheetModal } from './SheetModal';

interface Props {
  visible: boolean;
  /** What the calendar is being picked *for*, as the sheet's title. */
  title: string;
  /** The calendar currently written to, or null for off. */
  selectedId: string | null;
  /** Called with the chosen calendar's id, or null for "don't write anywhere". */
  onSelect: (calendarId: string | null) => void;
  onClose: () => void;
}

/**
 * Which calendar a task writes to, picked where the task is being written.
 *
 * **The dead end this closes**: the task editor's own "Log to calendar" and
 * "Add to calendar" toggles are inert until `completionCalendarId` /
 * `deadlineCalendarId` names one, and both rows said so by telling the reader
 * to go to Settings › Calendar — from a sheet holding an unsaved task behind a
 * "Discard changes?" guard. So the instruction could not be followed without
 * abandoning the edit that prompted it, which is a worse answer than the one
 * it was replacing.
 *
 * **It asks rather than navigates for exactly that reason.** The choice is one
 * id written to settings and nothing here is staged, so bringing the picker to
 * the editor costs the reader nothing, where sending them to Settings costs
 * them the task. The same picker still lives in `CompletionCalendarSettings`
 * and `DeadlineCalendarSettings`, which own the rest of the feature (the
 * footer copy, the "that calendar isn't on this device any more" warning);
 * this is the short path to the one field that gates the toggle.
 *
 * **Permission is requested on open, not on mount.** The sheet is only ever
 * mounted by a deliberate tap on the row that needs it, so the ask is the same
 * deliberate ask the settings row makes — but a mounted-but-hidden sheet
 * raising an OS prompt would not be, which is why the load is keyed on
 * `visible` rather than run once.
 */
export function CalendarChoiceSheet({ visible, title, selectedId, onSelect, onClose }: Props) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  // 'loading' until the permission answer and the list are both back, so the
  // empty state can't flash "no calendar you can write to" at someone who has
  // several.
  const [state, setState] = useState<'loading' | 'denied' | 'ready'>('loading');
  const [calendars, setCalendars] = useState<DeviceCalendar[]>([]);

  const load = useCallback(async () => {
    setState('loading');
    const permission = await getCalendarPermission().catch(() => null);
    if (permission === 'denied') { setState('denied'); return; }
    if (permission !== 'granted' && !(await requestCalendarPermission())) {
      setState('denied');
      return;
    }
    setCalendars(await listWritableCalendars());
    setState('ready');
  }, []);

  useEffect(() => {
    if (visible) void load();
  }, [visible, load]);

  const pick = (calendarId: string | null) => {
    haptics.tap();
    onSelect(calendarId);
    onClose();
  };

  return (
    <SheetModal
      name="CalendarChoiceSheet"
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <View style={styles.root}>
        <SheetHeader
          title={title}
          left={<SheetHeaderButton label="Cancel" role="cancel" onPress={onClose} />}
          right={<View style={styles.headerSpacer} />}
        />
        <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>
          {state === 'loading' && (
            <EmptyNote icon="calendar-outline">Looking for calendars you can write to…</EmptyNote>
          )}

          {state === 'denied' && (
            <>
              <EmptyNote icon="lock-closed-outline">
                This app can&apos;t reach your calendars. Turn calendar access on for it in the
                Settings app, then try again.
              </EmptyNote>
              <View style={styles.deniedAction}>
                <InlineAction
                  label="Open Settings"
                  icon="open-outline"
                  onPress={() => { haptics.tap(); void Linking.openSettings(); }}
                />
              </View>
            </>
          )}

          {state === 'ready' && calendars.length === 0 && (
            <EmptyNote icon="calendar-outline">
              Every calendar on this device is read-only. Add or unlock one you can edit in the
              Settings app under Calendar › Accounts.
            </EmptyNote>
          )}

          {state === 'ready' && calendars.length > 0 && (
            <View style={styles.card}>
              {calendars.map((calendar, index) => (
                <TouchableOpacity
                  key={calendar.id}
                  style={[styles.row, index > 0 && styles.rowRuled]}
                  activeOpacity={interaction.activeOpacity}
                  onPress={() => pick(calendar.id)}
                  accessibilityRole="button"
                  accessibilityState={{ selected: calendar.id === selectedId }}
                  accessibilityLabel={`Write to ${calendar.title}`}
                >
                  <Text style={styles.rowTitle} numberOfLines={1}>{calendar.title}</Text>
                  {calendar.id === selectedId && (
                    <Ionicons name="checkmark" size={iconSize.sm} color={colors.accent} />
                  )}
                </TouchableOpacity>
              ))}
              {/* Last, and only once there is something to turn off: a list
                  whose first row is "Off" reads as a question about the
                  feature rather than about which calendar. */}
              {selectedId !== null && (
                <TouchableOpacity
                  style={[styles.row, styles.rowRuled]}
                  activeOpacity={interaction.activeOpacity}
                  onPress={() => pick(null)}
                  accessibilityRole="button"
                  accessibilityLabel="Don't write to any calendar"
                >
                  <Text style={[styles.rowTitle, styles.rowOff]}>Off</Text>
                </TouchableOpacity>
              )}
            </View>
          )}

          <Text style={styles.hint}>
            This is the calendar every task writes to, so picking one here also sets it for the
            rest of the app. Settings › Reminders &amp; Calendar has the same choice.
          </Text>
        </ScrollView>
      </View>
    </SheetModal>
  );
}

function makeStyles(colors: Colors) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: colors.bg },
    headerSpacer: { minWidth: 40 },
    scroll: { flex: 1 },
    scrollContent: { padding: spacing.md, paddingBottom: spacing.xl },
    card: {
      backgroundColor: colors.bgSecondary,
      borderRadius: radius.md,
      overflow: 'hidden',
    },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: spacing.sm,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.smd,
    },
    rowRuled: { borderTopWidth: 1, borderTopColor: colors.separator },
    rowTitle: { flex: 1, color: colors.text, fontSize: font.md },
    rowOff: { color: colors.textSecondary },
    deniedAction: { alignItems: 'flex-start', marginTop: spacing.sm },
    hint: {
      marginTop: spacing.md,
      color: colors.textSecondary,
      fontSize: font.sm,
      lineHeight: 18,
    },
  });
}
