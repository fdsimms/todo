// The mood log: how you're doing today, the last two weeks, and your recent entries (see
// docs/arch/mood-log.md). What it says against your tasks, Health, food and workouts is
// MoodInsightsScreen; the symptoms and the experiments and milestones have their own
// screens. All five are Health hub pills. Grep a landmark rather than reading it start to finish:
//
//   ==== <name> ====        the section banners through the logic half
//   makeStyles              styles, at the bottom
//   Stat                    one stat tile, above the styles
import { useMemo, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation, useRoute } from '@react-navigation/native';
import { navigateToTab } from '../navigation/navigationRef';
import { useBottomTabBarHeight } from '@react-navigation/bottom-tabs';
import { format } from 'date-fns/format';
import Ionicons from '@expo/vector-icons/Ionicons';
import type { MoodLevel, MoodLog } from '../types';
import { useMoodStore } from '../store/useMoodStore';
import { useJournalStore } from '../store/useJournalStore';
import { useJournalAccess } from '../hooks/useJournalAccess';
import { useRouteArrival } from '../hooks/useRouteArrival';
import { journalPlainText } from '../utils/journalMarkdown';
import { useTaskStore } from '../store/useTaskStore';
import { useSettingsStore } from '../store/useSettingsStore';
import { useColors } from '../theme/ThemeContext';
import { ChartGuides, BAR_GUIDE_GAP, useGuideGutter } from '../components/ChartGuides';
import { spacing, radius, font, fontWeight, iconSize, interaction, type Colors } from '../theme';
import { haptics } from '../utils/haptics';
import { dayKeyOf, dayKeyToDate, getCurrentDayStart } from '../utils/dateUtils';
import { diaryEntries, openEntries } from '../utils/journal';
import { MOOD_CHANGES, MOOD_LEVELS, changeTally } from '../utils/moodLog';
import { logsInDayRange, lookBacks } from '../utils/moodHistory';
import { moodExportCsv, moodExportFileName, moodExportSummary } from '../utils/moodExport';
import { buildMoodDays, moodSummary } from '../utils/moodInsights';
import { ScreenHeader } from '../components/ScreenHeader';
import { ScreenSettingsSheet } from '../components/ScreenSettingsSheet';
import { useScreenSettings, withScreenSettings } from '../hooks/useScreenSettings';
import { usePullToSearch } from '../hooks/usePullToSearch';
import { HubPills } from '../components/HubPills';
import { EmptyState } from '../components/EmptyState';
import { WideScroll, WideSpan } from '../components/WideScroll';
import { MoodLogSheet, type MoodLogPrefill } from '../components/MoodLogSheet';
import { MoodEntryRow } from '../components/MoodEntryRow';
import { MoodFace } from '../components/MoodFace';
import { PressableScale } from '../components/PressableScale';
import { CsvExportSheet } from '../components/CsvExportSheet';
import { useListScrollToTop } from '../hooks/useListScrollToTop';
import { ScrollToTopButton } from '../components/ScrollToTopButton';
import { LazySheet } from '../components/LazySheet';

/** How many days the chart shows. Two weeks fits a phone width at a readable bar. */
const CHART_DAYS = 14;

const BAR_HEIGHT = 90;

/** Width of the mood chart's label column at the default text size. */
const GUIDE_LABEL_WIDTH = 60;

/**
 * The mood log: a quick entry, the last two weeks, and the entries themselves.
 *
 * A history that wants reading in aggregate rather than a list of things to
 * work through. The comparisons against the rest of the app are on the Insights
 * screen, because every one of them is a join with another record and there are
 * a dozen: this screen stays short enough to log from.
 */
export function MoodScreen() {
  // ==== screen setup ====
  const pullSearch = usePullToSearch();
  const navigation = useNavigation<{ navigate: (screen: string, params?: object) => void }>();
  const colors = useColors();
  // This screen's own settings, from a gear in its header. See SCREEN_SETTINGS.
  const screenSettings = useScreenSettings('Mood', 'Mood settings');
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const guideGutter = useGuideGutter(GUIDE_LABEL_WIDTH);
  const insets = useSafeAreaInsets();
  const scrollTop = useListScrollToTop();
  const tabBarHeight = useBottomTabBarHeight();

  // ==== store reads, and the sheet state ====
  const logs = useMoodStore(s => s.logs);
  const tasks = useTaskStore(s => s.tasks);
  const dayResetTime = useSettingsStore(s => s.dayResetTime);

  const [sheetOpen, setSheetOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [editing, setEditing] = useState<MoodLog | null>(null);

  // ==== opening the log sheet from a link ====
  // `dundundun://mood?log=1` — the daily check-in task's link button. Stamped
  // with the arrival time rather than a boolean, and tracked against what has
  // already been handled, so tapping the same row twice opens the sheet twice:
  // the same shape PeopleScreen's openPerson uses, and for the same reason.
  const route = useRoute<{
    key: string;
    name: string;
    params?: { openLog?: number; returnTo?: string; prefillMood?: MoodLevel; prefillSymptom?: string };
  }>();
  // Where to hand the user back once the sheet this opens closes — the tab
  // they tapped the check-in request from, carried by `resetToMood`'s
  // `returnTo` param. Cleared whenever the sheet is opened by hand (`openNew`,
  // `openEdit`) so a manual visit never inherits a stale value left over from
  // an earlier link tap.
  const [returnTo, setReturnTo] = useState<string | undefined>(undefined);
  // What a link asked a new entry to open with (search's "feeling tired").
  // Cleared the same way `returnTo` is, so a manual open starts empty.
  const [prefill, setPrefill] = useState<MoodLogPrefill | null>(null);
  useRouteArrival(route.params?.openLog, () => {
    setReturnTo(route.params?.returnTo);
    const { prefillMood, prefillSymptom } = route.params ?? {};
    setPrefill(prefillMood !== undefined || prefillSymptom !== undefined
      ? { mood: prefillMood ?? null, symptom: prefillSymptom ?? null }
      : null);
    setEditing(null);
    setSheetOpen(true);
  });

  // ==== today, and the journal looking back ====
  const todayKey = dayKeyOf(getCurrentDayStart());
  const journal = useJournalStore(s => s.entries);
  // A sealed note to your future self is no look back until its day (openEntries).
  // Left out entirely while the journal lock is closed, so a page from a year ago isn't quoted here.
  const journalLocked = useJournalAccess().locked;
  const lookedBack = useMemo(
    () => lookBacks(logs, todayKey, journalLocked ? [] : openEntries(diaryEntries(journal), todayKey)),
    [logs, todayKey, journal, journalLocked],
  );


  // ==== the days, and the summary over them ====
  // Mood only: the Health and food windows the comparisons read are loaded by
  // the Insights screen, which is the one that draws them. `buildMoodDays` takes
  // them as empty here, and the average, streak and chart read only the mood.
  const days = useMemo(
    () => buildMoodDays(logs, tasks, dayResetTime, [], null, []),
    [logs, tasks, dayResetTime],
  );
  const summary = useMemo(() => moodSummary(days, todayKey), [days, todayKey]);

  // ==== the fourteen-day chart ====
  // The last CHART_DAYS logical days, whether or not each was logged — a gap in
  // the chart is the honest picture of a day nobody logged, and squeezing the
  // logged days together would draw a fortnight of entries out of four.
  const chart = useMemo(() => {
    const byDay = new Map(days.map(d => [d.dayKey, d]));
    const out: { key: string; label: string; a11y: string; mood: number | null; today: boolean }[] = [];
    const cursor = getCurrentDayStart();
    for (let i = CHART_DAYS - 1; i >= 0; i--) {
      const date = new Date(cursor);
      date.setDate(date.getDate() - i);
      const key = dayKeyOf(date);
      const mood = byDay.get(key)?.mood ?? null;
      const today = key === todayKey;
      out.push({
        key,
        label: format(date, 'EEEEE'),
        // Each column is its own accessibility element, so the value and the
        // "nothing logged" state — which are a bar height and a 2px baseline on
        // screen, and so invisible to VoiceOver — are read out per day. Fourteen
        // elements is the trade: a single summary would lose exactly the two
        // things the chart is drawn to show. The date is spelled out because a
        // weekday initial ("W") is what the chart reads as without it.
        a11y: `${today ? 'Today, ' : ''}${format(date, 'EEEE, MMMM d')}, ${
          mood === null ? 'nothing logged' : `mood ${mood.toFixed(1)} out of 5`
        }`,
        mood,
        today,
      });
    }
    return out;
  }, [days, todayKey]);

  // The answers to "since your last entry" over the same fortnight as the chart.
  // A tally of what was said, so it needs no minimum; null when there are none,
  // and then the card is not drawn at all.
  const changeCounts = useMemo(() => {
    const counts = changeTally(logs, chart[0].key);
    return counts.worse + counts.same + counts.better > 0 ? counts : null;
  }, [logs, chart]);

  // ==== today and recent entries ====
  // Today's entries sit in their own card at the top, so the history below
  // starts where they stop rather than listing them twice.
  const todayLogs = useMemo(() => logs.filter(l => l.dayKey === todayKey), [logs, todayKey]);
  const recent = useMemo(() => logs.filter(l => l.dayKey !== todayKey).slice(0, 20), [logs, todayKey]);

  // ==== opening and closing the sheets ====
  const openNew = () => { haptics.tap(); setReturnTo(undefined); setPrefill(null); setEditing(null); setSheetOpen(true); };
  // A face opens the sheet with that mood already picked rather than saving
  // on the tap: the sheet is where symptoms, tags and the note go, and saving
  // through it keeps the tag seeding and the mood task's auto-complete.
  const openWithMood = (mood: MoodLevel) => { haptics.tap(); setReturnTo(undefined); setEditing(null); setPrefill({ mood, symptom: null }); setSheetOpen(true); };
  const openEdit = (log: MoodLog) => { haptics.tap(); setReturnTo(undefined); setPrefill(null); setEditing(log); setSheetOpen(true); };
  const closeSheet = () => {
    setSheetOpen(false);
    setEditing(null);
    if (returnTo) {
      navigateToTab(returnTo);
      setReturnTo(undefined);
    }
  };



  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <ScreenHeader
        title="Mood"
        subtitle={summary.loggedDays > 0
          ? `${summary.loggedDays} ${summary.loggedDays === 1 ? 'day' : 'days'} logged`
          : undefined}
        actions={withScreenSettings([
          ...(logs.length > 0 ? [{
            icon: 'share-outline' as const,
            onPress: () => { haptics.tap(); setExportOpen(true); },
            accessibilityLabel: 'Export your mood log',
          }] : []),
          {
            icon: 'add-circle-outline' as const,
            onPress: openNew,
            accessibilityLabel: 'Log how you’re feeling',
          },
        ], screenSettings.action)}
      />
      <ScreenSettingsSheet {...screenSettings.sheet} />
      <HubPills hub="health" active="Mood" />

      {logs.length === 0 ? (
        <EmptyState
          icon="happy-outline"
          title="Nothing logged yet"
          subtitle="Log how you’re feeling and anything else you want to track. After a couple of weeks, it’s compared with what you get done."
          actionLabel="Log how you’re doing"
          onAction={openNew}
        />
      ) : (
        <WideScroll
          ref={scrollTop.ref}
          {...scrollTop.listProps}
          refreshControl={pullSearch.refreshControl}
          style={styles.scroll}
          contentContainerStyle={[styles.scrollContent, { paddingBottom: Math.max(tabBarHeight + spacing.xl, scrollTop.clearance) }]}
        >
          <WideSpan>
            <Text style={styles.sectionTitle}>TODAY</Text>
            <View style={[styles.card, styles.todayCard]}>
              <Text style={styles.todayPrompt}>
                {todayLogs.length === 0 ? 'How are you doing?' : 'Log another'}
              </Text>
              <View style={styles.faceRow}>
                {MOOD_LEVELS.map(level => (
                  <PressableScale
                    key={level.value}
                    style={styles.faceBtn}
                    onPress={() => openWithMood(level.value)}
                    accessibilityRole="button"
                    accessibilityLabel={`Log ${level.label.toLowerCase()}`}
                  >
                    <MoodFace level={level.value} size={iconSize.xl + 2} />
                  </PressableScale>
                ))}
              </View>
            </View>
            {todayLogs.length > 0 && (
              <View style={styles.todayEntries}>
                {todayLogs.map(log => (
                  <MoodEntryRow key={log.id} log={log} showDate={false} onPress={() => openEdit(log)} />
                ))}
              </View>
            )}

            <View style={styles.statRow}>
              <Stat
                styles={styles}
                value={summary.averageMood === null ? '—' : summary.averageMood.toFixed(1)}
                label="Average mood"
                // The em dash is a drawn placeholder rather than a value, so it is
                // spoken as the absence it stands for instead of as punctuation.
                accessibilityLabel={summary.averageMood === null
                  ? 'Average mood, nothing logged yet'
                  : `Average mood, ${summary.averageMood.toFixed(1)} out of 5`}
              />
              <Stat
                styles={styles}
                value={String(summary.streak)}
                label="Day streak"
                accessibilityLabel={`Day streak, ${summary.streak} ${summary.streak === 1 ? 'day' : 'days'}`}
              />
              <Stat
                styles={styles}
                value={String(summary.lowDays)}
                label="Low days"
                accessibilityLabel={`Low days, ${summary.lowDays}`}
              />
            </View>
          </WideSpan>

          {lookedBack.length > 0 && (
            <>
              <Text style={styles.sectionTitle}>LOOKING BACK</Text>
              <View style={styles.card}>
                {lookedBack.map((back, i) => (
                  <TouchableOpacity
                    key={back.dayKey}
                    style={i > 0 ? styles.lookBackNext : undefined}
                    activeOpacity={interaction.activeOpacity}
                    onPress={() => { haptics.tap(); navigation.navigate('MoodDay', { dayKey: back.dayKey }); }}
                    accessibilityRole="button"
                    accessibilityLabel={`${back.label}, ${format(dayKeyToDate(back.dayKey), 'EEEE, MMMM d, yyyy')}. ${[...back.logs.map(l => l.note), ...back.journal.map(e => (e.kind === 'dream' ? `Dream: ${journalPlainText(e.text)}` : journalPlainText(e.text)))].filter(Boolean).join('. ')}`}
                  >
                    <Text style={styles.lookBackWhen}>
                      {back.label} · {format(dayKeyToDate(back.dayKey), 'EEE, MMM d, yyyy')}
                    </Text>
                    {back.logs.map(l => (
                      !!l.note && <Text key={l.id} style={styles.lookBackNote} numberOfLines={6}>{l.note}</Text>
                    ))}
                    {back.journal.map(e => (
                      <Text key={e.id} style={styles.lookBackNote} numberOfLines={6}>
                        {e.kind === 'dream' ? `Dream: ${journalPlainText(e.text)}` : journalPlainText(e.text)}
                      </Text>
                    ))}
                  </TouchableOpacity>
                ))}
              </View>
            </>
          )}

          <>
            <Text style={styles.sectionTitle}>THE LAST TWO WEEKS</Text>
            <View style={styles.card}>
              <View>
                {/* A line for each mood, labelled at the ends and the middle so five
                    labels don't crowd the 90pt track. Drawn before the bars, which
                    sit on top of them. */}
                <ChartGuides
                  height={BAR_HEIGHT}
                  gutter={guideGutter}
                  guides={MOOD_LEVELS.map(level => ({
                    fraction: level.value / MOOD_LEVELS.length,
                    label: level.value === 1 || level.value === 3 || level.value === MOOD_LEVELS.length ? level.label : '',
                  }))}
                />
                <View style={[styles.chartInner, { paddingLeft: guideGutter }]}>
                  {chart.map(({ key, label, a11y, mood, today }) => (
                    <View key={key} style={styles.chartCol} accessible accessibilityLabel={a11y}>
                      <View style={styles.barTrack}>
                        <View
                          style={[
                            styles.bar,
                            {
                              // A day with no entry draws a flat baseline rather
                              // than a zero-height bar: zero is a mood on this
                              // scale's floor, and "didn't log" is not a bad day.
                              height: mood === null
                                ? 2
                                : Math.max(BAR_HEIGHT * 0.06, (mood / MOOD_LEVELS.length) * BAR_HEIGHT - BAR_GUIDE_GAP),
                              backgroundColor: mood === null
                                ? colors.bgQuaternary
                                : today ? colors.accent : colors.bgQuaternary,
                            },
                          ]}
                        />
                      </View>
                      <Text style={[styles.barLabel, today && styles.barLabelToday]}>{label}</Text>
                    </View>
                  ))}
                </View>
              </View>
              <Text style={styles.chartCaption}>
                A flat line is a day with nothing logged.
              </Text>
            </View>
          </>

          {changeCounts && (
            <>
              <Text style={styles.sectionTitle}>SINCE YOUR LAST ENTRY</Text>
              <View style={styles.card}>
                <View style={styles.tallyRow}>
                  {MOOD_CHANGES.map(c => (
                    <View
                      key={c.value}
                      style={styles.splitCell}
                      accessible
                      accessibilityLabel={`${changeCounts[c.value]} ${changeCounts[c.value] === 1 ? 'entry' : 'entries'} you said felt ${c.value === 'same' ? 'the same as' : `${c.label.toLowerCase()} than`} the one before`}
                    >
                      <Text style={styles.splitValue}>{changeCounts[c.value]}</Text>
                      <Text style={styles.splitLabel}>{c.label.toLowerCase()}</Text>
                    </View>
                  ))}
                </View>
                <Text style={styles.chartCaption}>Your own answers over the last {CHART_DAYS} days.</Text>
              </View>
            </>
          )}

          <View style={styles.card}>
            <TouchableOpacity
              style={styles.linkRow}
              activeOpacity={interaction.activeOpacity}
              onPress={() => { haptics.tap(); navigateToTab('Insights'); }}
              accessibilityRole="button"
              accessibilityLabel="Insights, your mood against what you finish, eat, sleep and train"
            >
              <View style={styles.linkBody}>
                <Text style={styles.linkLabel}>Insights</Text>
                <Text style={styles.linkMeta}>Your mood against what you finish, eat, sleep and train.</Text>
              </View>
              <Ionicons name="chevron-forward" size={16} color={colors.textTertiary} />
            </TouchableOpacity>
          </View>

          <WideSpan>
            {recent.length > 0 && <Text style={styles.sectionTitle}>RECENT ENTRIES</Text>}
            {recent.map(log => (
              <MoodEntryRow
                key={log.id}
                log={log}
                onPress={() => openEdit(log)}
              />
            ))}
            {logs.length > todayLogs.length + recent.length && (
              <TouchableOpacity
                style={styles.seeAllRow}
                activeOpacity={interaction.activeOpacity}
                onPress={() => { haptics.tap(); navigation.navigate('MoodHistory'); }}
                accessibilityRole="button"
                accessibilityLabel={`See all ${logs.length} entries`}
              >
                <Text style={styles.seeAllText}>See all {logs.length} entries</Text>
                <Ionicons name="chevron-forward" size={16} color={colors.accent} />
              </TouchableOpacity>
            )}
          </WideSpan>
        </WideScroll>
      )}

      <LazySheet open={sheetOpen}>
        <MoodLogSheet
          visible={sheetOpen}
          editing={editing}
          prefill={prefill}
          onClose={closeSheet}
        />
      </LazySheet>

      <LazySheet open={exportOpen}>
        <CsvExportSheet
          visible={exportOpen}
          onClose={() => setExportOpen(false)}
          hint={'A spreadsheet of your entries: day, time, mood, any symptoms and '
            + 'their severity, context tags and notes.'}
          dialogTitle="Share your mood log"
          select={from => (from === null ? logs : logsInDayRange(logs, from, null))}
          toCsv={moodExportCsv}
          fileName={moodExportFileName}
          summary={moodExportSummary}
        />
      </LazySheet>

      <ScrollToTopButton {...scrollTop.buttonProps} />
      {pullSearch.sheet}
    </View>
  );
}

/**
 * One number and what it counts.
 *
 * The two `Text` nodes are a single accessibility element: read separately they
 * are "3.2" and "Average mood" with nothing joining them, and a row of three
 * tiles is six unrelated announcements. The caller supplies the sentence rather
 * than it being stitched from `value` here, because the drawn value is
 * shorthand — "—" for nothing logged, a bare count for a number of days.
 */
function Stat({ styles, value, label, accessibilityLabel }: {
  styles: ReturnType<typeof makeStyles>;
  value: string;
  label: string;
  accessibilityLabel: string;
}) {
  return (
    <View style={styles.statCell} accessible accessibilityLabel={accessibilityLabel}>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

const makeStyles = (colors: Colors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  scroll: { flex: 1 },
  scrollContent: { paddingHorizontal: spacing.md },
  todayCard: { marginBottom: spacing.md },
  todayPrompt: { fontSize: font.md, fontWeight: fontWeight.semibold, color: colors.text, marginBottom: spacing.smd },
  faceRow: { flexDirection: 'row', justifyContent: 'space-between', gap: spacing.sm },
  faceBtn: {
    flex: 1,
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.md,
    backgroundColor: colors.bgTertiary,
  },
  todayEntries: { marginBottom: spacing.md },
  statRow: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.lg },
  statCell: {
    flex: 1,
    backgroundColor: colors.bgSecondary,
    borderRadius: radius.md,
    paddingVertical: spacing.md,
    alignItems: 'center',
  },
  statValue: { fontSize: font.xl, fontWeight: fontWeight.bold, color: colors.text },
  statLabel: { fontSize: font.xs, color: colors.textSecondary, marginTop: spacing.xxs, textAlign: 'center' },
  sectionTitle: {
    fontSize: font.xs,
    fontWeight: fontWeight.semibold,
    color: colors.textSecondary,
    letterSpacing: 0.8,
    marginBottom: spacing.sm,
  },
  card: {
    backgroundColor: colors.bgSecondary,
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: spacing.lg,
  },
  chartInner: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end' },
  chartCol: { flex: 1, alignItems: 'center' },
  barTrack: { width: 12, height: BAR_HEIGHT, justifyContent: 'flex-end' },
  bar: { width: 12, borderRadius: 4 },
  barLabel: { marginTop: 4, color: colors.textTertiary, fontSize: font.xxs, fontWeight: '500' },
  barLabelToday: { color: colors.accent, fontWeight: fontWeight.semibold },
  lookBackNext: { marginTop: spacing.md },
  lookBackWhen: { fontSize: font.xs, color: colors.textSecondary, marginBottom: spacing.xs },
  lookBackNote: { fontSize: font.md, color: colors.text, marginTop: spacing.xxs },
  chartCaption: { fontSize: font.xs, color: colors.textTertiary, marginTop: spacing.sm },
  // The same cells with nothing above the row to clear.
  tallyRow: { flexDirection: 'row' },
  splitCell: { flex: 1, alignItems: 'center' },
  splitValue: { fontSize: font.lg, fontWeight: fontWeight.bold, color: colors.text },
  splitLabel: { fontSize: font.xs, color: colors.textSecondary, marginTop: spacing.xxs },
  linkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.sm,
  },
  linkBody: { flex: 1 },
  linkLabel: { fontSize: font.sm, color: colors.text },
  linkMeta: { fontSize: font.xs, color: colors.textSecondary, marginTop: spacing.xxs },
  seeAllRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    paddingVertical: spacing.md,
  },
  seeAllText: { fontSize: font.sm, color: colors.accent, fontWeight: fontWeight.medium },
});
