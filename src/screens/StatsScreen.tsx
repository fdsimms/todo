import React, { useCallback, useMemo, useRef, useState, useEffect } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  Animated,
} from 'react-native';
import type { TimeOfDay } from '../types';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useBottomTabBarHeight } from '@react-navigation/bottom-tabs';
import { useFocusEffect } from '@react-navigation/native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { format } from 'date-fns/format';
import { subDays } from 'date-fns/subDays';
import { isToday } from 'date-fns/isToday';
import { startOfWeek } from 'date-fns/startOfWeek';
import { isSameDay } from 'date-fns/isSameDay';
import { useTaskStore } from '../store/useTaskStore';
import { ScreenHeader } from '../components/ScreenHeader';
import { EmptyState } from '../components/EmptyState';
import { useColors } from '../theme/ThemeContext';
import { spacing, font, fontWeight, radius, animation, type Colors } from '../theme';
import { useReduceMotion } from '../utils/useReduceMotion';
import { getRepeatedInstances, normalizeTitle } from '../utils/taskInstances';
import { onTimeSummary } from '../utils/stats';
import { isRealCompletion, mostMissed } from '../utils/missed';
import { formatDuration } from '../utils/effort';
import { useSettingsStore } from '../store/useSettingsStore';
import {
  buildRhythmProfile,
  findSegmentMismatches,
  describeRhythm,
  formatHour,
  segmentOf,
  type SegmentMismatch,
} from '../utils/rhythms';
import { rhythmOptionsFromSettings } from '../utils/rhythmsSettings';
import { PressableScale } from '../components/PressableScale';
import { animateLayout } from '../utils/layoutAnimation';
import { haptics } from '../utils/haptics';
import { useMealPlanStore } from '../store/useMealPlanStore';
import { useRecipeStore } from '../store/useRecipeStore';
import { useLeftoverStore } from '../store/useLeftoverStore';
import { describeFridgeHistory, outcomeCounts } from '../utils/leftovers';
import { getLogicalToday } from '../utils/dateUtils';
import {
  describeMealsTogether,
  describeTimeTogether,
  mealYearRange,
  taskYearRange,
  timeTogetherInRange,
} from '../utils/peopleStats';
import {
  cookingWindow,
  hasCookingData,
  leftoversFinishedIn,
  mostCookedRecipes,
  type CookingWindow,
} from '../utils/cookingStats';

const BAR_HEIGHT = 96;
// Shallower than the 7-day chart: 24 bars is a wide, low shape, and a tall one
// would push the headline under it off the first screen.
const HOUR_BAR_HEIGHT = 64;
// Every sixth hour is marked on the hour chart's axis — 24 labels would not fit.
const HOUR_LABEL_EVERY = 6;
const HABIT_DAYS = 30;
// The same month HABIT_DAYS uses, and well inside MEAL_PLAN_RETENTION_DAYS (180)
// and LEFTOVER_RETENTION_DAYS (60), so neither purge can quietly clip the window.
const COOKING_DAYS = 30;
const MOST_COOKED_LIMIT = 5;

// Sections cascade in on mount: each fades and rises with a small delay.
function StaggerIn({ index, children }: { index: number; children: React.ReactNode }) {
  const reduceMotion = useReduceMotion();
  const anim = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    // Reduce Motion: show sections at rest, no cascade.
    if (reduceMotion) {
      anim.setValue(1);
      return;
    }
    Animated.timing(anim, {
      toValue: 1,
      duration: animation.duration.normal,
      delay: index * 60,
      useNativeDriver: true,
    }).start();
  }, [anim, index, reduceMotion]);
  return (
    <Animated.View
      style={{
        opacity: anim,
        transform: [{ translateY: anim.interpolate({ inputRange: [0, 1], outputRange: [14, 0] }) }],
      }}
    >
      {children}
    </Animated.View>
  );
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function expectedCount(recurrenceType: string, interval: number): number {
  switch (recurrenceType) {
    case 'daily':   return Math.max(1, Math.floor(HABIT_DAYS / interval));
    case 'weekly':  return Math.max(1, Math.floor(HABIT_DAYS / (7 * interval)));
    case 'monthly': return Math.max(1, Math.floor(HABIT_DAYS / (30 * interval)));
    default:        return 1;
  }
}

export function StatsScreen() {
  const insets = useSafeAreaInsets();
  const tabBarHeight = useBottomTabBarHeight();
  const tasks = useTaskStore(s => s.tasks);
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const reduceMotion = useReduceMotion();
  const now = useMemo(() => new Date(), []);

  // Every count on this screen hangs off `done`, and every one of them is a
  // claim about what the user achieved — so misses are excluded here once
  // rather than at each read below. See Task.missedAt.
  const done = useMemo(
    () => tasks.filter(t => !t.parentId && isRealCompletion(t) && t.completedAt),
    [tasks],
  );

  const todayCount = useMemo(
    () => done.filter(t => isToday(new Date(t.completedAt!))).length,
    [done],
  );

  // Was hardcoded to Monday while the calendar grid and the Later labels ran
  // Sunday-first, so a Sunday completion counted in a different week depending
  // on which screen you asked.
  const weekStartsOn = useSettingsStore(s => s.weekStartsOn);
  const weekCount = useMemo(() => {
    const weekStart = startOfWeek(now, { weekStartsOn });
    return done.filter(t => new Date(t.completedAt!) >= weekStart).length;
  }, [done, now, weekStartsOn]);

  const chartBars = useMemo(() =>
    Array.from({ length: 7 }, (_, i) => {
      const day = subDays(now, 6 - i);
      const count = done.filter(t => isSameDay(new Date(t.completedAt!), day)).length;
      return {
        key: format(day, 'yyyy-MM-dd'),
        label: format(day, 'EEE'),
        count,
        today: isToday(day),
      };
    }),
    [done, now],
  );

  const barMax = useMemo(() => Math.max(1, ...chartBars.map(b => b.count)), [chartBars]);

  // When the user actually finishes things, and where that disagrees with the
  // time of day their tasks claim. Both read the same completion history the
  // sections above do — see utils/rhythms.
  const use24HourTime = useSettingsStore(s => s.use24HourTime);
  const morningStart = useSettingsStore(s => s.morningStart);
  const afternoonStart = useSettingsStore(s => s.afternoonStart);
  const eveningStart = useSettingsStore(s => s.eveningStart);
  const nightStart = useSettingsStore(s => s.nightStart);
  const dayResetTime = useSettingsStore(s => s.dayResetTime);

  // Subscribed to individually above so the memo re-runs when a boundary
  // moves; rhythmOptionsFromSettings reads the same values back off the store.
  const rhythmOptions = useMemo(
    () => rhythmOptionsFromSettings(),
    [morningStart, afternoonStart, eveningStart, nightStart, dayResetTime],
  );

  const rhythm = useMemo(
    () => buildRhythmProfile(tasks, rhythmOptions),
    [tasks, rhythmOptions],
  );

  const rhythmMax = useMemo(() => Math.max(1, ...rhythm.byHour), [rhythm]);

  const hourBars = useMemo(
    () => rhythm.byHour.map((count, hour) => ({
      hour,
      count,
      // A representative moment inside the hour, so each bar takes the colour
      // of the segment it belongs to under the user's own boundaries.
      segment: segmentOf(new Date(2026, 0, 1, hour, 30), rhythmOptions.boundaries),
    })),
    [rhythm, rhythmOptions],
  );

  const mismatches = useMemo(
    () => findSegmentMismatches(tasks, rhythmOptions).slice(0, 5),
    [tasks, rhythmOptions],
  );

  const rhythmHeadline = useMemo(
    () => describeRhythm(rhythm, use24HourTime),
    [rhythm, use24HourTime],
  );

  const updateTask = useTaskStore(s => s.updateTask);
  const segmentColors: Record<TimeOfDay, string> = {
    morning: colors.timeMorning,
    afternoon: colors.timeAfternoon,
    evening: colors.timeEvening,
    night: colors.timeNight,
  };

  // Re-files every live row still carrying the label that isn't sticking.
  // Default scope, so the change follows the task forward: timeSegments is a
  // CONTENT_FIELD, so a series fans it out to its later dates and a recurring
  // task carries it onto the next occurrence it spawns.
  const applyMismatch = (m: SegmentMismatch) => {
    haptics.success();
    animateLayout();
    m.taskIds.forEach(id => updateTask(id, { timeSegments: [m.observed] }));
  };

  // Bars grow up from the baseline once on mount (height isn't supported by
  // the native driver, so this one runs on the JS thread).
  const chartProgress = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    // Reduce Motion: render bars at full height immediately.
    if (reduceMotion) {
      chartProgress.setValue(1);
      return;
    }
    Animated.timing(chartProgress, {
      toValue: 1,
      duration: animation.duration.slow,
      delay: 150,
      useNativeDriver: false,
    }).start();
  }, [chartProgress, reduceMotion]);

  const streaks = useMemo(
    () =>
      tasks
        .filter(t => !t.parentId && !t.completed && t.recurrenceType !== 'none' && t.streakCount > 0)
        .sort((a, b) => b.streakCount - a.streakCount)
        .slice(0, 10),
    [tasks],
  );

  const habits = useMemo(() => {
    const cutoff = subDays(now, HABIT_DAYS);
    const recent = done.filter(
      t => t.recurrenceType !== 'none' && new Date(t.completedAt!) >= cutoff,
    );
    // Keyed on normalizeTitle so renaming a recurring task mid-stream doesn't
    // fork its history into two habits.
    const map = new Map<string, { title: string; count: number; recurrenceType: string; interval: number }>();
    recent.forEach(t => {
      const key = normalizeTitle(t.title);
      const e = map.get(key);
      if (e) e.count++;
      else map.set(key, { title: t.title, count: 1, recurrenceType: t.recurrenceType, interval: t.recurrenceInterval });
    });
    return Array.from(map.entries())
      .map(([key, { title, count, recurrenceType, interval }]) => {
        const expected = expectedCount(recurrenceType, interval);
        return { key, title, count, expected, rate: Math.min(1, count / expected) };
      })
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);
  }, [done, now]);

  // Non-recurring tasks completed more than once — the "instances" of a task
  // that isn't formally recurring (e.g. re-adding one via title autosuggest).
  const repeated = useMemo(() => getRepeatedInstances(tasks).slice(0, 10), [tasks]);

  const missed = useMemo(() => mostMissed(tasks).slice(0, 10), [tasks]);

  const onTime = useMemo(() => onTimeSummary(tasks), [tasks]);

  // --- Cooking (#1367) ------------------------------------------------------
  // Three sets, read three different ways. Recipes and leftovers are both held
  // wholesale in memory, so those are plain memos; the meal plan is a window
  // MealPlanScreen owns and this screen must not touch, so its half is the
  // store's own snapshot read — see refreshCookingCounts.
  const recipes = useRecipeStore(s => s.recipes);
  const leftovers = useLeftoverStore(s => s.leftovers);
  const storedCookingCounts = useMealPlanStore(s => s.cookingCounts);
  const refreshCookingCounts = useMealPlanStore(s => s.refreshCookingCounts);
  const [cookWindow, setCookWindow] = useState<CookingWindow | null>(null);

  // This year's meals with a guest — its own read rather than a wider
  // cookWindow, since "what have you cooked lately" (30 days) and "your year"
  // don't share an answer. Independent of kitchenEnabled below: unlike the
  // cooking section, this can be true from tasks alone even with the kitchen
  // put away, so the fetch always runs and only the meals half of the
  // sentence is withheld when it's off.
  const peopleYearMealCount = useMealPlanStore(s => s.peopleYearMealCount);
  const refreshPeopleYearMealCount = useMealPlanStore(s => s.refreshPeopleYearMealCount);

  // Gated at the point of use rather than by writing anything off, like
  // `mealsOnToday` in TodayScreen: someone who has put the kitchen away
  // shouldn't be shown what they cooked, and turning it back on restores the
  // section exactly as it was.
  const kitchenEnabled = useSettingsStore(s => s.kitchenEnabled);
  const cookingCounts = kitchenEnabled ? storedCookingCounts : null;

  // Rebuilt on focus rather than once on mount. `enableScreens(false)` keeps a
  // blurred tab mounted for the life of the session (see CLAUDE.md), so a
  // window computed at mount would still end on the day the app was opened —
  // the same reason `now` above going stale is a known wart on this screen.
  useFocusEffect(
    useCallback(() => {
      if (!kitchenEnabled) return;
      const next = cookingWindow(getLogicalToday(), COOKING_DAYS);
      setCookWindow(prev =>
        prev && prev.startKey === next.startKey && prev.endKey === next.endKey ? prev : next,
      );
      refreshCookingCounts(next);
    }, [kitchenEnabled, refreshCookingCounts]),
  );

  useFocusEffect(
    useCallback(() => {
      const { startKey, endKey } = mealYearRange(getLogicalToday());
      refreshPeopleYearMealCount(startKey, endKey);
    }, [refreshPeopleYearMealCount]),
  );

  // Off `tasks` rather than `done`: onTimeSummary above makes the same call,
  // doing its own isRealCompletion/parentId check rather than assuming a
  // pre-filtered list, so the function stands on its own if anything else
  // ever wants it.
  const timeTogetherCount = useMemo(() => {
    const { startIso, endIso } = taskYearRange(now);
    return timeTogetherInRange(tasks, startIso, endIso);
  }, [tasks, now]);
  const timeTogetherText = describeTimeTogether(timeTogetherCount);
  const mealsTogetherText = kitchenEnabled ? describeMealsTogether(peopleYearMealCount ?? 0) : null;

  const fridge = useMemo(
    () => (kitchenEnabled && cookWindow ? leftoversFinishedIn(leftovers, cookWindow) : []),
    [kitchenEnabled, leftovers, cookWindow],
  );
  const fridgeText = useMemo(() => describeFridgeHistory(fridge), [fridge]);
  const mostCooked = useMemo(
    () => (kitchenEnabled ? mostCookedRecipes(recipes, MOST_COOKED_LIMIT) : []),
    [kitchenEnabled, recipes],
  );
  const hasCooking = hasCookingData(cookingCounts, outcomeCounts(fridge), mostCooked);

  // The screen used to be gated on completions alone, so someone whose history
  // is in the kitchen rather than the task list was told there was no data.
  const hasTaskData = done.length > 0;
  const showCookingCard =
    cookingCounts !== null &&
    (cookingCounts.planned > 0 || cookingCounts.daysCooked > 0 || fridgeText !== '');
  // The cascade counts from wherever the screen actually starts: for someone
  // whose history is all kitchen, every task section above is gone, and a fixed
  // index 9 would hold the whole screen blank for half a second.
  const cookingStagger = hasTaskData ? 9 : 0;

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <ScreenHeader title="Stats" subtitle={hasTaskData ? `${done.length} completed` : undefined} />

      {!hasTaskData && !hasCooking ? (
        <EmptyState
          icon="bar-chart-outline"
          title="No data yet"
          subtitle="Complete tasks or cook a meal to see your stats here"
          bottomOffset={tabBarHeight}
        />
      ) : (
        <ScrollView
          contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 100 }]}
          showsVerticalScrollIndicator={false}
        >

          {/* Summary cards */}
          {hasTaskData && (
          <StaggerIn index={0}>
          <View style={styles.summaryRow}>
            <View style={styles.summaryCard}>
              <Text style={[styles.summaryValue, { color: colors.accent }]}>{todayCount}</Text>
              <Text style={styles.summaryLabel}>Today</Text>
            </View>
            <View style={styles.summaryCard}>
              <Text style={[styles.summaryValue, { color: colors.accent }]}>{weekCount}</Text>
              <Text style={styles.summaryLabel}>This week</Text>
            </View>
            <View style={styles.summaryCard}>
              <Text style={[styles.summaryValue, { color: colors.orange }]}>{streaks.length}</Text>
              <Text style={styles.summaryLabel}>Active streaks</Text>
            </View>
          </View>
          </StaggerIn>
          )}

          {/* Completed per day — last 7 days */}
          {hasTaskData && (
          <StaggerIn index={1}>
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>COMPLETED PER DAY</Text>
            <View style={styles.card}>
              <View style={styles.chartInner}>
                {chartBars.map(({ key, label, count, today }) => (
                  <View key={key} style={styles.chartCol}>
                    <Text style={styles.barCount}>{count > 0 ? count : ' '}</Text>
                    <View style={styles.barTrack}>
                      <Animated.View
                        style={[
                          styles.bar,
                          {
                            height: chartProgress.interpolate({
                              inputRange: [0, 1],
                              outputRange: ['0%', `${Math.max(3, Math.round((count / barMax) * 100))}%`],
                            }),
                            backgroundColor: today ? colors.accent : colors.bgQuaternary,
                          },
                        ]}
                      />
                    </View>
                    <Text style={[styles.barLabel, today && { color: colors.accent, fontWeight: fontWeight.semibold }]}>
                      {label}
                    </Text>
                  </View>
                ))}
              </View>
            </View>
          </View>
          </StaggerIn>
          )}

          {/* When completions actually land, by clock hour */}
          {rhythm.sampleCount > 0 && (
            <StaggerIn index={2}>
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>WHEN YOU GET THINGS DONE</Text>
              <View style={styles.card}>
                <View style={styles.hourChartInner}>
                  {hourBars.map(({ hour, count, segment }) => (
                    <View key={hour} style={styles.hourCol}>
                      <View style={styles.hourTrack}>
                        <Animated.View
                          style={[
                            styles.hourBar,
                            {
                              height: chartProgress.interpolate({
                                inputRange: [0, 1],
                                outputRange: ['0%', `${Math.max(2, Math.round((count / rhythmMax) * 100))}%`],
                              }),
                              backgroundColor: count > 0 ? segmentColors[segment] : colors.bgQuaternary,
                            },
                          ]}
                        />
                      </View>
                    </View>
                  ))}
                </View>
                <View style={styles.hourLabelRow}>
                  {hourBars
                    .filter(({ hour }) => hour % HOUR_LABEL_EVERY === 0)
                    .map(({ hour }) => (
                      <View key={hour} style={styles.hourLabelCell}>
                        <Text style={styles.hourLabel} numberOfLines={1}>
                          {formatHour(hour, use24HourTime)}
                        </Text>
                      </View>
                    ))}
                </View>
                {rhythmHeadline && (
                  <View style={[styles.row, styles.rowTopBorder]}>
                    <Text style={styles.rowText}>{rhythmHeadline}</Text>
                  </View>
                )}
              </View>
            </View>
            </StaggerIn>
          )}

          {/* Declared time of day vs. the one the history shows */}
          {mismatches.length > 0 && (
            <StaggerIn index={3}>
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>MARKED ONE TIME, DONE ANOTHER</Text>
              <View style={styles.card}>
                {mismatches.map((m, i) => (
                  <View key={m.key} style={[styles.row, i < mismatches.length - 1 && styles.rowBorder]}>
                    <View style={styles.instanceMain}>
                      <Text style={styles.instanceTitle} numberOfLines={1}>{m.title}</Text>
                      <Text style={styles.instanceMeta}>{m.reason}</Text>
                    </View>
                    <PressableScale
                      style={[styles.segmentFix, { backgroundColor: segmentColors[m.observed] + '33' }]}
                      onPress={() => applyMismatch(m)}
                      accessibilityRole="button"
                      accessibilityLabel={`Move ${m.title} to ${m.observed}`}
                      accessibilityHint={`Currently marked ${m.declared}`}
                    >
                      <Ionicons name="arrow-forward" size={12} color={segmentColors[m.observed]} />
                      <Text style={[styles.segmentFixText, { color: segmentColors[m.observed] }]}>
                        {capitalize(m.observed)}
                      </Text>
                    </PressableScale>
                  </View>
                ))}
              </View>
            </View>
            </StaggerIn>
          )}

          {/* On-time completion, for tasks that had a deadline */}
          {onTime.total > 0 && (
            <StaggerIn index={4}>
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>ON TIME</Text>
              <View style={styles.card}>
                <View style={styles.row}>
                  <Text style={styles.rowText}>
                    {onTime.onTime}/{onTime.total} completed by their deadline
                  </Text>
                  <Text style={[styles.badgeText, { color: onTime.rate >= 0.8 ? colors.green : onTime.rate >= 0.5 ? colors.orange : colors.red }]}>
                    {Math.round(onTime.rate * 100)}%
                  </Text>
                </View>
              </View>
            </View>
            </StaggerIn>
          )}

          {/* Streak leaderboard */}
          {streaks.length > 0 && (
            <StaggerIn index={5}>
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>STREAK LEADERBOARD</Text>
              <View style={styles.card}>
                {streaks.map((t, i) => (
                  <View key={t.id} style={[styles.row, i < streaks.length - 1 && styles.rowBorder]}>
                    <Text style={styles.rank}>#{i + 1}</Text>
                    <Text style={styles.rowText} numberOfLines={1}>{t.title}</Text>
                    <View style={styles.badge}>
                      <Ionicons name="flame" size={13} color={colors.orange} />
                      <Text style={[styles.badgeText, { color: colors.orange }]}>{t.streakCount}</Text>
                    </View>
                  </View>
                ))}
              </View>
            </View>
            </StaggerIn>
          )}

          {/* Habit completion rates */}
          {habits.length > 0 && (
            <StaggerIn index={6}>
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>HABIT COMPLETION (LAST 30 DAYS)</Text>
              <View style={styles.card}>
                {habits.map(({ key, title, count, expected, rate }, i) => (
                  <View key={key} style={[styles.habitRow, i < habits.length - 1 && styles.rowBorder]}>
                    <View style={styles.habitTop}>
                      <Text style={styles.rowText} numberOfLines={1}>{title}</Text>
                      <Text style={styles.habitCount}>{count}/{expected}</Text>
                    </View>
                    <View style={styles.track}>
                      <View
                        style={[
                          styles.fill,
                          {
                            width: `${Math.round(rate * 100)}%` as `${number}%`,
                            backgroundColor:
                              rate >= 0.8 ? colors.green :
                              rate >= 0.5 ? colors.orange : colors.red,
                          },
                        ]}
                      />
                    </View>
                    <Text style={styles.pct}>{Math.round(rate * 100)}%</Text>
                  </View>
                ))}
              </View>
            </View>
            </StaggerIn>
          )}

          {/* Repeated non-recurring tasks — "instances" of the same task */}
          {repeated.length > 0 && (
            <StaggerIn index={7}>
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>REPEATED TASKS</Text>
              <View style={styles.card}>
                {repeated.map((g, i) => (
                  <View key={g.key} style={[styles.row, i < repeated.length - 1 && styles.rowBorder]}>
                    <View style={styles.instanceMain}>
                      <Text style={styles.instanceTitle} numberOfLines={1}>{g.title}</Text>
                      <Text style={styles.instanceMeta}>
                        Last done {format(new Date(g.lastCompletedAt), 'MMM d')}
                      </Text>
                    </View>
                    <View style={styles.badge}>
                      <Ionicons name="repeat" size={13} color={colors.accent} />
                      <Text style={[styles.badgeText, { color: colors.accent }]}>{g.count}</Text>
                    </View>
                  </View>
                ))}
              </View>
            </View>
            </StaggerIn>
          )}

          {/* Recurring tasks most often marked missed rather than done */}
          {missed.length > 0 && (
            <StaggerIn index={8}>
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>MOST MISSED</Text>
              <View style={styles.card}>
                {missed.map((g, i) => (
                  <View key={g.key} style={[styles.row, i < missed.length - 1 && styles.rowBorder]}>
                    <View style={styles.instanceMain}>
                      <Text style={styles.instanceTitle} numberOfLines={1}>{g.title}</Text>
                      <Text style={styles.instanceMeta}>
                        Last missed {format(new Date(g.lastMissedAt), 'MMM d')}
                      </Text>
                    </View>
                    <View style={styles.badge}>
                      <Ionicons name="close-circle" size={13} color={colors.red} />
                      <Text style={[styles.badgeText, { color: colors.red }]}>{g.count}</Text>
                    </View>
                  </View>
                ))}
              </View>
            </View>
            </StaggerIn>
          )}

          {/*
            Cooking (#1367). Counts, never a score — no percentage and no
            red/green verdict, unlike ON TIME above. A planned meal that went
            uncooked is very often the app working rather than failing (the
            leftovers got eaten, or you went out), so grading it would be
            grading someone for a good week. Same rule describeFridgeHistory
            states for the fridge, whose wording this reuses verbatim.
          */}
          {showCookingCard && cookingCounts !== null && (
            <StaggerIn index={cookingStagger}>
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>COOKING (LAST {COOKING_DAYS} DAYS)</Text>
              <View style={styles.card}>
                {cookingCounts.planned > 0 && (
                  <View style={[styles.row, (cookingCounts.daysCooked > 0 || fridgeText !== '') && styles.rowBorder]}>
                    <Text style={styles.rowText}>Planned meals cooked</Text>
                    <Text style={styles.cookValue}>
                      {cookingCounts.plannedCooked} of {cookingCounts.planned}
                    </Text>
                  </View>
                )}
                {cookingCounts.daysCooked > 0 && (
                  <View style={[styles.row, fridgeText !== '' && styles.rowBorder]}>
                    <Text style={styles.rowText}>Days you cooked</Text>
                    <Text style={styles.cookValue}>
                      {cookingCounts.daysCooked} of {cookingCounts.days}
                    </Text>
                  </View>
                )}
                {fridgeText !== '' && (
                  <View style={styles.row}>
                    <Text style={styles.rowText}>Leftovers</Text>
                    <Text style={styles.cookValue}>{fridgeText}</Text>
                  </View>
                )}
              </View>
            </View>
            </StaggerIn>
          )}

          {/*
            All time, and it has to be: Recipe.cookCount is a standalone counter
            that outlives the 180-day entry purge, so there is no way to window
            it — hence the heading saying so rather than letting it sit under
            the 30 days above.
          */}
          {mostCooked.length > 0 && (
            <StaggerIn index={cookingStagger + 1}>
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>MOST COOKED (ALL TIME)</Text>
              <View style={styles.card}>
                {mostCooked.map((r, i) => {
                  const meta = [
                    r.lastCookedAt ? `Last cooked ${format(new Date(r.lastCookedAt), 'MMM d')}` : null,
                    r.avgMinutes !== null ? `avg ${formatDuration(r.avgMinutes)}` : null,
                  ]
                    .filter(Boolean)
                    .join(' · ');
                  return (
                    <View key={r.id} style={[styles.row, i < mostCooked.length - 1 && styles.rowBorder]}>
                      <Text style={styles.rank}>#{i + 1}</Text>
                      <View style={styles.instanceMain}>
                        <Text style={styles.instanceTitle} numberOfLines={1}>{r.name}</Text>
                        {meta !== '' && <Text style={styles.instanceMeta}>{meta}</Text>}
                      </View>
                      <View style={styles.badge}>
                        <Ionicons name="restaurant" size={13} color={colors.accent} />
                        <Text style={[styles.badgeText, { color: colors.accent }]}>{r.count}</Text>
                      </View>
                    </View>
                  );
                })}
              </View>
            </View>
            </StaggerIn>
          )}

          {/*
            A warm year in review — see docs/arch/people.md. Two independent
            facts, each gated on its own truthiness rather than as one row: a
            year with hosting but no tagged tasks (or the reverse) should still
            say the half that's true, and neither implies the other.

            No per-person breakdown anywhere near this, including as
            intermediate state — see the note on peopleStats.ts.
          */}
          {(!!timeTogetherText || !!mealsTogetherText) && (
            <StaggerIn index={cookingStagger + 2}>
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>PEOPLE THIS YEAR</Text>
              <View style={styles.card}>
                {!!timeTogetherText && (
                  <View style={[styles.row, !!mealsTogetherText && styles.rowBorder]}>
                    <Text style={styles.rowText}>{timeTogetherText}</Text>
                  </View>
                )}
                {!!mealsTogetherText && (
                  <View style={styles.row}>
                    <Text style={styles.rowText}>{mealsTogetherText}</Text>
                  </View>
                )}
              </View>
            </View>
            </StaggerIn>
          )}

        </ScrollView>
      )}
    </View>
  );
}

const makeStyles = (colors: Colors) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.bg },
    scroll: { paddingHorizontal: spacing.md, paddingTop: spacing.sm, paddingBottom: 40 },
    summaryRow: {
      flexDirection: 'row',
      gap: spacing.sm,
      marginBottom: spacing.lg,
    },
    summaryCard: {
      flex: 1,
      backgroundColor: colors.bgSecondary,
      borderRadius: radius.md,
      padding: spacing.md,
      alignItems: 'center',
      gap: 4,
    },
    summaryValue: { fontSize: font.xxl, fontWeight: '700', letterSpacing: -0.5 },
    summaryLabel: {
      color: colors.textTertiary,
      fontSize: font.xs,
      fontWeight: '500',
      textAlign: 'center',
    },
    section: { marginBottom: spacing.lg },
    sectionTitle: {
      color: colors.textSecondary,
      fontSize: font.xs,
      fontWeight: '700',
      textTransform: 'uppercase',
      letterSpacing: 0.8,
      marginBottom: spacing.sm,
    },
    card: {
      backgroundColor: colors.bgSecondary,
      borderRadius: radius.md,
      overflow: 'hidden',
    },
    chartInner: {
      flexDirection: 'row',
      paddingHorizontal: spacing.sm,
      paddingTop: spacing.sm,
      paddingBottom: spacing.sm,
    },
    chartCol: {
      flex: 1,
      alignItems: 'center',
    },
    barCount: {
      height: 16,
      color: colors.textTertiary,
      fontSize: font.xs,
      textAlign: 'center',
    },
    barTrack: {
      width: 20,
      height: BAR_HEIGHT,
      justifyContent: 'flex-end',
    },
    bar: {
      width: 20,
      borderRadius: 4,
    },
    barLabel: {
      marginTop: 4,
      color: colors.textTertiary,
      fontSize: 10,
      fontWeight: '500',
      textAlign: 'center',
    },
    // 24 columns rather than 7, so the bars are thin and the labels can't sit
    // under every one — every sixth hour is marked instead.
    hourChartInner: {
      flexDirection: 'row',
      paddingHorizontal: spacing.sm,
      paddingTop: spacing.md,
    },
    hourCol: {
      flex: 1,
      alignItems: 'center',
    },
    hourTrack: {
      width: '100%',
      height: HOUR_BAR_HEIGHT,
      justifyContent: 'flex-end',
      alignItems: 'center',
    },
    hourBar: {
      width: '62%',
      borderRadius: 2,
    },
    hourLabelRow: {
      flexDirection: 'row',
      paddingHorizontal: spacing.sm,
      paddingTop: 4,
      paddingBottom: spacing.sm,
    },
    // One cell per marked hour, each as wide as the HOUR_LABEL_EVERY columns it
    // spans, rather than one cell per column: a single 24th of the card is ~14pt,
    // which truncated every label to its first character and an ellipsis. The
    // label sits at the left edge of its cell, which is the left edge of the hour
    // it marks.
    hourLabelCell: {
      flex: HOUR_LABEL_EVERY,
      alignItems: 'flex-start',
    },
    hourLabel: {
      color: colors.textTertiary,
      fontSize: 10,
      fontWeight: '500',
    },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm + 2,
      gap: spacing.sm,
    },
    rowBorder: {
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.separator,
    },
    rowTopBorder: {
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: colors.separator,
    },
    // Tinted like a tag chip (colour + '33'), which is the app's established
    // way of tinting a pill to a data-driven colour rather than the accent.
    segmentFix: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 3,
      paddingHorizontal: spacing.sm,
      paddingVertical: 5,
      borderRadius: radius.full,
      flexShrink: 0,
    },
    segmentFixText: {
      fontSize: font.sm,
      fontWeight: '600',
    },
    rank: {
      width: 28,
      color: colors.textTertiary,
      fontSize: font.sm,
      fontWeight: '600',
    },
    rowText: {
      flex: 1,
      color: colors.text,
      fontSize: font.md,
    },
    badge: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 3,
      backgroundColor: colors.bgTertiary,
      paddingHorizontal: spacing.sm,
      paddingVertical: 3,
      borderRadius: radius.full,
    },
    badgeText: { fontSize: font.sm, fontWeight: '700' },
    // A value, not a verdict — textSecondary rather than the green/orange/red
    // the rate rows above use, for the reason the cooking section's own comment
    // gives.
    cookValue: {
      color: colors.textSecondary,
      fontSize: font.md,
      fontWeight: '600',
      flexShrink: 0,
    },
    instanceMain: {
      flex: 1,
      gap: 2,
    },
    instanceTitle: {
      color: colors.text,
      fontSize: font.md,
    },
    instanceMeta: {
      color: colors.textTertiary,
      fontSize: font.xs,
      fontWeight: '500',
    },
    habitRow: {
      paddingHorizontal: spacing.md,
      paddingTop: spacing.sm + 2,
      paddingBottom: spacing.sm,
      gap: spacing.xs,
    },
    habitTop: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: spacing.sm,
      marginBottom: 4,
    },
    habitCount: {
      color: colors.textTertiary,
      fontSize: font.xs,
      fontWeight: '500',
      flexShrink: 0,
    },
    track: {
      height: 6,
      backgroundColor: colors.bgTertiary,
      borderRadius: radius.full,
      overflow: 'hidden',
    },
    fill: {
      height: '100%',
      borderRadius: radius.full,
    },
    pct: {
      color: colors.textTertiary,
      fontSize: font.xs,
      fontWeight: '500',
      textAlign: 'right',
      marginTop: 2,
    },
  });
