// What the mood log says against your tasks, Health, food and workouts, each comparison with
// its sample size beside it (see docs/arch/mood-log.md). Split out of MoodScreen so the log
// (today, the chart, recent entries) stays short; the rules about what these numbers may claim
// are in `moodInsights.ts`. Grep a landmark rather than reading it start to finish:
//
//   ==== <name> ====        the section banners through the logic half
//   makeStyles              styles, at the bottom
import { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { navigateToTab } from '../navigation/navigationRef';
import { useBottomTabBarHeight } from '@react-navigation/bottom-tabs';
import { addDays } from 'date-fns/addDays';
import { useShallow } from 'zustand/react/shallow';
import { useMoodStore } from '../store/useMoodStore';
import { useTaskStore } from '../store/useTaskStore';
import { useSettingsStore } from '../store/useSettingsStore';
import { useHealthStore, HEALTH_HISTORY_DAYS } from '../store/useHealthStore';
import { useFoodLogStore, FOOD_INSIGHT_DAYS } from '../store/useFoodLogStore';
import { useColors } from '../theme/ThemeContext';
import { spacing, radius, font, fontWeight, animation, type Colors } from '../theme';
import { useTextScale } from '../hooks/useTextScale';
import { AnimatedBarFill } from '../components/AnimatedBarFill';
import { haptics } from '../utils/haptics';
import { dayKeyOf, getCurrentDayStart } from '../utils/dateUtils';
import { segmentOf } from '../utils/rhythms';
import { contextTagKey, contextTagVocabulary, symptomKey, symptomVocabulary } from '../utils/moodLog';
import { foodDayInputs, foodKeyNames } from '../utils/nutritionStats';
import { useGroceryStore } from '../store/useGroceryStore';
import { useRecipeStore } from '../store/useRecipeStore';
import { retentionCutoff, retentionLabel } from '../utils/retention';
import { buildMoodDays, categoryMoodContrasts, contextTagMoodContrasts, finishedDaysAverage, foodMoodContrasts, healthFindings, metricAverage, moodBarFraction, contrastBarPercent, moodByTimeOfDay, moodCompletionInsight, moodSummary, nutrientFindings, symptomMoodContrasts, taskContrastTitles, taskMoodContrasts, trainingDayMoodContrast, MIN_PAIRED_DAYS } from '../utils/moodInsights';
import { useWorkoutStore } from '../store/useWorkoutStore';
import { trainingDays } from '../utils/workoutRecords';
import { ScreenHeader } from '../components/ScreenHeader';
import { usePullToSearch } from '../hooks/usePullToSearch';
import { HubPills } from '../components/HubPills';
import { EmptyState } from '../components/EmptyState';
import { WideScroll } from '../components/WideScroll';
import { InlineAction } from '../components/InlineAction';
import { animateLayout } from '../utils/layoutAnimation';
import { joinAnd } from '../utils/workoutProgression';
import { ContrastBars } from '../components/ContrastBars';
import { capitalize } from '../utils/capitalize';
import { useListScrollToTop } from '../hooks/useListScrollToTop';
import { ScrollToTopButton } from '../components/ScrollToTopButton';

/** Repeating-task rows shown before the rest fold behind Show all. */
const TASK_ROWS_SHOWN = 4;

/**
 * What the mood log looks like against your tasks, Health, food and workouts.
 *
 * Every row here is a join between the mood log and another record, which is the one thing a
 * standalone mood tracker can never do. This screen's job is to render them without adding a
 * claim of its own: no arrows implying causation, no advice, and the sample size printed beside
 * every comparison so a finding built on eleven days reads as one.
 */
export function MoodInsightsScreen() {
  // ==== screen setup ====
  const pullSearch = usePullToSearch();
  const navigation = useNavigation<{ navigate: (screen: string, params?: object) => void }>();
  const colors = useColors();
  const textScaleFactor = useTextScale();
  const styles = useMemo(() => makeStyles(colors, textScaleFactor), [colors, textScaleFactor]);
  const insets = useSafeAreaInsets();
  const scrollTop = useListScrollToTop();
  const tabBarHeight = useBottomTabBarHeight();

  // ==== store reads, and the Health and food windows loaded on demand ====
  const logs = useMoodStore(s => s.logs);
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

  // ==== settings and sheet state ====
  const settings = useSettingsStore(useShallow(s => ({
    dayResetTime: s.dayResetTime,
    completedRetentionDays: s.completedRetentionDays,
    morningStart: s.morningStart,
    afternoonStart: s.afternoonStart,
    eveningStart: s.eveningStart,
    nightStart: s.nightStart,
  })));


  const todayKey = dayKeyOf(getCurrentDayStart());

  // ==== which days count (retention, food days) ====
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

  // ==== Health and nutrition findings ====
  // Every pairing the data can actually speak to, in the order they read: what
  // you got done first, because that is the join no health app can make, and
  // mood second even though this is the Mood screen — the card above it already
  // covers mood against what you finish, so leading with mood here would be the
  // same sentence twice with a different noun in it.
  //
  // A pairing below MIN_PAIRED_DAYS describes as null and drops out, so a
  // person with steps but no Watch sees one line rather than two empty ones.
  const healthFindingRows = useMemo(
    () => (!healthReadEnabled || healthHistory === null ? [] : healthFindings(days)),
    [days, healthReadEnabled, healthHistory],
  );

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
  // the days that could speak for themselves rather than over the window, and
  // on Stats' terms: finished days only, and none below the paired-day floor.
  const averageCalories = useMemo(
    () => (kitchenEnabled ? finishedDaysAverage(days, 'calorieKcal', todayKey) : null),
    [days, kitchenEnabled, todayKey],
  );
  const averageProtein = useMemo(
    () => (kitchenEnabled ? finishedDaysAverage(days, 'proteinG', todayKey) : null),
    [days, kitchenEnabled, todayKey],
  );

  // ==== food contrasts ====
  // A contrast is keyed on what a food is (a catalog row, a recipe, or a
  // lowercased label for anything unlinked), none of which is what the user
  // reads. `foodKeyNames` names a row or recipe as it is called now and an
  // unlinked food as it was typed: showing "porridge" to somebody who has been
  // writing "Porridge" all month reads as the app having rewritten their entry.
  const groceryItems = useGroceryStore(s => s.items);
  const recipes = useRecipeStore(s => s.recipes);
  const foodNames = useMemo(() => foodKeyNames(foodEntries, {
    items: new Map(groceryItems.map(item => [item.id, item.name])),
    recipes: new Map(recipes.map(recipe => [recipe.id, recipe.name])),
  }), [foodEntries, groceryItems, recipes]);
  const foodRows = useMemo(
    () => (kitchenEnabled ? foodMoodContrasts(days).slice(0, 4).map(row => ({
      ...row,
      // The match key kept for the row's React key: two foods can share a
      // name (a Chili recipe and a chili catalog row) but never a key.
      key: row.label,
      label: foodNames.get(row.label) ?? row.label,
    })) : []),
    [days, foodNames, kitchenEnabled],
  );
  // ==== the other contrasts (training, work, symptoms, milestones, tags, time of day) ====
  // Mood on the days a workout was logged here, against the other days since
  // the first one. Only this app's own finished sessions: a day with no Health
  // workout is ambiguous, so Health's are never read (see
  // `trainingDayMoodContrast`). Off with the Workouts switch.
  const workoutsEnabled = useSettingsStore(s => s.workoutsEnabled);
  const workoutSessions = useWorkoutStore(s => s.sessions);
  const trainingRow = useMemo(
    () => (workoutsEnabled
      ? trainingDayMoodContrast(days, trainingDays(workoutSessions, settings.dayResetTime))
      : null),
    [days, workoutsEnabled, workoutSessions, settings.dayResetTime],
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

  // Mood on the days one repeating task got done, against the days it didn't.
  // The app's answer to medication tracking: a tablet, a supplement or a walk
  // is already a repeating task here, so this needs no second list to keep.
  // Every row, not a top slice: past the first few they fold behind Show all,
  // since the task someone is asking about is rarely the one with the biggest
  // gap. Tasks finished on exactly the same days arrive as one row.
  const taskRows = useMemo(() => {
    const titles = taskContrastTitles(tasks);
    return taskMoodContrasts(days).map(row => ({
      ...row,
      label: titles.get(row.label) ?? row.label,
      sameDays: row.sameDays.map(key => titles.get(key) ?? key)
        .sort((a, b) => a.localeCompare(b)),
    }));
  }, [days, tasks]);
  const [allTaskRows, setAllTaskRows] = useState(false);
  const shownTaskRows = allTaskRows ? taskRows : taskRows.slice(0, TASK_ROWS_SHOWN);

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


  const daysToGo = Math.max(0, MIN_PAIRED_DAYS - completion.dayCount);

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <ScreenHeader
        title="Insights"
        subtitle={summary.loggedDays > 0
          ? `${summary.loggedDays} ${summary.loggedDays === 1 ? 'day' : 'days'} logged`
          : undefined}
      />
      <HubPills hub="health" active="Insights" />

      {logs.length === 0 ? (
        <EmptyState
          icon="analytics-outline"
          title="Nothing to compare yet"
          subtitle="Log how you’re feeling for a couple of weeks. Your mood is then compared with what you get done, eat and sleep."
          actionLabel="Log how you’re doing"
          onAction={() => { haptics.tap(); navigateToTab('Mood', { openLog: Date.now() }); }}
        />
      ) : (
        <WideScroll
          ref={scrollTop.ref}
          {...scrollTop.listProps}
          refreshControl={pullSearch.refreshControl}
          style={styles.scroll}
          contentContainerStyle={[styles.scrollContent, { paddingBottom: Math.max(tabBarHeight + spacing.xl, scrollTop.clearance) }]}
        >
          <>
            <Text style={styles.sectionTitle}>MOOD AND WHAT YOU FINISH</Text>
            <View style={styles.card}>
              {completion.strength === null || completion.direction === null ? (
                <Text style={styles.pending}>
                  {daysToGo > 0
                    ? `Keep logging. After ${daysToGo} more ${daysToGo === 1 ? 'day' : 'days'} with a mood on ${daysToGo === 1 ? 'it' : 'them'}, this compares your mood against what you got done.`
                    : 'Not enough variation yet to compare. This fills in once your days differ more.'}
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
                    accessibilityLabel={`${completion.completedOnGoodDays.toFixed(1)} tasks finished on days when your mood was good`}
                  >
                    <Text style={styles.splitValue}>{completion.completedOnGoodDays.toFixed(1)}</Text>
                    <Text style={styles.splitLabel}>on good days</Text>
                  </View>
                  <View
                    style={styles.splitCell}
                    accessible
                    accessibilityLabel={`${completion.completedOnLowDays.toFixed(1)} tasks finished on days when your mood was low`}
                  >
                    <Text style={styles.splitValue}>{completion.completedOnLowDays.toFixed(1)}</Text>
                    <Text style={styles.splitLabel}>on low days</Text>
                  </View>
                </View>
              )}
              {clippedDays > 0 && (
                <Text style={styles.chartCaption}>
                  {clippedDays} earlier logged {clippedDays === 1 ? 'day is' : 'days are'} left out
                  here. Completed tasks are kept for
                  {' '}{retentionLabel(settings.completedRetentionDays).toLowerCase()}, so those days have
                  nothing to compare against. Your entries are still there.
                </Text>
              )}
            </View>
          </>

          {(healthFindingRows.length > 0 || averageSteps !== null || averageSleep !== null) && (
            <>
              <Text style={styles.sectionTitle}>MOVEMENT AND SLEEP</Text>
              <View style={styles.card}>
                {/* Wrapped rather than putting a margin on `finding` itself:
                    the card above renders exactly one of those and would gain a
                    gap it doesn't want above its own split row, which already
                    carries spacing.md. This card is the only one that stacks
                    them. */}
                <View style={styles.findings}>
                  {healthFindingRows.map(finding => (
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
                  From Apple Health, last {HEALTH_HISTORY_DAYS} days, logged days only. Patterns
                  {' '}aren’t cause and effect.
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
                  {' '}you logged at least two meals. A day with fewer says less about what
                  {' '}you ate.
                  {(averageCalories !== null || averageProtein !== null)
                    && ' The daily averages leave out today, which is still in progress.'}
                  {' '}These patterns don’t show cause and effect.
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
                    key={row.key}
                    first={i === 0}
                    label={row.label}
                    withLabel="Had it"
                    withoutLabel="Didn’t"
                    withFraction={moodBarFraction(row.moodWith)}
                    withoutFraction={moodBarFraction(row.moodWithout)}
                    withText={row.moodWith.toFixed(1)}
                    withoutText={row.moodWithout.toFixed(1)}
                    accessibilityLabel={`${row.label}, average mood ${row.moodWith.toFixed(1)} on days you had it, ${row.moodWithout.toFixed(1)} on days you didn’t`}
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
              <Text style={styles.sectionTitle}>MOOD BY TASK CATEGORY</Text>
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
                    accessibilityLabel={`${row.label}, average mood ${row.moodWith.toFixed(1)} on days you finished something in that category, ${row.moodWithout.toFixed(1)} on days you didn’t`}
                  />
                ))}
                <Text style={styles.chartCaption}>
                  Your average mood on days you finished something in that category, against days you didn’t.
                </Text>
              </View>
            </>
          )}

          {taskRows.length > 0 && (
            <>
              <Text style={styles.sectionTitle}>MOOD AND YOUR REPEATING TASKS</Text>
              <View style={styles.card}>
                {shownTaskRows.map((row, i) => (
                  <ContrastBars
                    key={row.label}
                    first={i === 0}
                    label={row.label}
                    detail={row.sameDays.length > 0 ? `Same days as ${joinAnd(row.sameDays)}` : undefined}
                    withLabel="Did it"
                    withoutLabel="Didn’t"
                    withFraction={moodBarFraction(row.moodWith)}
                    withoutFraction={moodBarFraction(row.moodWithout)}
                    withText={row.moodWith.toFixed(1)}
                    withoutText={row.moodWithout.toFixed(1)}
                    accessibilityLabel={`${row.label}${row.sameDays.length > 0 ? `, done on the same days as ${joinAnd(row.sameDays)}` : ''}, average mood ${row.moodWith.toFixed(1)} on the ${row.withDays} days you finished it, ${row.moodWithout.toFixed(1)} on the ${row.withoutDays} days you didn’t`}
                  />
                ))}
                {taskRows.length > TASK_ROWS_SHOWN && (
                  <View style={styles.showAll}>
                    <InlineAction
                      variant="neutral"
                      icon={allTaskRows ? 'chevron-up' : 'chevron-down'}
                      label={allTaskRows ? 'Show fewer' : `Show all ${taskRows.length}`}
                      onPress={() => { animateLayout(); setAllTaskRows(v => !v); }}
                    />
                  </View>
                )}
                <Text style={styles.chartCaption}>
                  Your average mood on days you finished a repeating task, against days you
                  didn’t. This doesn’t show cause and effect.
                </Text>
              </View>
            </>
          )}

          {trainingRow && (
            <>
              <Text style={styles.sectionTitle}>MOOD ON TRAINING DAYS</Text>
              <View style={styles.card}>
                <ContrastBars
                  first
                  label="Workout days"
                  withLabel="Trained"
                  withoutLabel="Rest day"
                  withFraction={moodBarFraction(trainingRow.moodWith)}
                  withoutFraction={moodBarFraction(trainingRow.moodWithout)}
                  withText={trainingRow.moodWith.toFixed(1)}
                  withoutText={trainingRow.moodWithout.toFixed(1)}
                  accessibilityLabel={`Workout days, average mood ${trainingRow.moodWith.toFixed(1)} on the ${trainingRow.withDays} days you logged a workout, ${trainingRow.moodWithout.toFixed(1)} on the ${trainingRow.withoutDays} days since your first one that you didn’t`}
                />
                <Text style={styles.chartCaption}>
                  Your average mood on days you finished a workout in this app, against the other
                  {' '}days since your first one. Workouts from Apple Health aren’t counted. This
                  {' '}doesn’t show cause and effect.
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
                    accessibilityLabel={`${row.label}, average mood ${row.moodWith.toFixed(1)} on days you logged it, ${row.moodWithout.toFixed(1)} on days you didn’t`}
                  />
                ))}
                <Text style={styles.chartCaption}>
                  Your average mood on days you logged it, against days you didn’t.
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
                    accessibilityLabel={`${row.label}, average mood ${row.moodWith.toFixed(1)} on days it applied, ${row.moodWithout.toFixed(1)} on days it didn’t`}
                  />
                ))}
                <Text style={styles.chartCaption}>
                  Your average mood on days a tag applied, against days it didn’t.
                </Text>
              </View>
            </>
          )}

          {timeRows.length > 1 && (
            <>
              <Text style={styles.sectionTitle}>MOOD BY TIME OF DAY</Text>
              <View style={styles.card}>
                {timeRows.map((row, i) => (
                  <View
                    key={row.segment}
                    style={[styles.timeRow, i > 0 && styles.timeRowGap]}
                    accessible
                    accessibilityLabel={`${row.segment}, average mood ${row.mood.toFixed(1)} across ${row.entryCount} ${row.entryCount === 1 ? 'entry' : 'entries'}`}
                  >
                    <View style={styles.timeLabel}>
                      <Text style={styles.contrastLabel}>{capitalize(row.segment)}</Text>
                      <Text style={styles.timeCount}>
                        {row.entryCount} {row.entryCount === 1 ? 'entry' : 'entries'}
                      </Text>
                    </View>
                    {/* Decoration: the row's label already carries the figures. */}
                    <View style={styles.timeTrack} accessible={false} importantForAccessibility="no">
                      <AnimatedBarFill
                        percent={contrastBarPercent(moodBarFraction(row.mood))}
                        delayMs={i * animation.duration.fast}
                        style={styles.timeFill}
                      />
                    </View>
                    <Text style={styles.timeValue}>{row.mood.toFixed(1)}</Text>
                  </View>
                ))}
              </View>
            </>
          )}

        </WideScroll>
      )}

      <ScrollToTopButton {...scrollTop.buttonProps} />
      {pullSearch.sheet}
    </View>
  );
}

const makeStyles = (colors: Colors, textScaleFactor = 1) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  scroll: { flex: 1 },
  scrollContent: { paddingHorizontal: spacing.md },
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
  chartCaption: { fontSize: font.xs, color: colors.textTertiary, marginTop: spacing.sm },
  showAll: { flexDirection: 'row', marginTop: spacing.md },
  pending: { fontSize: font.sm, color: colors.textSecondary, lineHeight: 20 },
  finding: { fontSize: font.md, color: colors.text, lineHeight: 22 },
  findings: { gap: spacing.sm },
  splitRow: { flexDirection: 'row', marginTop: spacing.md },
  splitCell: { flex: 1, alignItems: 'center' },
  splitValue: { fontSize: font.lg, fontWeight: fontWeight.bold, color: colors.text },
  splitLabel: { fontSize: font.xs, color: colors.textSecondary, marginTop: spacing.xxs },
  // Mood by time of day: label and entry count, one bar on the shared 1-5
  // scale, and the average in a fixed column so the figures line up.
  timeRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.smd },
  timeRowGap: { marginTop: spacing.smd },
  timeLabel: { width: Math.round(84 * textScaleFactor) },
  timeCount: { fontSize: font.xxs, color: colors.textTertiary },
  timeTrack: { flex: 1, height: 7, borderRadius: radius.full, backgroundColor: colors.separator, overflow: 'hidden' },
  timeFill: { height: 7, borderRadius: radius.full, backgroundColor: colors.accent },
  timeValue: {
    width: Math.round(28 * textScaleFactor),
    textAlign: 'right',
    fontSize: font.sm,
    fontWeight: fontWeight.semibold,
    color: colors.text,
    fontVariant: ['tabular-nums'],
  },
  contrastLabel: { flex: 1, fontSize: font.sm, color: colors.text },
});
