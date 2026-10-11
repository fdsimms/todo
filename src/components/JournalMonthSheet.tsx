import React, { useEffect, useMemo, useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { addMonths } from 'date-fns/addMonths';
import { format } from 'date-fns/format';
import { isSameMonth } from 'date-fns/isSameMonth';
import { SheetModal } from './SheetModal';
import { SheetHeader } from './SheetHeader';
import { SheetHeaderButton } from './SheetHeaderButton';
import type { JournalKind } from '../types';
import { useJournalStore } from '../store/useJournalStore';
import { useSettingsStore } from '../store/useSettingsStore';
import { useColors } from '../theme/ThemeContext';
import { spacing, radius, font, fontWeight, iconSize, interaction, type Colors } from '../theme';
import { haptics } from '../utils/haptics';
import { dayKeyOf, getCurrentDayStart, getLogicalToday } from '../utils/dateUtils';
import { buildCalendarGrid, weekdayHeaders } from '../utils/calendarGrid';
import { JOURNAL_KIND_COPY, daysWrittenInMonth } from '../utils/journal';

interface Props {
  visible: boolean;
  kind: JournalKind;
  /** Called with the `yyyy-MM-dd` of a day that has something written on it. */
  onPickDay: (dayKey: string) => void;
  onClose: () => void;
}

/**
 * A month of the journal or dream log with the days that have an entry
 * marked. Days with nothing on them are plain and can't be tapped: a blank
 * square is not a day that went wrong, and nothing here says otherwise.
 */
export function JournalMonthSheet({ visible, kind, onPickDay, onClose }: Props) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const all = useJournalStore(s => s.entries);
  const weekStartsOn = useSettingsStore(s => s.weekStartsOn);
  const [month, setMonth] = useState<Date>(() => getLogicalToday());

  useEffect(() => {
    if (visible) setMonth(getLogicalToday());
  }, [visible]);

  const todayKey = dayKeyOf(getCurrentDayStart());
  const written = useMemo(
    () => daysWrittenInMonth(all, kind, format(month, 'yyyy-MM'), todayKey),
    [all, kind, month, todayKey],
  );
  const grid = useMemo(() => buildCalendarGrid(month, weekStartsOn), [month, weekStartsOn]);
  const headers = useMemo(() => weekdayHeaders(weekStartsOn), [weekStartsOn]);
  const canGoForward = !isSameMonth(month, getLogicalToday());
  const copy = JOURNAL_KIND_COPY[kind];

  return (
    <SheetModal name="JournalMonthSheet" visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={styles.root}>
        <SheetHeader
          title={copy.title}
          left={<View style={styles.headerSpacer} />}
          right={<SheetHeaderButton label="Done" onPress={onClose} minWidth={56} />}
        />
        <View style={styles.monthRow}>
          <TouchableOpacity
            onPress={() => { haptics.tap(); setMonth(m => addMonths(m, -1)); }}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel="Previous month"
          >
            <Ionicons name="chevron-back" size={iconSize.md} color={colors.accent} />
          </TouchableOpacity>
          <Text style={styles.monthTitle}>{format(month, 'MMMM yyyy')}</Text>
          <TouchableOpacity
            onPress={() => { haptics.tap(); setMonth(m => addMonths(m, 1)); }}
            disabled={!canGoForward}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel="Next month"
          >
            <Ionicons name="chevron-forward" size={iconSize.md} color={canGoForward ? colors.accent : colors.textTertiary} />
          </TouchableOpacity>
        </View>
        <View style={styles.grid}>
          <View style={styles.weekRow}>
            {headers.map((h, i) => <Text key={i} style={styles.weekday}>{h}</Text>)}
          </View>
          {Array.from({ length: grid.length / 7 }, (_, row) => (
            <View key={row} style={styles.weekRow}>
              {grid.slice(row * 7, row * 7 + 7).map(day => {
                const key = format(day, 'yyyy-MM-dd');
                const inMonth = isSameMonth(day, month);
                const has = inMonth && written.has(key);
                return (
                  <TouchableOpacity
                    key={key}
                    style={styles.cellWrap}
                    disabled={!has}
                    activeOpacity={interaction.activeOpacity}
                    onPress={() => { haptics.tap(); onPickDay(key); }}
                    accessibilityRole={has ? 'button' : undefined}
                    accessibilityLabel={has ? `${format(day, 'EEEE, MMMM d')}, has an entry` : format(day, 'EEEE, MMMM d')}
                  >
                    <View style={[styles.cell, has && styles.cellWritten, key === todayKey && styles.cellToday]}>
                      <Text style={[styles.dayText, !inMonth && styles.dayOutside, has && styles.dayWritten]}>
                        {format(day, 'd')}
                      </Text>
                    </View>
                  </TouchableOpacity>
                );
              })}
            </View>
          ))}
        </View>
        <Text style={styles.legend}>Days with something written are filled in. Tap one to read it.</Text>
      </View>
    </SheetModal>
  );
}

const makeStyles = (colors: Colors) => StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  headerSpacer: { minWidth: 56 },
  monthRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  monthTitle: { color: colors.text, fontSize: font.lg, fontWeight: fontWeight.semibold },
  grid: { paddingHorizontal: spacing.md },
  weekRow: { flexDirection: 'row' },
  weekday: {
    flex: 1,
    textAlign: 'center',
    color: colors.textSecondary,
    fontSize: font.xs,
    fontWeight: fontWeight.semibold,
    paddingBottom: spacing.sm,
  },
  cellWrap: { flex: 1, alignItems: 'center', paddingVertical: spacing.xxs },
  cell: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    borderColor: 'transparent',
  },
  cellWritten: { backgroundColor: colors.accentFill },
  cellToday: { borderColor: colors.accent },
  dayText: { color: colors.text, fontSize: font.md },
  dayOutside: { color: colors.textTertiary },
  dayWritten: { color: colors.onAccent, fontWeight: fontWeight.semibold },
  legend: {
    color: colors.textSecondary,
    fontSize: font.sm,
    textAlign: 'center',
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
  },
});
