import React, { useMemo, useState } from 'react';
import { View, Text, SectionList, TouchableOpacity, Alert, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { format } from 'date-fns/format';
import type { MoodLevel, MoodLog } from '../types';
import { useMoodStore } from '../store/useMoodStore';
import { useColors } from '../theme/ThemeContext';
import { spacing, radius, font, fontWeight, iconSize, interaction, type Colors } from '../theme';
import { haptics } from '../utils/haptics';
import { dayKeyToDate } from '../utils/dateUtils';
import {
  MOOD_LEVELS, contextTagKey, contextTagVocabulary, moodLabel, symptomKey, symptomVocabulary,
} from '../utils/moodLog';
import {
  EMPTY_MOOD_FILTER, filterMoodLogs, groupLogsByDay, isMoodFilterActive, toggleFilterValue,
  type MoodFilter,
} from '../utils/moodHistory';
import { DetailHeader } from '../components/DetailHeader';
import { EmptyState } from '../components/EmptyState';
import { MoodEntryRow } from '../components/MoodEntryRow';
import { MoodLogSheet } from '../components/MoodLogSheet';
import { ChipFilterSheet, type ChipFilterGroup } from '../components/ChipFilterSheet';

/**
 * Every mood entry there is, grouped by day and narrowable.
 *
 * The Mood screen shows the newest twenty and used to show *only* those, which
 * made an entry unreachable — unviewable, uneditable and undeletable — as soon
 * as twenty newer ones existed. For anybody logging morning and evening that is
 * ten days, in a feature whose whole value is the months behind it. A log you
 * cannot read back is not a log.
 *
 * A `SectionList` rather than the Mood screen's `ScrollView`: this is the one
 * mood surface with no ceiling on its length, so the rows have to virtualize.
 *
 * The filter is CLAUDE.md's rule for an open-ended set — a sheet of wrapping
 * chips, with the current picks as removable pills on the screen itself. The
 * symptom vocabulary has no ceiling by construction (it is whatever the user
 * has ever typed), so a horizontal row of chips would hide most of it behind a
 * swipe nobody is prompted to make.
 */
export function MoodHistoryScreen() {
  const navigation = useNavigation<{ navigate: (screen: string, params?: object) => void; goBack: () => void }>();
  const insets = useSafeAreaInsets();
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const logs = useMoodStore(s => s.logs);
  const removeLog = useMoodStore(s => s.removeLog);

  const [filter, setFilter] = useState<MoodFilter>(EMPTY_MOOD_FILTER);
  const [filterOpen, setFilterOpen] = useState(false);
  const [editing, setEditing] = useState<MoodLog | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);

  // Match key -> the casing the user actually typed, so a chip and a pill read
  // the way their entries do. Same resolution the Mood screen's contrast rows
  // make, and for the same reason: a key is lowercased for matching and is not
  // what anybody wrote.
  const symptomNames = useMemo(() => {
    const names = new Map<string, string>();
    for (const name of symptomVocabulary(logs)) names.set(symptomKey(name), name);
    return names;
  }, [logs]);
  const contextTagNames = useMemo(() => {
    const names = new Map<string, string>();
    for (const name of contextTagVocabulary(logs)) names.set(contextTagKey(name), name);
    return names;
  }, [logs]);

  const sections = useMemo(
    () => groupLogsByDay(filterMoodLogs(logs, filter)).map(day => ({
      key: day.dayKey,
      title: format(dayKeyToDate(day.dayKey), 'EEEE, MMMM d, yyyy'),
      data: day.logs,
    })),
    [logs, filter],
  );

  const matchCount = useMemo(
    () => sections.reduce((n, s) => n + s.data.length, 0),
    [sections],
  );

  const confirmDelete = (log: MoodLog) => {
    Alert.alert(
      'Delete this entry?',
      'It will be removed from your history and from every number on the Mood screen.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => { haptics.warning(); removeLog(log.id); },
        },
      ],
    );
  };

  const groups: ChipFilterGroup[] = [
    {
      label: 'Mood',
      options: MOOD_LEVELS.map(level => ({
        key: String(level.value),
        label: `${level.emoji} ${level.label}`,
      })),
      selected: filter.moods.map(String),
      onToggle: key => setFilter(f => ({
        ...f,
        moods: toggleFilterValue(f.moods, Number(key) as MoodLevel),
      })),
    },
    {
      label: 'Symptom',
      options: [...symptomNames].map(([key, name]) => ({ key, label: name })),
      selected: filter.symptomKeys,
      onToggle: key => setFilter(f => ({ ...f, symptomKeys: toggleFilterValue(f.symptomKeys, key) })),
    },
    {
      label: 'Context',
      options: [...contextTagNames].map(([key, name]) => ({ key, label: name })),
      selected: filter.contextTagKeys,
      onToggle: key => setFilter(f => ({
        ...f,
        contextTagKeys: toggleFilterValue(f.contextTagKeys, key),
      })),
    },
  ];

  // The picks, as removable pills. This set is small by construction — it is
  // what you just chose — so a wrapping row on the screen is the right shape
  // for it even though the sheet it came from could not be.
  const activePills = [
    ...filter.moods.map(mood => ({
      key: `mood-${mood}`,
      label: moodLabel(mood),
      remove: () => setFilter(f => ({ ...f, moods: f.moods.filter(m => m !== mood) })),
    })),
    ...filter.symptomKeys.map(key => ({
      key: `symptom-${key}`,
      label: symptomNames.get(key) ?? key,
      remove: () => setFilter(f => ({ ...f, symptomKeys: f.symptomKeys.filter(k => k !== key) })),
    })),
    ...filter.contextTagKeys.map(key => ({
      key: `context-${key}`,
      label: contextTagNames.get(key) ?? key,
      remove: () => setFilter(f => ({
        ...f,
        contextTagKeys: f.contextTagKeys.filter(k => k !== key),
      })),
    })),
  ];

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <DetailHeader
        title="Mood history"
        onBack={() => navigation.goBack()}
        actions={
          <TouchableOpacity
            onPress={() => { haptics.tap(); setFilterOpen(true); }}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel="Filter entries"
          >
            <Ionicons
              name={isMoodFilterActive(filter) ? 'filter' : 'filter-outline'}
              size={iconSize.md}
              color={isMoodFilterActive(filter) ? colors.accent : colors.textSecondary}
            />
          </TouchableOpacity>
        }
      />

      {activePills.length > 0 && (
        <View style={styles.pillRow}>
          {activePills.map(pill => (
            <TouchableOpacity
              key={pill.key}
              style={styles.pill}
              onPress={() => { haptics.tap(); pill.remove(); }}
              activeOpacity={interaction.activeOpacity}
              accessibilityRole="button"
              accessibilityLabel={`Remove the ${pill.label} filter`}
            >
              <Text style={styles.pillText}>{pill.label}</Text>
              <Ionicons name="close" size={12} color={colors.onAccent} />
            </TouchableOpacity>
          ))}
        </View>
      )}

      {matchCount === 0 ? (
        <EmptyState
          icon={isMoodFilterActive(filter) ? 'filter-outline' : 'happy-outline'}
          title={isMoodFilterActive(filter) ? 'Nothing matches' : 'Nothing logged yet'}
          subtitle={isMoodFilterActive(filter)
            ? 'No entries match what you picked. Change the filter to see more.'
            : 'Entries you record show up here, newest first.'}
          actionLabel={isMoodFilterActive(filter) ? 'Clear the filter' : undefined}
          onAction={isMoodFilterActive(filter) ? () => setFilter(EMPTY_MOOD_FILTER) : undefined}
        />
      ) : (
        <SectionList
          sections={sections}
          keyExtractor={log => log.id}
          contentContainerStyle={[styles.listContent, { paddingBottom: insets.bottom + spacing.xl }]}
          stickySectionHeadersEnabled={false}
          renderSectionHeader={({ section }) => (
            <Text style={styles.dayHeader}>{section.title}</Text>
          )}
          renderItem={({ item }) => (
            <MoodEntryRow
              log={item}
              showDate={false}
              onPress={() => { haptics.tap(); setEditing(item); setSheetOpen(true); }}
              onLongPress={() => confirmDelete(item)}
            />
          )}
        />
      )}

      <ChipFilterSheet
        visible={filterOpen}
        onClose={() => setFilterOpen(false)}
        groups={groups}
        onClearAll={() => setFilter(EMPTY_MOOD_FILTER)}
      />

      <MoodLogSheet
        visible={sheetOpen}
        editing={editing}
        onClose={() => { setSheetOpen(false); setEditing(null); }}
      />
    </View>
  );
}

const makeStyles = (colors: Colors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  listContent: { paddingHorizontal: spacing.md },
  dayHeader: {
    fontSize: font.xs,
    fontWeight: fontWeight.semibold,
    color: colors.textSecondary,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    marginTop: spacing.md,
    marginBottom: spacing.sm,
  },
  pillRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.sm,
  },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: spacing.sm,
    paddingVertical: 5,
    borderRadius: radius.full,
    backgroundColor: colors.accent,
  },
  pillText: { color: colors.onAccent, fontSize: font.xs, fontWeight: fontWeight.semibold },
});
