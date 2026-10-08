import React, { useMemo, useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { format } from 'date-fns/format';
import type { JournalEntry, MoodLog } from '../types';
import { useMoodStore } from '../store/useMoodStore';
import { useJournalStore } from '../store/useJournalStore';
import { useColors } from '../theme/ThemeContext';
import { spacing, radius, font, fontWeight, lineHeight, interaction, type Colors } from '../theme';
import { haptics } from '../utils/haptics';
import { dayKeyOf, dayKeyToDate, getCurrentDayStart } from '../utils/dateUtils';
import { openEntries } from '../utils/journal';
import { logsOnDay, moodEmoji, moodLabel, severityLabel } from '../utils/moodLog';
import { adjacentLogDays } from '../utils/moodHistory';
import { DetailHeader } from '../components/DetailHeader';
import { EmptyState } from '../components/EmptyState';
import { MoodLogSheet } from '../components/MoodLogSheet';
import { JournalEntrySheet } from '../components/JournalEntrySheet';
import { JournalText } from '../components/JournalText';
import { journalPlainText } from '../utils/journalMarkdown';

type RootStackParamList = {
  MoodDay: { dayKey: string };
};

/**
 * One day of the mood log, read as a page.
 *
 * The history list shows an entry per card, which is right for scanning and
 * wrong for reading: the day's words are broken up by an emoji and a label on
 * every one. Here a day is its date, then its entries in the order they
 * happened, each a time and a paragraph, with symptoms and tags as quiet
 * footnotes under the entry that carried them.
 *
 * It reads and links, nothing more. The mood is a small marker beside the
 * time, no day average is printed (that is a number nobody logged, see
 * `groupLogsByDay`), and nothing is compared with any other day. Paging skips
 * days with nothing logged rather than drawing blank pages
 * (`adjacentLogDays`). Tapping an entry opens the same sheet every other list
 * does, so editing and deleting live in one place.
 *
 * The day's journal entries and dreams follow the mood entries
 * (`docs/arch/journal.md`), and paging walks the days that have either.
 */
export function MoodDayScreen() {
  const navigation = useNavigation<{ goBack: () => void }>();
  const route = useRoute<RouteProp<RootStackParamList, 'MoodDay'>>();
  const insets = useSafeAreaInsets();
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const logs = useMoodStore(s => s.logs);
  const [dayKey, setDayKey] = useState(route.params.dayKey);
  const [editing, setEditing] = useState<MoodLog | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const allJournal = useJournalStore(s => s.entries);
  // A sealed note to your future self shows nowhere until its day (openEntries).
  const todayKey = dayKeyOf(getCurrentDayStart());
  const journal = useMemo(() => openEntries(allJournal, todayKey), [allJournal, todayKey]);
  const [editingPage, setEditingPage] = useState<JournalEntry | null>(null);
  // Its own flag so the entry stays put while the sheet fades out.
  const [pageOpen, setPageOpen] = useState(false);

  const entries = useMemo(() => logsOnDay(logs, dayKey), [logs, dayKey]);
  const pages = useMemo(
    () => journal.filter(e => e.dayKey === dayKey).sort((a, b) => a.loggedAt.localeCompare(b.loggedAt)),
    [journal, dayKey],
  );
  const journalPages = pages.filter(e => e.kind === 'journal');
  const dreamPages = pages.filter(e => e.kind === 'dream');
  const { previous, next } = useMemo(
    () => adjacentLogDays([...logs, ...journal], dayKey),
    [logs, journal, dayKey],
  );
  const date = dayKeyToDate(dayKey);

  const go = (target: string | null) => {
    if (!target) return;
    haptics.tap();
    setDayKey(target);
  };

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <DetailHeader title="Diary" onBack={() => navigation.goBack()} />

      {entries.length === 0 && pages.length === 0 ? (
        <EmptyState
          icon="book-outline"
          title="Nothing on this day"
          subtitle="Entries you record for this day show up here."
        />
      ) : (
        <ScrollView
          contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + spacing.xl }]}
        >
          <Text style={styles.weekday} accessibilityRole="header">{format(date, 'EEEE')}</Text>
          <Text style={styles.date}>{format(date, 'MMMM d, yyyy')}</Text>

          {entries.map(log => (
            <TouchableOpacity
              key={log.id}
              style={styles.entry}
              activeOpacity={interaction.activeOpacity}
              onPress={() => { haptics.tap(); setEditing(log); setSheetOpen(true); }}
              accessibilityRole="button"
              accessibilityLabel={[
                format(new Date(log.loggedAt), 'h:mm a'),
                log.mood === null ? null : moodLabel(log.mood),
                log.note || null,
                log.symptoms.length > 0
                  ? log.symptoms.map(s => `${s.name}, ${severityLabel(s.severity)}`).join(', ')
                  : null,
                log.contextTags.length > 0 ? log.contextTags.join(', ') : null,
              ].filter(Boolean).join('. ')}
              accessibilityHint="Opens this entry to edit"
            >
              <Text style={styles.time}>
                {format(new Date(log.loggedAt), 'h:mm a')}
                {log.mood === null ? '' : `  ${moodEmoji(log.mood)}`}
              </Text>
              {!!log.note && <Text style={styles.note}>{log.note}</Text>}
              {log.symptoms.length > 0 && (
                <Text style={styles.foot}>
                  {log.symptoms.map(s => `${s.name} (${severityLabel(s.severity).toLowerCase()})`).join(', ')}
                </Text>
              )}
              {log.contextTags.length > 0 && (
                <Text style={styles.foot}>{log.contextTags.join(', ')}</Text>
              )}
            </TouchableOpacity>
          ))}

          {([['JOURNAL', journalPages], ['DREAMS', dreamPages]] as const).map(([heading, list]) => list.length > 0 && (
            <View key={heading}>
              <Text style={styles.section}>{heading}</Text>
              {list.map(entry => (
                <TouchableOpacity
                  key={entry.id}
                  style={styles.entry}
                  activeOpacity={interaction.activeOpacity}
                  onPress={() => { haptics.tap(); setEditingPage(entry); setPageOpen(true); }}
                  accessibilityRole="button"
                  accessibilityLabel={`${format(new Date(entry.loggedAt), 'h:mm a')}. ${journalPlainText(entry.text)}`}
                  accessibilityHint="Opens this entry to edit"
                >
                  <Text style={styles.time}>{format(new Date(entry.loggedAt), 'h:mm a')}</Text>
                  <JournalText text={entry.text} textStyle={styles.note} />
                </TouchableOpacity>
              ))}
            </View>
          ))}

          <View style={styles.pager}>
            <PagerButton
              styles={styles}
              colors={colors}
              direction="back"
              label={previous ? format(dayKeyToDate(previous), 'MMM d') : null}
              onPress={() => go(previous)}
            />
            <PagerButton
              styles={styles}
              colors={colors}
              direction="forward"
              label={next ? format(dayKeyToDate(next), 'MMM d') : null}
              onPress={() => go(next)}
            />
          </View>
        </ScrollView>
      )}

      <MoodLogSheet
        visible={sheetOpen}
        editing={editing}
        onClose={() => { setSheetOpen(false); setEditing(null); }}
      />
      {/* Never visible at once with the mood sheet: each opens only from a tap on this page. */}
      <JournalEntrySheet
        visible={pageOpen && editingPage !== null}
        kind={editingPage?.kind ?? 'journal'}
        editing={editingPage}
        onClose={() => setPageOpen(false)}
      />
    </View>
  );
}

function PagerButton({ styles, colors, direction, label, onPress }: {
  styles: ReturnType<typeof makeStyles>;
  colors: Colors;
  direction: 'back' | 'forward';
  /** The date it goes to, or null when there is no written day that way. */
  label: string | null;
  onPress: () => void;
}) {
  const back = direction === 'back';
  // An empty slot rather than a disabled button, so the other one keeps its side.
  if (!label) return <View style={styles.pagerSlot} />;
  return (
    <TouchableOpacity
      style={[styles.pagerSlot, back ? styles.pagerStart : styles.pagerEnd]}
      activeOpacity={interaction.activeOpacity}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${back ? 'Earlier' : 'Later'} entry, ${label}`}
    >
      {back && <Ionicons name="chevron-back" size={16} color={colors.accent} />}
      <Text style={styles.pagerText}>{label}</Text>
      {!back && <Ionicons name="chevron-forward" size={16} color={colors.accent} />}
    </TouchableOpacity>
  );
}

const makeStyles = (colors: Colors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  content: { paddingHorizontal: spacing.lg, paddingTop: spacing.md },
  weekday: {
    fontSize: font.xs,
    fontWeight: fontWeight.semibold,
    color: colors.textSecondary,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
  date: {
    fontSize: font.xxl,
    lineHeight: lineHeight.xxl,
    fontWeight: fontWeight.semibold,
    color: colors.text,
    marginTop: spacing.xs,
    marginBottom: spacing.lg,
  },
  entry: { marginBottom: spacing.lg },
  section: {
    fontSize: font.xs,
    fontWeight: fontWeight.semibold,
    color: colors.textSecondary,
    letterSpacing: 0.8,
    marginBottom: spacing.sm,
  },
  time: { fontSize: font.sm, color: colors.textSecondary, marginBottom: spacing.xs },
  note: { fontSize: font.lg, lineHeight: lineHeight.lg, color: colors.text },
  foot: { fontSize: font.sm, color: colors.textSecondary, marginTop: spacing.xs },
  pager: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: spacing.md,
    paddingTop: spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.separator,
  },
  pagerSlot: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  pagerStart: { justifyContent: 'flex-start' },
  pagerEnd: { justifyContent: 'flex-end' },
  pagerText: { fontSize: font.md, color: colors.accent, fontWeight: fontWeight.medium },
});
