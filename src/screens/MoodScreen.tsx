import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, Alert, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect, useNavigation, useRoute } from '@react-navigation/native';
import { navigationRef } from '../navigation/navigationRef';
import { useBottomTabBarHeight } from '@react-navigation/bottom-tabs';
import { addDays } from 'date-fns/addDays';
import { format } from 'date-fns/format';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useShallow } from 'zustand/react/shallow';
import type { Milestone, MoodLog } from '../types';
import { useMoodStore } from '../store/useMoodStore';
import { useMilestoneStore } from '../store/useMilestoneStore';
import { useTaskStore } from '../store/useTaskStore';
import { useSettingsStore } from '../store/useSettingsStore';
import { useHealthStore, HEALTH_HISTORY_DAYS } from '../store/useHealthStore';
import { useFoodLogStore, FOOD_INSIGHT_DAYS } from '../store/useFoodLogStore';
import { useColors } from '../theme/ThemeContext';
import { spacing, radius, font, fontWeight, interaction, type Colors } from '../theme';
import { haptics } from '../utils/haptics';
import { dayKeyOf, dayKeyToDate, getCurrentDayStart } from '../utils/dateUtils';
import { segmentOf } from '../utils/rhythms';
import {
  contextTagKey,
  contextTagVocabulary,
  symptomKey,
  symptomVocabulary,
} from '../utils/moodLog';
import { symptomStats } from '../utils/moodHistory';
import { foodDayInputs } from '../utils/nutritionStats';
import { retentionCutoff, retentionLabel } from '../utils/retention';
import {
  buildMoodDays,
  categoryMoodContrasts,
  contextTagMoodContrasts,
  describeHealthInsight,
  foodMoodContrasts,
  healthInsight,
  metricAverage,
  milestoneMoodContrast,
  moodBarFraction,
  moodByTimeOfDay,
  moodCompletionInsight,
  moodSummary,
  nutrientFindings,
  symptomMoodContrasts,
  taskContrastTitles,
  taskMoodContrasts,
  MIN_PAIRED_DAYS,
} from '../utils/moodInsights';
import { ScreenHeader } from '../components/ScreenHeader';
import { HubPills } from '../components/HubPills';
import { EmptyState } from '../components/EmptyState';
import { InlineAction } from '../components/InlineAction';
import { MoodLogSheet } from '../components/MoodLogSheet';
import { MoodEntryRow } from '../components/MoodEntryRow';
import { MoodExportSheet } from '../components/MoodExportSheet';
import { MilestoneSheet } from '../components/MilestoneSheet';
import { ContrastBars } from '../components/ContrastBars';

/** How many days the chart shows. Two weeks fits a phone width at a readable bar. */
const CHART_DAYS = 14;

const BAR_HEIGHT = 90;

/**
 * The mood and symptom log, and what it looks like against your tasks.
 *
 * A drawer-only screen, the same shape Waiting and Drift take: a history that
 * wants reading in aggregate rather than a list of things to work through.
 *
 * The insights half is the reason this isn't just a list. Every row in it is a
 * join between the mood log and the task history, which is the one thing a
 * standalone mood tracker can never do — see `moodInsights.ts`, which holds
 * every rule about what those numbers are allowed to claim. This screen's job
 * is to render them without adding a claim of its own: no arrows implying
 * causation, no advice, and the sample size printed beside every comparison so
 * a finding built on eleven days reads as one.
 */
export function MoodScreen() {
  const navigation = useNavigation<{ navigate: (screen: string, params?: object) => void }>();
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const insets = useSafeAreaInsets();
  const tabBarHeight = useBottomTabBarHeight();

  const logs = useMoodStore(s => s.logs);
  const removeLog = useMoodStore(s => s.removeLog);
  const milestones = useMilestoneStore(s => s.milestones);
  const tasks = useTaskStore(s => s.tasks);
  // Apple Health's trailing window, read on demand rather than on the app's
  // foreground triggers: it is a wider query than the Today reading and only
  // this screen wants it. Null until it has been looked for, which is a third
  // answer and not the same as an empty one.
  const healthReadEnabled = useSettingsStore(s => s.healthReadEnabled);
  const healthHistory = useHealthStore(s => s.history);
  const refreshHealthHistory = useHealthStore(s => s.refreshHistory);
  useEffect(() => {
    if (healthReadEnabled) void refreshHealthHistory();
  }, [healthReadEnabled, refreshHealthHistory]);
  // The food log's own window, kept apart from the day view's and from Stats'
  // — see `loadInsightWindow`. Loaded on focus rather than on mount for the
  // reason Stats loads its own that way: a blurred tab stays mounted for the
  // life of the session, so a window computed at mount would still end on the
  // day the app was opened.
  //
  // Gated on `kitchenEnabled` exactly as `healthReadEnabled` gates the readings
  // above. The whole food half of the app is behind that switch, and reading a
  // log the user has switched away from to tell them about their eating is the
  // same mistake as reading Health without permission.
  const kitchenEnabled = useSettingsStore(s => s.kitchenEnabled);
  const foodEntries = useFoodLogStore(s => s.insightEntries);
  const loadFoodInsightWindow = useFoodLogStore(s => s.loadInsightWindow);
  useFocusEffect(
    useCallback(() => {
      if (!kitchenEnabled) return;
      const today = getCurrentDayStart();
      loadFoodInsightWindow(
        dayKeyOf(addDays(today, -(FOOD_INSIGHT_DAYS - 1))),
        dayKeyOf(today),
      );
    }, [kitchenEnabled, loadFoodInsightWindow]),
  );

  const settings = useSettingsStore(useShallow(s => ({
    dayResetTime: s.dayResetTime,
    completedRetentionDays: s.completedRetentionDays,
    morningStart: s.morningStart,
    afternoonStart: s.afternoonStart,
    eveningStart: s.eveningStart,
    nightStart: s.nightStart,
  })));

  const [sheetOpen, setSheetOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [editing, setEditing] = useState<MoodLog | null>(null);
  const [milestoneSheetOpen, setMilestoneSheetOpen] = useState(false);
  const [editingMilestone, setEditingMilestone] = useState<Milestone | null>(null);

  // `dundundun://mood?log=1` — the daily check-in task's link button. Stamped
  // with the arrival time rather than a boolean, and tracked against what has
  // already been handled, so tapping the same row twice opens the sheet twice:
  // the same shape PeopleScreen's openPerson uses, and for the same reason.
  const route = useRoute<{
    key: string;
    name: string;
    params?: { openLog?: number; returnTo?: string };
  }>();
  const [handledOpenLog, setHandledOpenLog] = useState<number | undefined>(undefined);
  // Where to hand the user back once the sheet this opens closes — the tab
  // they tapped the check-in request from, carried by `resetToMood`'s
  // `returnTo` param. Cleared whenever the sheet is opened by hand (`openNew`,
  // `openEdit`) so a manual visit never inherits a stale value left over from
  // an earlier link tap.
  const [returnTo, setReturnTo] = useState<string | undefined>(undefined);
  useEffect(() => {
    if (route.params?.openLog === undefined || route.params.openLog === handledOpenLog) return;
    setHandledOpenLog(route.params.openLog);
    setReturnTo(route.params.returnTo);
    setEditing(null);
    setSheetOpen(true);
  }, [route.params?.openLog, route.params?.returnTo, handledOpenLog]);

  const todayKey = dayKeyOf(getCurrentDayStart());

  // The first day the task record is complete for. `completedRetentionDays`
  // deletes completed rows on a schedule while the mood log keeps every entry
  // forever, so without this the days behind the window read as days on which
  // nothing was finished — see `MoodDay.completed`. Null when retention is off,
  // which is the default and leaves every read exactly as it was.
  const completionsKnownFrom = useMemo(() => {
    const cutoff = retentionCutoff(
      settings.completedRetentionDays, new Date(), settings.dayResetTime,
    );
    return cutoff === null ? null : dayKeyOf(cutoff);
  }, [settings.completedRetentionDays, settings.dayResetTime]);

  // Only the days the log can speak for — `foodDayInputs` drops the rest, and
  // the switch drops the lot. Empty rather than absent when the kitchen half is
  // off, so every food read below reports nothing to say rather than being
  // asked not to look.
  const foodDays = useMemo(
    () => (kitchenEnabled ? foodDayInputs(foodEntries) : []),
    [kitchenEnabled, foodEntries],
  );

  const days = useMemo(
    () => buildMoodDays(
      logs, tasks, settings.dayResetTime, healthHistory ?? [], completionsKnownFrom, foodDays,
    ),
    [logs, tasks, settings.dayResetTime, healthHistory, completionsKnownFrom, foodDays],
  );

  // Days the mood log covers that the task history no longer does. Said out
  // loud on the screen rather than left to quietly weaken the numbers: a
  // correlation drawn over half a record is a different claim from one drawn
  // over all of it, and the person who set the window is the only one who can
  // decide whether that matters.
  const clippedDays = useMemo(() => {
    if (completionsKnownFrom === null) return 0;
    return days.filter(d => d.dayKey < completionsKnownFrom && d.mood !== null).length;
  }, [days, completionsKnownFrom]);

  // Every pairing the data can actually speak to, in the order they read: what
  // you got done first, because that is the join no health app can make, and
  // mood second even though this is the Mood screen — the card above it already
  // covers mood against what you finish, so leading with mood here would be the
  // same sentence twice with a different noun in it.
  //
  // A pairing below MIN_PAIRED_DAYS describes as null and drops out, so a
  // person with steps but no Watch sees one line rather than two empty ones.
  const healthFindings = useMemo(() => {
    if (!healthReadEnabled || healthHistory === null) return [];
    const rows: { key: string; text: string }[] = [];
    for (const metric of ['steps', 'sleepHours'] as const) {
      for (const against of ['completed', 'mood'] as const) {
        const text = describeHealthInsight(healthInsight(days, metric, against));
        if (text) rows.push({ key: `${metric}-${against}`, text });
      }
    }
    return rows;
  }, [days, healthReadEnabled, healthHistory]);

  // The two averages, over the days that carry a reading rather than over the
  // window — an absent day is absent here as everywhere else.
  const averageSteps = useMemo(
    () => (healthReadEnabled ? metricAverage(days, 'steps') : null),
    [days, healthReadEnabled],
  );
  const averageSleep = useMemo(
    () => (healthReadEnabled ? metricAverage(days, 'sleepHours') : null),
    [days, healthReadEnabled],
  );

  // Ordering, and the one-line collapse for a nutrient with nothing to report,
  // both live in `nutrientFindings` — it is copy, so it is testable there
  // rather than assembled here. Anything under MIN_PAIRED_DAYS drops out, so a
  // nutrient nobody's entries state consistently leaves no empty row behind.
  const foodFindings = useMemo(
    () => (kitchenEnabled ? nutrientFindings(days) : []),
    [days, kitchenEnabled],
  );

  // The two figures the food log itself leads with (see `SUMMARY_KEYS`), over
  // the days that could speak for themselves rather than over the window.
  const averageCalories = useMemo(
    () => (kitchenEnabled ? metricAverage(days, 'calorieKcal') : null),
    [days, kitchenEnabled],
  );
  const averageProtein = useMemo(
    () => (kitchenEnabled ? metricAverage(days, 'proteinG') : null),
    [days, kitchenEnabled],
  );

  // A contrast is keyed on the lowercased label, which is not what the user
  // typed — same resolution the symptom rows make, and the same reason: showing
  // "porridge" to somebody who has been writing "Porridge" all month reads as
  // the app having rewritten their entry.
  const foodNames = useMemo(() => {
    const names = new Map<string, string>();
    for (const entry of foodEntries) {
      const label = entry.label.trim();
      if (label) names.set(label.toLowerCase(), label);
    }
    return names;
  }, [foodEntries]);
  const foodRows = useMemo(
    () => (kitchenEnabled ? foodMoodContrasts(days).slice(0, 4).map(row => ({
      ...row,
      label: foodNames.get(row.label) ?? row.label,
    })) : []),
    [days, foodNames, kitchenEnabled],
  );
  const summary = useMemo(() => moodSummary(days, todayKey), [days, todayKey]);
  const completion = useMemo(() => moodCompletionInsight(days), [days]);
  const categoryRows = useMemo(() => categoryMoodContrasts(days).slice(0, 4), [days]);
  // A contrast is keyed on the lowercased match key (see symptomKey), which is
  // not what the user typed — rendering it raw shows "headache" to somebody who
  // has been writing "Headache" all fortnight. The vocabulary holds the casing
  // they actually used, so the key is resolved back through it for display and
  // only falls back to itself if the name has since left the log.
  const symptomNames = useMemo(() => {
    const names = new Map<string, string>();
    for (const name of symptomVocabulary(logs)) names.set(symptomKey(name), name);
    return names;
  }, [logs]);
  const symptomRows = useMemo(
    () => symptomMoodContrasts(days).slice(0, 4).map(row => ({
      ...row,
      // The match key kept alongside the display name, so the row can open the
      // symptom's own page — which is addressed by key, not by what it is
      // called this week.
      key: row.label,
      label: symptomNames.get(row.label) ?? row.label,
    })),
    [days, symptomNames],
  );

  // Every symptom the log holds, most days first — the directory the contrast
  // rows above cannot be. Those need ten paired days and show the top four by
  // gap size, so without this a symptom logged three times has no page reachable
  // from anywhere.
  const symptomList = useMemo(() => symptomStats(logs), [logs]);

  // Mood on the days one repeating task got done, against the days it didn't.
  // The app's answer to medication tracking: a tablet, a supplement or a walk
  // is already a repeating task here, so this needs no second list to keep.
  const taskRows = useMemo(() => {
    const titles = taskContrastTitles(tasks);
    return taskMoodContrasts(days).slice(0, 4).map(row => ({
      ...row,
      label: titles.get(row.label) ?? row.label,
    }));
  }, [days, tasks]);

  // Mood before a milestone's date, against on and after it. Unlike every
  // contrast above, this isn't a with/without split over a vocabulary of
  // labels — each milestone names its own single split point, so every row is
  // computed independently rather than sliced from one ranked list.
  const milestoneRows = useMemo(
    () => milestones.map(milestone => ({
      milestone,
      contrast: milestoneMoodContrast(days, dayKeyOf(new Date(milestone.date))),
    })),
    [days, milestones],
  );

  // Same key-to-casing resolution as symptomNames, for the same reason: a
  // contrast is keyed on the lowercased match, not what the user typed.
  const contextTagNames = useMemo(() => {
    const names = new Map<string, string>();
    for (const name of contextTagVocabulary(logs)) names.set(contextTagKey(name), name);
    return names;
  }, [logs]);
  const contextTagRows = useMemo(
    () => contextTagMoodContrasts(days).slice(0, 4).map(row => ({
      ...row,
      label: contextTagNames.get(row.label) ?? row.label,
    })),
    [days, contextTagNames],
  );
  const timeRows = useMemo(
    () => moodByTimeOfDay(logs, iso => segmentOf(new Date(iso), {
      morningStart: settings.morningStart,
      afternoonStart: settings.afternoonStart,
      eveningStart: settings.eveningStart,
      nightStart: settings.nightStart,
    })),
    [logs, settings.morningStart, settings.afternoonStart, settings.eveningStart, settings.nightStart],
  );

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

  const recent = useMemo(() => logs.slice(0, 20), [logs]);

  const openNew = () => { haptics.tap(); setReturnTo(undefined); setEditing(null); setSheetOpen(true); };
  const openEdit = (log: MoodLog) => { haptics.tap(); setReturnTo(undefined); setEditing(log); setSheetOpen(true); };
  const closeSheet = () => {
    setSheetOpen(false);
    setEditing(null);
    if (returnTo) {
      navigationRef.navigate(returnTo);
      setReturnTo(undefined);
    }
  };

  const confirmDelete = (log: MoodLog) => {
    Alert.alert(
      'Delete this entry?',
      'It will be removed from your history and from every number on this screen.',
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

  const openNewMilestone = () => { haptics.tap(); setEditingMilestone(null); setMilestoneSheetOpen(true); };
  const openEditMilestone = (milestone: Milestone) => {
    haptics.tap();
    setEditingMilestone(milestone);
    setMilestoneSheetOpen(true);
  };
  const closeMilestoneSheet = () => { setMilestoneSheetOpen(false); setEditingMilestone(null); };

  const daysToGo = Math.max(0, MIN_PAIRED_DAYS - completion.dayCount);

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <ScreenHeader
        title="Mood"
        subtitle={summary.loggedDays > 0
          ? `${summary.loggedDays} ${summary.loggedDays === 1 ? 'day' : 'days'} logged`
          : undefined}
        actions={[
          ...(logs.length > 0 ? [{
            icon: 'share-outline' as const,
            onPress: () => { haptics.tap(); setExportOpen(true); },
            accessibilityLabel: 'Export your mood log',
          }] : []),
          {
            icon: 'add-circle-outline' as const,
            onPress: openNew,
            accessibilityLabel: 'Log how you\'re feeling',
          },
        ]}
      />
      <HubPills hub="history" active="Mood" />

      {logs.length === 0 ? (
        <EmptyState
          icon="happy-outline"
          title="Nothing logged yet"
          subtitle="Record how you're feeling and anything you want to keep track of. Once there are a couple of weeks of it, this screen shows how it lines up with what you get done."
          actionLabel="Log how you're doing"
          onAction={openNew}
        />
      ) : (
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={[styles.scrollContent, { paddingBottom: tabBarHeight + spacing.xl }]}
        >
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

          <Text style={styles.sectionTitle}>THE LAST TWO WEEKS</Text>
          <View style={styles.card}>
            <View style={styles.chartInner}>
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
                          height: mood === null ? 2 : `${Math.max(6, (mood / 5) * 100)}%`,
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
            <Text style={styles.chartCaption}>
              A flat line is a day with nothing logged.
            </Text>
          </View>

          <Text style={styles.sectionTitle}>MOOD AND WHAT YOU FINISH</Text>
          <View style={styles.card}>
            {completion.strength === null || completion.direction === null ? (
              <Text style={styles.pending}>
                {daysToGo > 0
                  ? `Keep logging. After ${daysToGo} more ${daysToGo === 1 ? 'day' : 'days'} with a mood on ${daysToGo === 1 ? 'it' : 'them'}, this compares your mood against what you got done.`
                  : 'Not enough variation yet to compare. This fills in once your days differ a little more.'}
              </Text>
            ) : completion.strength === 'none' ? (
              <Text style={styles.finding}>
                No clear pattern between your mood and how much you finish, across {completion.dayCount} days.
              </Text>
            ) : (
              <Text style={styles.finding}>
                You tend to finish {completion.direction === 'more' ? 'more' : 'fewer'} tasks on
                {' '}better days. A {completion.strength} pattern across {completion.dayCount} days.
              </Text>
            )}
            {completion.completedOnGoodDays !== null && completion.completedOnLowDays !== null && (
              <View style={styles.splitRow}>
                <View
                  style={styles.splitCell}
                  accessible
                  accessibilityLabel={`${completion.completedOnGoodDays.toFixed(1)} tasks finished a day when your mood was good`}
                >
                  <Text style={styles.splitValue}>{completion.completedOnGoodDays.toFixed(1)}</Text>
                  <Text style={styles.splitLabel}>a day when good</Text>
                </View>
                <View
                  style={styles.splitCell}
                  accessible
                  accessibilityLabel={`${completion.completedOnLowDays.toFixed(1)} tasks finished a day when your mood was low`}
                >
                  <Text style={styles.splitValue}>{completion.completedOnLowDays.toFixed(1)}</Text>
                  <Text style={styles.splitLabel}>a day when low</Text>
                </View>
              </View>
            )}
            {clippedDays > 0 && (
              <Text style={styles.chartCaption}>
                {clippedDays} earlier logged {clippedDays === 1 ? 'day is' : 'days are'} left out
                here. Completed tasks are only kept for
                {' '}{retentionLabel(settings.completedRetentionDays).toLowerCase()}, so there is
                nothing left to compare those days against. Your entries are still there.
              </Text>
            )}
          </View>

          {(healthFindings.length > 0 || averageSteps !== null || averageSleep !== null) && (
            <>
              <Text style={styles.sectionTitle}>MOVEMENT AND SLEEP</Text>
              <View style={styles.card}>
                {/* Wrapped rather than putting a margin on `finding` itself:
                    the card above renders exactly one of those and would gain a
                    gap it doesn't want above its own split row, which already
                    carries spacing.md. This card is the only one that stacks
                    them. */}
                <View style={styles.findings}>
                  {healthFindings.map(finding => (
                    <Text key={finding.key} style={styles.finding}>{finding.text}</Text>
                  ))}
                </View>
                {(averageSteps !== null || averageSleep !== null) && (
                  <View style={styles.splitRow}>
                    {averageSteps !== null && (
                      <View style={styles.splitCell}>
                        <Text style={styles.splitValue}>{Math.round(averageSteps).toLocaleString()}</Text>
                        <Text style={styles.splitLabel}>steps a day</Text>
                      </View>
                    )}
                    {averageSleep !== null && (
                      <View style={styles.splitCell}>
                        <Text style={styles.splitValue}>{averageSleep.toFixed(1)}</Text>
                        <Text style={styles.splitLabel}>hours asleep</Text>
                      </View>
                    )}
                  </View>
                )}
                <Text style={styles.chartCaption}>
                  From Apple Health, over the last {HEALTH_HISTORY_DAYS} days, counting only the
                  {' '}days you logged. These are patterns between two numbers, not causes.
                </Text>
              </View>
            </>
          )}

          {(foodFindings.length > 0 || averageCalories !== null || averageProtein !== null) && (
            <>
              <Text style={styles.sectionTitle}>EATING</Text>
              <View style={styles.card}>
                <View style={styles.findings}>
                  {foodFindings.map(finding => (
                    <Text key={finding.key} style={styles.finding}>{finding.text}</Text>
                  ))}
                </View>
                {(averageCalories !== null || averageProtein !== null) && (
                  <View style={styles.splitRow}>
                    {averageCalories !== null && (
                      <View style={styles.splitCell}>
                        <Text style={styles.splitValue}>{Math.round(averageCalories).toLocaleString()}</Text>
                        <Text style={styles.splitLabel}>calories a day</Text>
                      </View>
                    )}
                    {averageProtein !== null && (
                      <View style={styles.splitCell}>
                        <Text style={styles.splitValue}>{Math.round(averageProtein)}g</Text>
                        <Text style={styles.splitLabel}>protein a day</Text>
                      </View>
                    )}
                  </View>
                )}
                {/* The two-meal bar is said out loud rather than left as an
                    invisible filter. It is the one gate here somebody could
                    otherwise be surprised by, and it is also the answer to "why
                    does this say fewer days than my food log does". */}
                <Text style={styles.chartCaption}>
                  From your food log, over the last {FOOD_INSIGHT_DAYS} days, counting only the days
                  {' '}you logged at least two meals. A day logged more thinly says less about what
                  {' '}you ate than it looks like it does. These are patterns between two numbers,
                  {' '}not causes.
                </Text>
              </View>
            </>
          )}

          {foodRows.length > 0 && (
            <>
              <Text style={styles.sectionTitle}>MOOD BY WHAT YOU ATE</Text>
              <View style={styles.card}>
                {foodRows.map((row, i) => (
                  <ContrastBars
                    key={row.label}
                    first={i === 0}
                    label={row.label}
                    withLabel="Had it"
                    withoutLabel="Didn’t"
                    withFraction={moodBarFraction(row.moodWith)}
                    withoutFraction={moodBarFraction(row.moodWithout)}
                    withText={row.moodWith.toFixed(1)}
                    withoutText={row.moodWithout.toFixed(1)}
                    accessibilityLabel={`${row.label}, average mood ${row.moodWith.toFixed(1)} on days you had it, ${row.moodWithout.toFixed(1)} on days you didn't`}
                  />
                ))}
                <Text style={styles.chartCaption}>
                  Your average mood on days you logged that food, against days you logged food
                  {' '}without it. Both sides are days you logged at least two meals.
                </Text>
              </View>
            </>
          )}

          {categoryRows.length > 0 && (
            <>
              <Text style={styles.sectionTitle}>MOOD BY KIND OF WORK</Text>
              <View style={styles.card}>
                {categoryRows.map((row, i) => (
                  <ContrastBars
                    key={row.label}
                    first={i === 0}
                    label={row.label}
                    withLabel="Did some"
                    withoutLabel="Didn’t"
                    withFraction={moodBarFraction(row.moodWith)}
                    withoutFraction={moodBarFraction(row.moodWithout)}
                    withText={row.moodWith.toFixed(1)}
                    withoutText={row.moodWithout.toFixed(1)}
                    // "1.8 vs 3.9" says nothing about what is being compared,
                    // and the caption carrying that is a separate element three
                    // rows down. Each row states its own comparison instead.
                    accessibilityLabel={`${row.label}, average mood ${row.moodWith.toFixed(1)} on days you finished something in that category, ${row.moodWithout.toFixed(1)} on days you didn't`}
                  />
                ))}
                <Text style={styles.chartCaption}>
                  Your average mood on days you finished something in that category, against days you didn't.
                </Text>
              </View>
            </>
          )}

          {taskRows.length > 0 && (
            <>
              <Text style={styles.sectionTitle}>MOOD AND YOUR REPEATING TASKS</Text>
              <View style={styles.card}>
                {taskRows.map((row, i) => (
                  <ContrastBars
                    key={row.label}
                    first={i === 0}
                    label={row.label}
                    withLabel="Did it"
                    withoutLabel="Didn’t"
                    withFraction={moodBarFraction(row.moodWith)}
                    withoutFraction={moodBarFraction(row.moodWithout)}
                    withText={row.moodWith.toFixed(1)}
                    withoutText={row.moodWithout.toFixed(1)}
                    accessibilityLabel={`${row.label}, average mood ${row.moodWith.toFixed(1)} on the ${row.withDays} days you finished it, ${row.moodWithout.toFixed(1)} on the ${row.withoutDays} days you didn't`}
                  />
                ))}
                <Text style={styles.chartCaption}>
                  Your average mood on days you finished a repeating task, against days you
                  didn't. Two averages side by side, not a cause.
                </Text>
              </View>
            </>
          )}

          {symptomRows.length > 0 && (
            <>
              <Text style={styles.sectionTitle}>MOOD WITH SYMPTOMS</Text>
              <View style={styles.card}>
                {symptomRows.map((row, i) => (
                  <ContrastBars
                    key={row.label}
                    first={i === 0}
                    label={row.label}
                    withLabel="Had it"
                    withoutLabel="Didn’t"
                    withFraction={moodBarFraction(row.moodWith)}
                    withoutFraction={moodBarFraction(row.moodWithout)}
                    withText={row.moodWith.toFixed(1)}
                    withoutText={row.moodWithout.toFixed(1)}
                    onPress={() => {
                      haptics.tap();
                      navigation.navigate('SymptomDetail', { symptomKey: row.key });
                    }}
                    accessibilityLabel={`${row.label}, average mood ${row.moodWith.toFixed(1)} on days you logged it, ${row.moodWithout.toFixed(1)} on days you didn't`}
                  />
                ))}
                <Text style={styles.chartCaption}>
                  Your average mood on days you logged it, against days you didn't.
                </Text>
              </View>
            </>
          )}

          {contextTagRows.length > 0 && (
            <>
              <Text style={styles.sectionTitle}>MOOD WITH CONTEXT</Text>
              <View style={styles.card}>
                {contextTagRows.map((row, i) => (
                  <ContrastBars
                    key={row.label}
                    first={i === 0}
                    label={row.label}
                    withLabel="Applied"
                    withoutLabel="Didn’t"
                    withFraction={moodBarFraction(row.moodWith)}
                    withoutFraction={moodBarFraction(row.moodWithout)}
                    withText={row.moodWith.toFixed(1)}
                    withoutText={row.moodWithout.toFixed(1)}
                    accessibilityLabel={`${row.label}, average mood ${row.moodWith.toFixed(1)} on days it applied, ${row.moodWithout.toFixed(1)} on days it didn't`}
                  />
                ))}
                <Text style={styles.chartCaption}>
                  Your average mood on days a tag applied, against days it didn't.
                </Text>
              </View>
            </>
          )}

          {timeRows.length > 1 && (
            <>
              <Text style={styles.sectionTitle}>MOOD BY TIME OF DAY</Text>
              <View style={styles.card}>
                {timeRows.map(row => (
                  <View
                    key={row.segment}
                    style={styles.contrastRow}
                    accessible
                    accessibilityLabel={`${row.segment}, average mood ${row.mood.toFixed(1)} across ${row.entryCount} ${row.entryCount === 1 ? 'entry' : 'entries'}`}
                  >
                    <Text style={styles.contrastLabel}>
                      {row.segment.charAt(0).toUpperCase() + row.segment.slice(1)}
                    </Text>
                    <Text style={styles.contrastValue}>
                      {row.mood.toFixed(1)} · {row.entryCount} {row.entryCount === 1 ? 'entry' : 'entries'}
                    </Text>
                  </View>
                ))}
              </View>
            </>
          )}

          <Text style={styles.sectionTitle}>SYMPTOMS</Text>
          {symptomList.length === 0 ? (
            <View style={styles.card}>
              <Text style={styles.pending}>
                Nothing logged yet. Add a symptom to an entry and it gets its own page here,
                with how often it happens and how bad it gets.
              </Text>
            </View>
          ) : (
            <View style={styles.card}>
              {symptomList.map(stat => (
                <TouchableOpacity
                  key={stat.key}
                  style={styles.linkRow}
                  activeOpacity={interaction.activeOpacity}
                  onPress={() => {
                    haptics.tap();
                    navigation.navigate('SymptomDetail', { symptomKey: stat.key });
                  }}
                  accessibilityRole="button"
                  accessibilityLabel={`${stat.name}, ${stat.dayCount} ${stat.dayCount === 1 ? 'day' : 'days'}, last logged ${format(dayKeyToDate(stat.lastDayKey), 'MMMM d')}`}
                >
                  <View style={styles.linkBody}>
                    <Text style={styles.linkLabel} numberOfLines={1}>{stat.name}</Text>
                    <Text style={styles.linkMeta}>
                      {stat.dayCount} {stat.dayCount === 1 ? 'day' : 'days'} · last on{' '}
                      {format(dayKeyToDate(stat.lastDayKey), 'MMM d')}
                    </Text>
                  </View>
                  <Ionicons name="chevron-forward" size={16} color={colors.textTertiary} />
                </TouchableOpacity>
              ))}
            </View>
          )}

          <Text style={styles.sectionTitle}>MILESTONES</Text>
          <View style={styles.card}>
            {milestoneRows.length === 0 ? (
              <Text style={[styles.pending, styles.milestoneAddSpacing]}>
                Mark the day something changed (starting a medicine, a new
                job) and compare your mood before and after it.
              </Text>
            ) : (
              <View style={styles.milestoneAddSpacing}>
                {milestoneRows.map(({ milestone, contrast }, i) => (
                  contrast ? (
                    <ContrastBars
                      key={milestone.id}
                      first={i === 0}
                      label={milestone.label}
                      withLabel="Before"
                      withoutLabel="After"
                      withFraction={moodBarFraction(contrast.moodBefore)}
                      withoutFraction={moodBarFraction(contrast.moodAfter)}
                      withText={contrast.moodBefore.toFixed(1)}
                      withoutText={contrast.moodAfter.toFixed(1)}
                      onPress={() => openEditMilestone(milestone)}
                      accessibilityLabel={`${milestone.label}, average mood ${contrast.moodBefore.toFixed(1)} before ${format(new Date(milestone.date), 'MMMM d')}, ${contrast.moodAfter.toFixed(1)} on and after`}
                    />
                  ) : (
                    <TouchableOpacity
                      key={milestone.id}
                      style={[styles.linkRow, i > 0 && styles.milestoneRowGap]}
                      activeOpacity={interaction.activeOpacity}
                      onPress={() => openEditMilestone(milestone)}
                      accessibilityRole="button"
                      accessibilityLabel={`${milestone.label}, ${format(new Date(milestone.date), 'MMMM d, yyyy')}, not enough days logged yet to compare`}
                    >
                      <View style={styles.linkBody}>
                        <Text style={styles.linkLabel} numberOfLines={1}>{milestone.label}</Text>
                        <Text style={styles.linkMeta}>
                          {format(new Date(milestone.date), 'MMM d, yyyy')} · not enough days yet
                        </Text>
                      </View>
                      <Ionicons name="chevron-forward" size={16} color={colors.textTertiary} />
                    </TouchableOpacity>
                  )
                ))}
              </View>
            )}
            <InlineAction
              label="Add milestone"
              onPress={openNewMilestone}
              variant={milestoneRows.length > 0 ? 'neutral' : 'accent'}
            />
            {milestoneRows.some(r => r.contrast) && (
              <Text style={styles.chartCaption}>
                Average mood before a milestone's date, against on and after it.
              </Text>
            )}
          </View>

          <Text style={styles.sectionTitle}>RECENT ENTRIES</Text>
          {recent.map(log => (
            <MoodEntryRow
              key={log.id}
              log={log}
              onPress={() => openEdit(log)}
              onLongPress={() => confirmDelete(log)}
            />
          ))}
          {logs.length > recent.length && (
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
        </ScrollView>
      )}

      <MoodLogSheet
        visible={sheetOpen}
        editing={editing}
        onClose={closeSheet}
      />

      <MoodExportSheet
        visible={exportOpen}
        logs={logs}
        onClose={() => setExportOpen(false)}
      />

      <MilestoneSheet
        visible={milestoneSheetOpen}
        milestone={editingMilestone}
        onClose={closeMilestoneSheet}
      />
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
  statRow: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.lg },
  statCell: {
    flex: 1,
    backgroundColor: colors.bgSecondary,
    borderRadius: radius.lg,
    paddingVertical: spacing.md,
    alignItems: 'center',
  },
  statValue: { fontSize: font.xl, fontWeight: fontWeight.bold, color: colors.text },
  statLabel: { fontSize: font.xs, color: colors.textSecondary, marginTop: 2, textAlign: 'center' },
  sectionTitle: {
    fontSize: font.xs,
    fontWeight: fontWeight.semibold,
    color: colors.textSecondary,
    letterSpacing: 0.8,
    marginBottom: spacing.sm,
  },
  card: {
    backgroundColor: colors.bgSecondary,
    borderRadius: radius.lg,
    padding: spacing.md,
    marginBottom: spacing.lg,
  },
  chartInner: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end' },
  chartCol: { flex: 1, alignItems: 'center' },
  barTrack: { width: 12, height: BAR_HEIGHT, justifyContent: 'flex-end' },
  bar: { width: 12, borderRadius: 4 },
  barLabel: { marginTop: 4, color: colors.textTertiary, fontSize: 10, fontWeight: '500' },
  barLabelToday: { color: colors.accent, fontWeight: fontWeight.semibold },
  chartCaption: { fontSize: font.xs, color: colors.textTertiary, marginTop: spacing.sm },
  pending: { fontSize: font.sm, color: colors.textSecondary, lineHeight: 20 },
  finding: { fontSize: font.md, color: colors.text, lineHeight: 22 },
  findings: { gap: spacing.sm },
  splitRow: { flexDirection: 'row', marginTop: spacing.md },
  splitCell: { flex: 1, alignItems: 'center' },
  splitValue: { fontSize: font.lg, fontWeight: fontWeight.bold, color: colors.text },
  splitLabel: { fontSize: font.xs, color: colors.textSecondary, marginTop: 2 },
  contrastRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing.xs,
    gap: spacing.sm,
  },
  contrastLabel: { flex: 1, fontSize: font.sm, color: colors.text },
  contrastValue: { fontSize: font.sm, color: colors.textSecondary, fontWeight: fontWeight.medium },
  linkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.sm,
  },
  linkBody: { flex: 1 },
  linkLabel: { fontSize: font.sm, color: colors.text },
  linkMeta: { fontSize: font.xs, color: colors.textSecondary, marginTop: 2 },
  // Space before the "Add milestone" action below, whichever branch (the
  // empty-state text or the row list) sits above it.
  milestoneAddSpacing: { marginBottom: spacing.md },
  // Between one pending milestone row and the next — ContrastBars rows carry
  // their own gap, but a plain TouchableOpacity row needs its own.
  milestoneRowGap: { marginTop: spacing.md },
  seeAllRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    paddingVertical: spacing.md,
  },
  seeAllText: { fontSize: font.sm, color: colors.accent, fontWeight: fontWeight.medium },
});
