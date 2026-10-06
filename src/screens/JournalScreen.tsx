import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, FlatList, StyleSheet, TouchableOpacity } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useBottomTabBarHeight } from '@react-navigation/bottom-tabs';
import { useRoute } from '@react-navigation/native';
import { format } from 'date-fns/format';
import type { JournalEntry, JournalKind } from '../types';
import { useJournalStore } from '../store/useJournalStore';
import { useColors } from '../theme/ThemeContext';
import { spacing, radius, font, fontWeight, interaction, type Colors } from '../theme';
import { haptics } from '../utils/haptics';
import { dayKeyOf, getCurrentDayStart } from '../utils/dateUtils';
import {
  JOURNAL_KIND_COPY,
  entriesOfKind,
  groupJournalByDay,
  journalStats,
  searchJournal,
  type JournalDay,
} from '../utils/journal';
import { navigateToTab } from '../navigation/navigationRef';
import { useFilterField } from '../hooks/useFilterField';
import { useKeyboardInsetScroll } from '../hooks/useKeyboardInsetScroll';
import { ScreenHeader } from '../components/ScreenHeader';
import { HubPills } from '../components/HubPills';
import { EmptyState } from '../components/EmptyState';
import { SearchField } from '../components/SearchField';
import { JournalEntrySheet } from '../components/JournalEntrySheet';

/**
 * The journal, or the dream log: one screen over `useJournalStore`, split by
 * `kind` — see `docs/arch/journal.md`.
 *
 * Read as a diary: days newest first, each day's entries in the order they
 * were written, the words at body size. Counts only, and nothing derived from
 * what was written.
 */
function JournalLogScreen({ kind }: { kind: JournalKind }) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const insets = useSafeAreaInsets();
  const tabBarHeight = useBottomTabBarHeight();
  const copy = JOURNAL_KIND_COPY[kind];
  const route = kind === 'dream' ? 'Dreams' : 'Journal';

  const all = useJournalStore(s => s.entries);
  const entries = useMemo(() => entriesOfKind(all, kind), [all, kind]);
  const search = useFilterField();
  const days = useMemo(
    () => groupJournalByDay(searchJournal(entries, search.query)),
    [entries, search.query],
  );
  const todayKey = dayKeyOf(getCurrentDayStart());
  const stats = useMemo(() => journalStats(entries, todayKey.slice(0, 7)), [entries, todayKey]);
  const keyboardScroll = useKeyboardInsetScroll<FlatList<JournalDay>>();

  const [sheetOpen, setSheetOpen] = useState(false);
  const [editing, setEditing] = useState<JournalEntry | null>(null);

  // `dundundun://journal?log=1` / `dreams?log=1`, the reminder task's link.
  // Stamped and tracked against what was handled, as MoodScreen's openLog is,
  // with the same `returnTo` hand-back once the sheet closes.
  const routeInfo = useRoute<{ key: string; name: string; params?: { openLog?: number; returnTo?: string } }>();
  const [handledOpenLog, setHandledOpenLog] = useState<number | undefined>(undefined);
  const [returnTo, setReturnTo] = useState<string | undefined>(undefined);
  useEffect(() => {
    if (routeInfo.params?.openLog === undefined || routeInfo.params.openLog === handledOpenLog) return;
    setHandledOpenLog(routeInfo.params.openLog);
    setReturnTo(routeInfo.params.returnTo);
    setEditing(null);
    setSheetOpen(true);
  }, [routeInfo.params?.openLog, routeInfo.params?.returnTo, handledOpenLog]);

  const openNew = () => { haptics.tap(); setReturnTo(undefined); setEditing(null); setSheetOpen(true); };
  const openEdit = (entry: JournalEntry) => { haptics.tap(); setReturnTo(undefined); setEditing(entry); setSheetOpen(true); };
  const closeSheet = () => {
    setSheetOpen(false);
    setEditing(null);
    if (returnTo) {
      navigateToTab(returnTo);
      setReturnTo(undefined);
    }
  };

  const subtitle = stats.dayCount === 0 ? undefined
    : `${stats.dayCount} ${stats.dayCount === 1 ? 'day' : 'days'} · ${stats.dayCountInMonth} this month`;

  const header = (
    <>
      <ScreenHeader
        title={copy.title}
        subtitle={subtitle}
        actions={[{
          icon: 'add-circle-outline' as const,
          onPress: openNew,
          accessibilityLabel: kind === 'dream' ? 'Write down a dream' : 'Write in your journal',
        }]}
      />
      <HubPills hub="health" active={route} />
    </>
  );

  const sheet = (
    <JournalEntrySheet visible={sheetOpen} kind={kind} editing={editing} onClose={closeSheet} />
  );

  if (entries.length === 0) {
    return (
      <View style={[styles.container, { paddingTop: insets.top }]}>
        {header}
        <EmptyState
          icon={kind === 'dream' ? 'cloudy-night-outline' : 'book-outline'}
          title={copy.emptyTitle}
          subtitle={copy.emptySubtitle}
          actionLabel={kind === 'dream' ? 'Write down a dream' : 'Write an entry'}
          onAction={openNew}
          bottomOffset={tabBarHeight}
        />
        {sheet}
      </View>
    );
  }

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      {header}
      <SearchField
        field={search}
        placeholder={kind === 'dream' ? 'Search your dreams' : 'Search your journal'}
        accessibilityLabel={kind === 'dream' ? 'Search your dreams' : 'Search your journal'}
        style={styles.search}
      />
      <FlatList
        ref={keyboardScroll.ref}
        {...keyboardScroll.props}
        style={styles.list}
        data={days}
        keyExtractor={day => day.dayKey}
        contentContainerStyle={[styles.listContent, { paddingBottom: tabBarHeight + spacing.xl }]}
        keyboardShouldPersistTaps="handled"
        ListEmptyComponent={<Text style={styles.noMatch}>Nothing matches that search.</Text>}
        renderItem={({ item: day }) => (
          <View>
            <Text style={styles.dayLabel}>
              {format(new Date(`${day.dayKey}T00:00:00`), 'EEEE, MMMM d, yyyy').toUpperCase()}
            </Text>
            <View style={styles.card}>
              {day.entries.map((entry, index) => (
                <TouchableOpacity
                  key={entry.id}
                  style={[styles.entryRow, index === 0 && styles.firstRow]}
                  activeOpacity={interaction.activeOpacity}
                  onPress={() => openEdit(entry)}
                  accessibilityRole="button"
                  accessibilityLabel={`Edit ${copy.one} from ${format(new Date(entry.loggedAt), 'h:mm a')}: ${entry.text}`}
                >
                  <Text style={styles.entryTime}>{format(new Date(entry.loggedAt), 'h:mm a')}</Text>
                  <Text style={styles.entryText}>{entry.text}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
        )}
      />
      {sheet}
    </View>
  );
}

export function JournalScreen() {
  return <JournalLogScreen kind="journal" />;
}

export function DreamsScreen() {
  return <JournalLogScreen kind="dream" />;
}

const makeStyles = (colors: Colors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  search: { marginHorizontal: spacing.md, marginBottom: spacing.sm },
  list: { flex: 1 },
  listContent: { paddingHorizontal: spacing.md },
  dayLabel: {
    fontSize: font.xs,
    fontWeight: fontWeight.semibold,
    color: colors.textSecondary,
    letterSpacing: 0.8,
    marginTop: spacing.md,
    marginBottom: spacing.sm,
  },
  card: {
    backgroundColor: colors.bgSecondary,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
  },
  firstRow: { borderTopWidth: 0 },
  entryRow: {
    paddingVertical: spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.separator,
  },
  entryTime: {
    fontSize: font.xs,
    color: colors.textSecondary,
    marginBottom: spacing.xs,
  },
  entryText: {
    fontSize: font.md,
    color: colors.text,
  },
  noMatch: {
    fontSize: font.sm,
    color: colors.textSecondary,
    textAlign: 'center',
    marginTop: spacing.lg,
  },
});
