import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, FlatList, StyleSheet, TouchableOpacity, Alert } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useBottomTabBarHeight } from '@react-navigation/bottom-tabs';
import { useRoute } from '@react-navigation/native';
import { format } from 'date-fns/format';
import type { JournalEntry, JournalKind } from '../types';
import { useJournalStore } from '../store/useJournalStore';
import { useSettingsStore } from '../store/useSettingsStore';
import { usePersonStore, displayNameOf } from '../store/usePersonStore';
import { useColors } from '../theme/ThemeContext';
import { spacing, radius, font, fontWeight, iconSize, interaction, type Colors } from '../theme';
import Ionicons from '@expo/vector-icons/Ionicons';
import { haptics } from '../utils/haptics';
import { dayKeyOf, getCurrentDayStart } from '../utils/dateUtils';
import {
  JOURNAL_KIND_COPY,
  countWords,
  daysReachingWordGoal,
  entriesOfKind,
  entriesWithTag,
  groupJournalByDay,
  journalSnippet,
  journalStats,
  justOpened,
  onThisDay,
  randomJournalDay,
  formatWordCount,
  openEntries,
  searchJournal,
  sealedEntries,
  type JournalDay,
} from '../utils/journal';
import { dropSealedNoteReminder } from '../utils/sealedNoteTasks';
import {
  journalExportCsv,
  journalExportFileName,
  journalExportMarkdown,
  journalExportSummary,
  type JournalExportFormat,
} from '../utils/journalExport';
import { writeExportFile, shareCsvFile, shareMarkdownFile, discardBackupFile, canShare } from '../utils/backupFile';
import { navigateToTab } from '../navigation/navigationRef';
import { useFilterField } from '../hooks/useFilterField';
import { useKeyboardInsetScroll } from '../hooks/useKeyboardInsetScroll';
import { useJournalAccess } from '../hooks/useJournalAccess';
import { ScreenHeader } from '../components/ScreenHeader';
import { HubPills } from '../components/HubPills';
import { ScreenSettingsSheet } from '../components/ScreenSettingsSheet';
import { useScreenSettings, withScreenSettings } from '../hooks/useScreenSettings';
import { usePullToSearch } from '../hooks/usePullToSearch';
import { EmptyState } from '../components/EmptyState';
import { SearchField } from '../components/SearchField';
import { JournalEntrySheet } from '../components/JournalEntrySheet';
import { JournalText } from '../components/JournalText';
import { JournalWordGoalSheet } from '../components/JournalWordGoalSheet';
import { JournalDaySheet } from '../components/JournalDaySheet';
import { JournalMonthSheet } from '../components/JournalMonthSheet';
import { journalPlainText } from '../utils/journalMarkdown';
import { useListScrollToTop } from '../hooks/useListScrollToTop';
import { ScrollToTopButton } from '../components/ScrollToTopButton';
import { BUTTON_LABEL } from '../copy/shared';
import { LazySheet } from '../components/LazySheet';

/**
 * The labels and people on an entry, under its words. A tag is a button that
 * narrows the list to it; the people are plain text, since their page is where
 * the entries about them are read.
 */
function EntryMeta({ entry, personName, onTag, styles }: {
  entry: JournalEntry;
  personName: (id: string) => string | null;
  onTag: (tag: string) => void;
  styles: ReturnType<typeof makeStyles>;
}) {
  const names = (entry.personIds ?? []).map(personName).filter((n): n is string => n !== null);
  const tags = entry.tags ?? [];
  if (tags.length === 0 && names.length === 0) return null;
  return (
    <View style={styles.metaRow}>
      {names.length > 0 && <Text style={styles.metaText}>{`About ${names.join(', ')}`}</Text>}
      {tags.map(tag => (
        <TouchableOpacity
          key={tag}
          style={styles.tagChip}
          activeOpacity={interaction.activeOpacity}
          onPress={() => { haptics.tap(); onTag(tag); }}
          accessibilityRole="button"
          accessibilityLabel={`Show only entries tagged ${tag}`}
        >
          <Text style={styles.tagChipText}>{tag}</Text>
        </TouchableOpacity>
      ))}
    </View>
  );
}

/**
 * The journal, or the dream log: one screen over `useJournalStore`, split by
 * `kind` — see `docs/arch/journal.md`.
 *
 * Read as a diary: days newest first, each day one page, its entries (the
 * snippets the part-of-day reminders ask for) in the order they were written
 * with only their time between them, the words at body size. Counts only, and nothing derived from
 * what was written.
 */
function JournalLogContent({ kind }: { kind: JournalKind }) {
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
  // One tag the list is narrowed to, set by tapping a tag on an entry.
  const [tagFilter, setTagFilter] = useState<string | null>(null);
  const days = useMemo(() => {
    const found = searchJournal(entries, search.query);
    return groupJournalByDay(tagFilter ? entriesWithTag(found, tagFilter) : found);
  }, [entries, search.query, tagFilter]);
  const pastYears = useMemo(() => onThisDay(entries, kind, todayKey), [entries, kind, todayKey]);
  const people = usePersonStore(s => s.people);
  const personName = (id: string): string | null => {
    const person = people.find(p => p.id === id);
    return person ? displayNameOf(person) : null;
  };
  // The month grid and the page it opens, or a random page.
  const [monthOpen, setMonthOpen] = useState(false);
  const [dayOpen, setDayOpen] = useState(false);
  const [shownDay, setShownDay] = useState<string | null>(null);
  const [dayIsRandom, setDayIsRandom] = useState(false);
  const showDay = (dayKey: string, random: boolean) => {
    setShownDay(dayKey);
    setDayIsRandom(random);
    setMonthOpen(false);
    setDayOpen(true);
  };
  const showRandomDay = () => {
    const pick = randomJournalDay(entries, kind, todayKey);
    if (pick) showDay(pick, true);
  };
  const stats = useMemo(() => journalStats(entries, todayKey.slice(0, 7)), [entries, todayKey]);
  // Only the journal has a goal: a dream is written down as it is remembered.
  const wordGoal = useSettingsStore(s => (kind === 'journal' ? s.journalWordGoal : null));
  const [goalOpen, setGoalOpen] = useState(false);
  // Every snippet of a day, not just the ones a search leaves showing.
  const wordsByDay = useMemo(() => {
    const byDay = new Map<string, number>();
    for (const e of entries) byDay.set(e.dayKey, (byDay.get(e.dayKey) ?? 0) + countWords(e.text));
    return byDay;
  }, [entries]);
  const goalDays = useMemo(
    () => (wordGoal === null ? 0 : daysReachingWordGoal(entries, wordGoal)),
    [entries, wordGoal],
  );
  const keyboardScroll = useKeyboardInsetScroll<FlatList<JournalDay>>({ refreshing: pullSearch.pulling });
  const scrollTop = useListScrollToTop(keyboardScroll);

  const [sheetOpen, setSheetOpen] = useState(false);
  const [editing, setEditing] = useState<JournalEntry | null>(null);

  // `dundundun://journal?log=1` / `dreams?log=1`, the reminder task's link.
  // Stamped and tracked against what was handled, as MoodScreen's openLog is,
  // with the same `returnTo` hand-back once the sheet closes.
  const routeInfo = useRoute<{ key: string; name: string; params?: { openLog?: number; openEntry?: string; dictate?: number; returnTo?: string } }>();
  const [handledOpenLog, setHandledOpenLog] = useState<number | undefined>(undefined);
  // `mic=1`, the row's microphone: the sheet opens already listening. Cleared
  // when it closes, so reopening it any other way starts silent.
  const [dictateOnOpen, setDictateOnOpen] = useState(false);
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
    setDictateOnOpen(routeInfo.params.dictate !== undefined);
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
        { text: BUTTON_LABEL.cancel, style: 'cancel' },
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
    setDictateOnOpen(false);
    if (returnTo) {
      navigateToTab(returnTo);
      setReturnTo(undefined);
    }
  };

  const [sharing, setSharing] = useState(false);
  const shareTitle = kind === 'dream' ? 'Share your dreams' : 'Share your journal';

  /**
   * Hand this kind's entries to the share sheet as Markdown or CSV, the
   * medication screen's flow: the summary is confirmed before anything is written, and
   * the file is deleted the moment the share sheet closes.
   */
  const share = async () => {
    if (entries.length === 0 || sharing) return;
    haptics.tap();
    const chosen = await new Promise<JournalExportFormat | null>(resolve => {
      Alert.alert(shareTitle, journalExportSummary(entries, kind), [
        { text: BUTTON_LABEL.cancel, style: 'cancel', onPress: () => resolve(null) },
        { text: 'Share as Markdown', onPress: () => resolve('markdown') },
        { text: 'Share as CSV', onPress: () => resolve('csv') },
      ], { onDismiss: () => resolve(null) });
    });
    if (!chosen) return;

    setSharing(true);
    let uri: string | null = null;
    try {
      if (!(await canShare())) {
        Alert.alert('Can’t share from this device', 'This device cannot open a share sheet.');
        return;
      }
      const body = chosen === 'markdown'
        ? journalExportMarkdown(entries, kind, personName)
        : journalExportCsv(entries, kind, personName);
      uri = writeExportFile(body, journalExportFileName(kind, new Date(), chosen));
      await (chosen === 'markdown' ? shareMarkdownFile(uri, shareTitle) : shareCsvFile(uri, shareTitle));
    } catch {
      Alert.alert('Couldn’t export', 'The file couldn’t be written. Try again.');
    } finally {
      if (uri) discardBackupFile(uri);
      setSharing(false);
    }
  };

  // Each figure's words are joined with no-break spaces so a narrow header wraps between figures
  // ("7 days ·" / "7 this month") rather than inside one ("7 this" / "month").
  const NBSP = ' ';
  const subtitle = stats.dayCount === 0 ? undefined
    : `${stats.dayCount}${NBSP}${stats.dayCount === 1 ? 'day' : 'days'} · ${stats.dayCountInMonth}${NBSP}this${NBSP}month`
      + (wordGoal === null ? '' : ` · ${goalDays}${NBSP}reached${NBSP}${wordGoal.toLocaleString('en-US')}${NBSP}words`);

  /** A day's heading: its words, set against the goal when there is one. */
  const dayWordsLabel = (dayKey: string): string => {
    const words = wordsByDay.get(dayKey) ?? 0;
    return wordGoal === null
      ? formatWordCount(words)
      : `${words.toLocaleString('en-US')} of ${wordGoal.toLocaleString('en-US')} words`;
  };

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
          ...(entries.length > 0 ? [{
            icon: 'calendar-outline' as const,
            onPress: () => { haptics.tap(); setMonthOpen(true); },
            accessibilityLabel: 'See the days you have written',
          }, {
            icon: 'shuffle' as const,
            onPress: () => { haptics.tap(); showRandomDay(); },
            accessibilityLabel: kind === 'dream' ? 'Read a random dream page' : 'Read a random journal page',
          }] : []),
          ...(kind === 'journal' ? [{
            icon: 'target' as const,
            onPress: () => { haptics.tap(); setGoalOpen(true); },
            active: wordGoal !== null,
            accessibilityLabel: wordGoal === null ? 'Set a word goal' : 'Edit your word goal',
          }] : []),
          {
            icon: 'add-circle-outline' as const,
            onPress: openNew,
            accessibilityLabel: kind === 'dream' ? 'Write down a dream' : 'Write in your journal',
          },
        ], screenSettings.action)}
      />
      <ScreenSettingsSheet {...screenSettings.sheet} />
      <JournalWordGoalSheet visible={goalOpen} onClose={() => setGoalOpen(false)} />
      <HubPills hub="health" active={route} />
    </>
  );

  const sheet = (
    <>
      <LazySheet open={sheetOpen}>
        <JournalEntrySheet visible={sheetOpen} kind={kind} editing={editing} dictateOnOpen={dictateOnOpen} onClose={closeSheet} />
      </LazySheet>
      <LazySheet open={monthOpen}>
        <JournalMonthSheet
          visible={monthOpen}
          kind={kind}
          onPickDay={dayKey => showDay(dayKey, false)}
          onClose={() => setMonthOpen(false)}
        />
      </LazySheet>
      <LazySheet open={dayOpen}>
        <JournalDaySheet
          visible={dayOpen}
          kind={kind}
          dayKey={shownDay}
          onAnother={dayIsRandom ? showRandomDay : undefined}
          onEdit={entry => { setDayOpen(false); openEdit(entry); }}
          onClose={() => setDayOpen(false)}
        />
      </LazySheet>
    </>
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
      {tagFilter && (
        <View style={styles.activeFilterRow}>
          <TouchableOpacity
            style={styles.activeFilter}
            activeOpacity={interaction.activeOpacity}
            onPress={() => { haptics.tap(); setTagFilter(null); }}
            accessibilityRole="button"
            accessibilityLabel={`Showing only ${tagFilter}. Clear this filter`}
          >
            <Text style={styles.activeFilterText}>{tagFilter}</Text>
            <Ionicons name="close" size={iconSize.sm} color={colors.onAccent} />
          </TouchableOpacity>
        </View>
      )}
      <FlatList
        ref={scrollTop.ref}
        refreshControl={pullSearch.refreshControl}
        {...keyboardScroll.props}
        {...scrollTop.listProps}
        style={styles.list}
        data={days}
        keyExtractor={day => day.dayKey}
        contentContainerStyle={[styles.listContent, { paddingBottom: Math.max(tabBarHeight + spacing.xl, scrollTop.clearance) }]}
        keyboardShouldPersistTaps="handled"
        ListHeaderComponent={search.query || tagFilter ? null : (
          <>
            {pastYears.length > 0 && (
              <View>
                <Text style={styles.dayLabel}>ON THIS DAY</Text>
                <View style={styles.card}>
                  {pastYears.map((past, index) => (
                    <TouchableOpacity
                      key={past.dayKey}
                      style={[styles.entryRow, index === 0 && styles.firstRow]}
                      activeOpacity={interaction.activeOpacity}
                      onPress={() => { haptics.tap(); showDay(past.dayKey, false); }}
                      accessibilityRole="button"
                      accessibilityLabel={`${past.yearsAgo === 1 ? 'A year ago' : `${past.yearsAgo} years ago`}: ${journalSnippet(past.entries[0].text)}`}
                    >
                      <Text style={styles.entryTime}>
                        {`${past.yearsAgo === 1 ? '1 year ago' : `${past.yearsAgo} years ago`} · ${format(new Date(`${past.dayKey}T12:00:00`), 'MMMM d, yyyy')}`}
                      </Text>
                      <Text style={styles.entryText} numberOfLines={3}>{journalSnippet(past.entries[0].text)}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>
            )}
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
              {`${format(new Date(`${day.dayKey}T00:00:00`), 'EEEE, MMMM d, yyyy')} · ${dayWordsLabel(day.dayKey)}`.toUpperCase()}
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
                  <EntryMeta entry={entry} personName={personName} onTag={setTagFilter} styles={styles} />
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

/**
 * The journal lock (Settings › Privacy & AI) in front of the screen. The
 * content is a separate component so none of its stores, searches or sheets
 * mount while locked, and a reminder's `?log=1` link is handled once it is
 * opened, since the route params are still there when it mounts.
 */
function JournalLogScreen({ kind }: { kind: JournalKind }) {
  const { locked, unlock } = useJournalAccess();
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const insets = useSafeAreaInsets();
  const tabBarHeight = useBottomTabBarHeight();
  const copy = JOURNAL_KIND_COPY[kind];
  const route = kind === 'dream' ? 'Dreams' : 'Journal';

  // Asks as soon as the screen is shown, as the app lock does. A cancel leaves
  // the button below for another go.
  useEffect(() => {
    if (locked) unlock();
  }, [locked, unlock]);

  if (!locked) return <JournalLogContent kind={kind} />;
  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <ScreenHeader title={copy.title} />
      <HubPills hub="health" active={route} />
      <EmptyState
        icon="lock-closed-outline"
        title={kind === 'dream' ? 'Dreams are locked' : 'Journal is locked'}
        subtitle="Unlock with Face ID to read and write here."
        actionLabel="Unlock"
        onAction={() => { unlock(); }}
        bottomOffset={tabBarHeight}
      />
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
  metaRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: spacing.sm, marginTop: spacing.sm },
  metaText: { color: colors.textSecondary, fontSize: font.xs },
  tagChip: {
    backgroundColor: colors.bgTertiary,
    borderRadius: radius.full,
    paddingHorizontal: spacing.smd,
    paddingVertical: spacing.xxs,
  },
  tagChipText: { color: colors.text, fontSize: font.xs },
  activeFilterRow: { paddingHorizontal: spacing.md, paddingBottom: spacing.sm, flexDirection: 'row' },
  activeFilter: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    backgroundColor: colors.accentFill,
    borderRadius: radius.full,
    paddingHorizontal: spacing.smd,
    paddingVertical: spacing.xsm,
  },
  activeFilterText: { color: colors.onAccent, fontSize: font.sm, fontWeight: fontWeight.semibold },
  container: { flex: 1, backgroundColor: colors.bg },
  search: { marginHorizontal: spacing.md, marginTop: spacing.sm, marginBottom: spacing.sm },
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
