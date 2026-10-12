import React, { useMemo, useState } from 'react';
import { View, Text, SectionList, TouchableOpacity, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { format } from 'date-fns/format';
import type { MoodLevel, MoodLog } from '../types';
import { useMoodStore } from '../store/useMoodStore';
import { useColors } from '../theme/ThemeContext';
import { spacing, radius, font, fontWeight, iconSize, interaction, type Colors } from '../theme';
import { haptics } from '../utils/haptics';
import { useFilterField } from '../hooks/useFilterField';
import { dayKeyToDate } from '../utils/dateUtils';
import {
  MOOD_LEVELS, contextTagKey, contextTagVocabulary, moodLabel, symptomKey, symptomVocabulary,
} from '../utils/moodLog';
import {
  EMPTY_MOOD_FILTER, filterMoodLogs, groupLogsByDay, isMoodFilterActive, searchMoodLogs, toggleFilterValue,
  type MoodFilter,
} from '../utils/moodHistory';
import { DetailHeader } from '../components/DetailHeader';
import { EmptyState } from '../components/EmptyState';
import { MoodEntryRow } from '../components/MoodEntryRow';
import { MoodLogSheet } from '../components/MoodLogSheet';
import { SearchField } from '../components/SearchField';
import { ChipFilterSheet, type ChipFilterGroup } from '../components/ChipFilterSheet';
import { useListScrollToTop } from '../hooks/useListScrollToTop';
import { ScrollToTopButton } from '../components/ScrollToTopButton';

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
  const scrollTop = useListScrollToTop();
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const logs = useMoodStore(s => s.logs);

  const [filter, setFilter] = useState<MoodFilter>(EMPTY_MOOD_FILTER);
  // Words in the notes. Its own field rather than a chip: it is open text, not a
  // set to pick from, and it ANDs with the filter the same way the filter's
  // dimensions AND with each other.
  const search = useFilterField();
  const searching = search.query.trim().length > 0;
  const narrowed = isMoodFilterActive(filter) || searching;
  const clearAll = () => { setFilter(EMPTY_MOOD_FILTER); search.clear(); };
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
    () => groupLogsByDay(searchMoodLogs(filterMoodLogs(logs, filter), search.query)).map(day => ({
      key: day.dayKey,
      title: format(dayKeyToDate(day.dayKey), 'EEEE, MMMM d, yyyy'),
      data: day.logs,
    })),
    [logs, filter, search.query],
  );

  const matchCount = useMemo(
    () => sections.reduce((n, s) => n + s.data.length, 0),
    [sections],
  );

  const groups: ChipFilterGroup[] = [
    {
      label: 'Writing',
      options: [
        { key: 'note', label: 'Has a note' },
      ],
      selected: filter.withNote ? ['note'] : [],
      onToggle: () => setFilter(f => ({ ...f, withNote: !f.withNote })),
    },
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
    ...(filter.withNote ? [{
      key: 'with-note',
      label: 'Has a note',
      remove: () => setFilter(f => ({ ...f, withNote: false })),
    }] : []),
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

      <SearchField
        field={search}
        placeholder="Search your notes"
        accessibilityLabel="Search your notes"
        style={styles.search}
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
          icon={narrowed ? 'filter-outline' : 'happy-outline'}
          title={narrowed ? 'Nothing matches' : 'Nothing logged yet'}
          subtitle={narrowed
            ? 'No entries match your search or filter. Change them to see more.'
            : 'Entries you record show up here, newest first.'}
          actionLabel={narrowed ? 'Clear the search and filter' : undefined}
          onAction={narrowed ? clearAll : undefined}
        />
      ) : (
        <SectionList
          ref={scrollTop.ref}
          {...scrollTop.listProps}
          sections={sections}
          keyExtractor={log => log.id}
          contentContainerStyle={[styles.listContent, { paddingBottom: insets.bottom + spacing.xl }]}
          stickySectionHeadersEnabled={false}
          renderSectionHeader={({ section }) => (
            // The day opens as a page: its entries read in order, and a way to
            // page to the next written day.
            <TouchableOpacity
              style={styles.dayHeaderRow}
              activeOpacity={interaction.activeOpacity}
              onPress={() => { haptics.tap(); navigation.navigate('MoodDay', { dayKey: section.key }); }}
              accessibilityRole="button"
              accessibilityLabel={`Read ${section.title} as a page`}
            >
              <Text style={styles.dayHeader}>{section.title}</Text>
              <Ionicons name="chevron-forward" size={14} color={colors.textSecondary} />
            </TouchableOpacity>
          )}
          renderItem={({ item }) => (
            <MoodEntryRow
              log={item}
              showDate={false}
              onPress={() => { haptics.tap(); setEditing(item); setSheetOpen(true); }}
            />
          )}
        />
      )}

      <ChipFilterSheet
        visible={filterOpen}
        onClose={() => setFilterOpen(false)}
        groups={groups}
        onClearAll={clearAll}
      />

      <MoodLogSheet
        visible={sheetOpen}
        editing={editing}
        onClose={() => { setSheetOpen(false); setEditing(null); }}
      />
      <ScrollToTopButton {...scrollTop.buttonProps} />
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
  },
  dayHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: spacing.md,
    marginBottom: spacing.sm,
  },
  search: { marginHorizontal: spacing.md, marginBottom: spacing.sm },
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
