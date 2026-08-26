import React, { useMemo } from 'react';
import { Modal, View, Text, ScrollView, StyleSheet } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import type { BusyEvent } from '../utils/calendarBusy';
import { formatTimeOfDay } from '../utils/dateUtils';
import { useColors } from '../theme/ThemeContext';
import { spacing, radius, font, fontWeight, border, iconSize, type Colors } from '../theme';
import { SheetHeaderButton } from './SheetHeaderButton';

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
 * one; nothing here is editable, since this whole feature is read-only (see
 * `calendarSync.ts`).
 */
export function TodayEventsSheet({ visible, onClose, events, calendarsById }: Props) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={styles.root}>
        <View style={styles.header}>
          <View style={styles.headerSpacer} />
          <Text style={styles.headerTitle}>Today’s events</Text>
          <SheetHeaderButton label="Done" onPress={onClose} minWidth={64} />
        </View>

        <ScrollView contentContainerStyle={styles.list}>
          {events.map(event => {
            const calendar = calendarsById?.[event.calendarId];
            return (
              <View key={event.id} style={styles.row}>
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
                  {!!event.location && (
                    <Text style={styles.rowLocation} numberOfLines={1}>{event.location}</Text>
                  )}
                </View>
              </View>
            );
          })}
        </ScrollView>
      </View>
    </Modal>
  );
}

const makeStyles = (colors: Colors) => StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    borderBottomWidth: border.hairline,
    borderBottomColor: colors.separator,
  },
  headerSpacer: { width: 64 },
  headerTitle: { color: colors.text, fontSize: font.md, fontWeight: fontWeight.semibold },
  list: { paddingTop: spacing.md, paddingBottom: spacing.xl },
  // Same inset-grouped card footprint as CategoryOrderSheet's rows.
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.md,
    backgroundColor: colors.bgSecondary,
    marginHorizontal: spacing.md,
    marginVertical: 2,
    borderRadius: radius.md,
    paddingVertical: 12,
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
  rowInfo: { flex: 1, gap: 2 },
  rowTitle: { color: colors.text, fontSize: font.md, fontWeight: fontWeight.medium },
  rowMetaRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  rowTime: { color: colors.textSecondary, fontSize: font.sm },
  rowCalendarTag: { flexDirection: 'row', alignItems: 'center', gap: 4, flexShrink: 1 },
  calendarDot: { width: 6, height: 6, borderRadius: radius.full },
  rowLocation: { color: colors.textTertiary, fontSize: font.xs },
});
