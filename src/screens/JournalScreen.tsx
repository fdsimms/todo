import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, FlatList, StyleSheet, TouchableOpacity, Alert } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useBottomTabBarHeight } from '@react-navigation/bottom-tabs';
import { useRoute } from '@react-navigation/native';
import { format } from 'date-fns/format';
import type { JournalEntry, JournalKind } from '../types';
import { useJournalStore } from '../store/useJournalStore';
import { useColors } from '../theme/ThemeContext';
import { spacing, radius, font, fontWeight, iconSize, interaction, type Colors } from '../theme';
import Ionicons from '@expo/vector-icons/Ionicons';
import { haptics } from '../utils/haptics';
import { dayKeyOf, getCurrentDayStart } from '../utils/dateUtils';
import {
  JOURNAL_KIND_COPY,
  entriesOfKind,
  groupJournalByDay,
  journalStats,
  justOpened,
  openEntries,
  searchJournal,
  sealedEntries,
  type JournalDay,
} from '../utils/journal';
import { dropSealedNoteReminder } from '../utils/sealedNoteTasks';
import { journalExportCsv, journalExportFileName, journalExportSummary } from '../utils/journalExport';
import { writeExportFile, shareCsvFile, discardBackupFile, canShare } from '../utils/backupFile';
import { navigateToTab } from '../navigation/navigationRef';
import { useFilterField } from '../hooks/useFilterField';
import { useKeyboardInsetScroll } from '../hooks/useKeyboardInsetScroll';
import { ScreenHeader } from '../components/ScreenHeader';
import { HubPills } from '../components/HubPills';
import { ScreenSettingsSheet } from '../components/ScreenSettingsSheet';
import { useScreenSettings, withScreenSettings } from '../hooks/useScreenSettings';
import { usePullToSearch } from '../hooks/usePullToSearch';
import { EmptyState } from '../components/EmptyState';
import { SearchField } from '../components/SearchField';
import { JournalEntrySheet } from '../components/JournalEntrySheet';
import { JournalText } from '../components/JournalText';
import { journalPlainText } from '../utils/journalMarkdown';
import { useListScrollToTop } from '../hooks/useListScrollToTop';
import { ScrollToTopButton } from '../components/ScrollToTopButton';

/**
 * The journal, or the dream log: one screen over `useJournalStore`, split by
 * `kind` — see `docs/arch/journal.md`.
 *
 * Read as a diary: days newest first, each day one page, its entries (the
 * snippets the part-of-day reminders ask for) in the order they were written
 * with only their time between them, the words at body size. Counts only, and nothing derived from
 * what was written.
 */
function JournalLogScreen({ kind }: { kind: JournalKind }) {
  const pullSearch = usePullToSearch();
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const insets = useSafeAreaInsets();
  const tabBarHeight = useBottomTabBarHeight();
  const copy = JOURNAL_KIND_COPY[kind];
  const route = kind === 'dream' ? 'Dreams' : 'Journal';
  const screenSettings = useScreenSettings(route, kind === 'dream' ? 'Dream settings' : 'Journal settings');

  const all = useJournalStore(s => s.entries);
  const openNow = useJournalStore(s => s.openNow);
  const todayKey = dayKeyOf(getCurrentDayStart());
  const written = useMemo(() => entriesOfKind(all, kind), [all, kind]);
  // A sealed note to your future self is read nowhere before its day, the
  // list, search, the counts and the export included (openEntries). It shows
  // only as the count above the list.
  const entries = useMemo(() => openEntries(written, todayKey), [written, todayKey]);
  const sealed = useMemo(() => sealedEntries(written, todayKey), [written, todayKey]);
  const opened = useMemo(() => justOpened(entries, todayKey), [entries, todayKey]);
  const search = useFilterField();
  const days = useMemo(
    () => groupJournalByDay(searchJournal(entries, search.query)),
    [entries, search.query],
  );
  const stats = useMemo(() => journalStats(entries, todayKey.slice(0, 7)), [entries, todayKey]);
  const keyboardScroll = useKeyboardInsetScroll<FlatList<JournalDay>>({ refreshing: pullSearch.pulling });
  const scrollTop = useListScrollToTop(keyboardScroll);

  const [sheetOpen, setSheetOpen] = useState(false);
  const [editing, setEditing] = useState<JournalEntry | null>(null);

  // `dundundun://journal?log=1` / `dreams?log=1`, the reminder task's link.
  // Stamped and tracked against what was handled, as MoodScreen's openLog is,
  // with the same `returnTo` hand-back once the sheet closes.
  const routeInfo = useRoute<{ key: string; name: string; params?: { openLog?: number; openEntry?: string; returnTo?: string } }>();
  const [handledOpenLog, setHandledOpenLog] = useState<number | undefined>(undefined);
  const [returnTo, setReturnTo] = useState<string | undefined>(undefined);
  useEffect(() => {
    if (routeInfo.params?.openLog === undefined || routeInfo.params.openLog === handledOpenLog) return;
    setHandledOpenLog(routeInfo.params.openLog);
    setReturnTo(routeInfo.params.returnTo);
    // `entry=<id>`, a sealed note's reminder: that note, once it's open.
    // One still sealed (the task tapped from Later) or since deleted opens
    // nothing, rather than a blank page in its place.
    const wanted = routeInfo.params.openEntry;
    if (wanted) {
      const entry = entries.find(e => e.id === wanted);
      if (!entry) return;
      setEditing(entry);
      setSheetOpen(true);
      return;
    }
    setEditing(null);
    setSheetOpen(true);
    // `entries` is read when the link lands, not tracked: a later edit must not reopen it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routeInfo.params?.openLog, routeInfo.params?.returnTo, handledOpenLog]);

  /** Offers to open the soonest sealed note now rather than on its day. */
  const openSealedEarly = () => {
    const next = sealed[0];
    if (!next) return;
    haptics.tap();
    Alert.alert(
      'Open a note early?',
      `The next one was written on ${format(new Date(`${next.dayKey}T00:00:00`), 'MMMM d, yyyy')} to open on ${format(new Date(`${next.openOn}T00:00:00`), 'MMMM d, yyyy')}.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Open it now',
          onPress: () => {
            openNow(next.id);
            dropSealedNoteReminder(next.id);
            setReturnTo(undefined);
            setEditing({ ...next, openOn: null });
            setSheetOpen(true);
          },
        },
      ],
    );
  };

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

  const [sharing, setSharing] = useState(false);
  const shareTitle = kind === 'dream' ? 'Share your dreams' : 'Share your journal';

  /**
   * Hand this kind's entries to the share sheet as CSV, the medication
   * screen's flow: the summary is confirmed before anything is written, and
   * the file is deleted the moment the share sheet closes.
   */
  const share = async () => {
    if (entries.length === 0 || sharing) return;
    haptics.tap();
    const confirmed = await new Promise<boolean>(resolve => {
      Alert.alert(shareTitle, journalExportSummary(entries, kind), [
        { text: 'Cancel', style: 'cancel', onPress: () => resolve(false) },
        { text: 'Share', onPress: () => resolve(true) },
      ]);
    });
    if (!confirmed) return;

    setSharing(true);
    let uri: string | null = null;
    try {
      if (!(await canShare())) {
        Alert.alert('Sharing unavailable', 'This device cannot open a share sheet.');
        return;
      }
      uri = writeExportFile(journalExportCsv(entries, kind), journalExportFileName(kind, new Date()));
      await shareCsvFile(uri, shareTitle);
    } catch {
      Alert.alert('Export failed', 'Couldn’t write the file. Try again.');
    } finally {
      if (uri) discardBackupFile(uri);
      setSharing(false);
    }
  };

  const subtitle = stats.dayCount === 0 ? undefined
    : `${stats.dayCount} ${stats.dayCount === 1 ? 'day' : 'days'} · ${stats.dayCountInMonth} this month`;

  const header = (
    <>
      <ScreenHeader
        title={copy.title}
        subtitle={subtitle}
        actions={withScreenSettings([
          // Only once there is something to share, as on the medication screen.
          ...(entries.length > 0 ? [{
            icon: 'share-outline' as const,
            onPress: share,
            loading: sharing,
            accessibilityLabel: shareTitle,
          }] : []),
          {
            icon: 'add-circle-outline' as const,
            onPress: openNew,
            accessibilityLabel: kind === 'dream' ? 'Write down a dream' : 'Write in your journal',
          },
        ], screenSettings.action)}
      />
      <ScreenSettingsSheet {...screenSettings.sheet} />
      <HubPills hub="health" active={route} />
    </>
  );

  const sheet = (
    <JournalEntrySheet visible={sheetOpen} kind={kind} editing={editing} onClose={closeSheet} />
  );

  // A note for later and nothing else is still something written, so the
  // list (with its sealed card) shows rather than the empty state.
  if (entries.length === 0 && sealed.length === 0) {
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
        ref={scrollTop.ref}
        refreshControl={pullSearch.refreshControl}
        {...keyboardScroll.props}
        {...scrollTop.listProps}
        style={styles.list}
        data={days}
        keyExtractor={day => day.dayKey}
        contentContainerStyle={[styles.listContent, { paddingBottom: tabBarHeight + spacing.xl }]}
        keyboardShouldPersistTaps="handled"
        ListHeaderComponent={search.query ? null : (
          <>
            {sealed.length > 0 && (
              <TouchableOpacity
                style={[styles.card, styles.sealedCard]}
                activeOpacity={interaction.activeOpacity}
                onPress={openSealedEarly}
                accessibilityRole="button"
                accessibilityLabel={`${sealedLabel(sealed.length)}. The next opens ${format(new Date(`${sealed[0].openOn}T00:00:00`), 'EEEE, MMMM d, yyyy')}`}
                accessibilityHint="Offers to open the next one early"
              >
                <Ionicons name="lock-closed-outline" size={iconSize.md} color={colors.textSecondary} />
                <View style={styles.sealedText}>
                  <Text style={styles.sealedTitle}>{sealedLabel(sealed.length)}</Text>
                  <Text style={styles.sealedSub}>
                    {`The next opens ${format(new Date(`${sealed[0].openOn}T00:00:00`), 'EEEE, MMMM d, yyyy')}.`}
                  </Text>
                </View>
              </TouchableOpacity>
            )}
            {opened.length > 0 && (
              <View>
                <Text style={styles.dayLabel}>JUST OPENED</Text>
                <View style={styles.card}>
                  {opened.map((entry, index) => (
                    <TouchableOpacity
                      key={entry.id}
                      style={[styles.entryRow, index === 0 && styles.firstRow]}
                      activeOpacity={interaction.activeOpacity}
                      onPress={() => openEdit(entry)}
                      accessibilityRole="button"
                      accessibilityLabel={`Note written on ${format(new Date(`${entry.dayKey}T00:00:00`), 'MMMM d, yyyy')}: ${journalPlainText(entry.text)}`}
                    >
                      <Text style={styles.entryTime}>
                        {`Written ${format(new Date(`${entry.dayKey}T00:00:00`), 'MMMM d, yyyy')}`}
                      </Text>
                      <JournalText text={entry.text} textStyle={styles.entryText} />
                    </TouchableOpacity>
                  ))}
                </View>
              </View>
            )}
          </>
        )}
        ListEmptyComponent={
          search.query || entries.length > 0
            ? <Text style={styles.noMatch}>Nothing matches that search.</Text>
            : null
        }
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
                  accessibilityLabel={`Edit ${copy.one} from ${format(new Date(entry.loggedAt), 'h:mm a')}: ${journalPlainText(entry.text)}`}
                >
                  <Text style={styles.entryTime}>{format(new Date(entry.loggedAt), 'h:mm a')}</Text>
                  <JournalText text={entry.text} textStyle={styles.entryText} />
                </TouchableOpacity>
              ))}
            </View>
          </View>
        )}
      />
      {sheet}
      <ScrollToTopButton {...scrollTop.buttonProps} />
      {pullSearch.sheet}
    </View>
  );
}

function sealedLabel(count: number): string {
  return count === 1 ? '1 note for later' : `${count} notes for later`;
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
  // One page per day: no rule between snippets, just their times, so a day
  // written in three sittings reads as one entry.
  card: {
    backgroundColor: colors.bgSecondary,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.md,
  },
  firstRow: { paddingTop: spacing.md },
  entryRow: {
    paddingTop: spacing.smd,
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
  sealedCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.smd,
    paddingTop: spacing.md,
    marginTop: spacing.sm,
  },
  sealedText: { flex: 1, gap: spacing.xxs },
  sealedTitle: { fontSize: font.md, fontWeight: fontWeight.medium, color: colors.text },
  sealedSub: { fontSize: font.sm, color: colors.textSecondary },
  noMatch: {
    fontSize: font.sm,
    color: colors.textSecondary,
    textAlign: 'center',
    marginTop: spacing.lg,
  },
});
