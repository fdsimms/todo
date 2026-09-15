import React, { useCallback, useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useShallow } from 'zustand/react/shallow';
import { SheetModal } from './SheetModal';
import { SheetHeader } from './SheetHeader';
import { SheetHeaderButton } from './SheetHeaderButton';
import { PressableScale } from './PressableScale';
import { EmptyState } from './EmptyState';
import { WhenPicker } from './WhenPicker';
import { useTaskStore } from '../store/useTaskStore';
import { useSettingsStore } from '../store/useSettingsStore';
import { useColors } from '../theme/ThemeContext';
import { border, font, fontWeight, iconSize, radius, spacing, type Colors } from '../theme';
import { haptics } from '../utils/haptics';
import { animateLayout } from '../utils/layoutAnimation';
import { displayTitleFor, isHeldBack } from '../utils/visibilityUtils';
import { scheduleMoveUpdates } from '../utils/taskMoves';
import { addDays } from 'date-fns/addDays';
import { dayKeyOf, getLogicalToday, getLogicalTomorrow } from '../utils/dateUtils';
import { buildDayBuckets } from '../utils/calendarMonth';
import { assumedMinutesFor, buildDayLoads, weightFor } from '../utils/dayLoad';
import { awaySpanOf, type AwaySpan } from '../utils/awayDates';
import { weekNights } from '../utils/weekPlan';
import { useCalendarStore } from '../store/useCalendarStore';
import { useProjectStore } from '../store/useProjectStore';
import { useMealPlanStore } from '../store/useMealPlanStore';
import {
  describeWeeklyReviewDone,
  slippedTasks,
  weeklyReviewRows,
  weeklyReviewStages,
  type WeeklyReviewInput,
  type WeeklyReviewStage,
} from '../utils/weeklyReview';
import type { Task } from '../types';

interface Props {
  visible: boolean;
  onClose: () => void;
}

/**
 * The weekly review: the inbox, what is stuck, what slipped and the week
 * ahead, walked once in an order where each answer narrows the next.
 *
 * One card at a time, the shape `PantryReviewSheet` established for going
 * through the pantry — and `fullScreen` for that sheet's own reason, plus a
 * second one here: `WhenPicker` is raised from inside this one, and a drag
 * list cannot live inside a `pageSheet` (see CLAUDE.md). Nested rather than a
 * sibling, so it presents from this sheet's controller rather than asking the
 * root to present a second thing.
 *
 * **The stages are recomputed on every render, not snapshotted on open.** That
 * is the whole reason the ordering is worth having: filing an inbox task
 * removes it from the inbox pile and can add it to the slipped one, and the
 * next stage should see that. `weeklyReviewStages` is cheap and written to be
 * called again. See the module's own note.
 *
 * What it does *not* do is reimplement the four surfaces it walks. Re-dating
 * goes through `scheduleMoveUpdates`, which is where the defer-versus-pull
 * asymmetry lives, and everything else is a read. A review that grew its own
 * way of moving a task would be a fifth half-implementation of the thing
 * `taskMoves.ts` exists to hold.
 */
export function WeeklyReviewSheet({ visible, onClose }: Props) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const tasks = useTaskStore(useShallow(s => s.tasks));
  const inboxTasks = useTaskStore(s => s.inboxTasks);
  const waitingTasks = useTaskStore(s => s.waitingTasks);
  const driftingTaskList = useTaskStore(s => s.driftingTaskList);
  const updateTask = useTaskStore(s => s.updateTask);
  const dayResetTime = useSettingsStore(s => s.dayResetTime);
  const kitchenEnabled = useSettingsStore(s => s.kitchenEnabled);

  // The week ahead, counted the same way `checkWeekendNudgeTasks` counts a
  // weekend: one walk over the buckets, handed to `buildDayLoads` with the
  // calendar and away spans the day cells already use, so this sheet and the
  // month grid cannot disagree about which days look full. `weightFor` is the
  // shared predicate rather than a threshold restated here.
  const week = useMemo(() => {
    const start = getLogicalToday(dayResetTime);
    return Array.from({ length: 7 }, (_, i) => addDays(start, i));
  }, [dayResetTime]);

  const calendarEvents = useCalendarStore(useShallow(s => s.events));
  const calendarLoaded = useCalendarStore(s => s.loaded);
  const calendarWindowStart = useCalendarStore(s => s.windowStart);
  const calendarWindowEnd = useCalendarStore(s => s.windowEnd);
  const calendarReadEnabled = useSettingsStore(s => s.calendarReadEnabled);
  const projects = useProjectStore(useShallow(s => s.projects));
  const mealEntries = useMealPlanStore(useShallow(s => s.entries));

  const heavyDays = useMemo(() => {
    const buckets = buildDayBuckets(tasks, {
      from: week[0], to: week[week.length - 1], dayResetTime,
    });
    const loads = buildDayLoads(week, buckets, {
      taskById: new Map(tasks.map(t => [t.id, t])),
      busyEvents: calendarReadEnabled && calendarLoaded ? calendarEvents : [],
      busyWindow: calendarWindowStart && calendarWindowEnd
        ? { start: new Date(calendarWindowStart), end: new Date(calendarWindowEnd) }
        : null,
      // Built the same way CalendarScreen builds it, off live projects only:
      // an archived or finished trip is not a span the week ahead is inside.
      awaySpans: projects
        .filter(p => !p.archived && !p.completed)
        .map(p => awaySpanOf(p, dayResetTime))
        .filter((span): span is AwaySpan => span !== null),
      dayResetTime,
      assumedTaskMinutes: assumedMinutesFor(tasks),
    });
    // 'away' is not heavy — it is a different fact about the day, and
    // `weightFor` returns it ahead of both minute thresholds on purpose.
    return week.filter(d => {
      const weight = weightFor(loads.get(dayKeyOf(d)));
      return weight === 'busy' || weight === 'full';
    }).length;
  }, [tasks, week, dayResetTime, calendarReadEnabled, calendarLoaded, calendarEvents,
      calendarWindowStart, calendarWindowEnd, projects]);

  // Nights still to answer, through the meal plan's own rule — which already
  // refuses to count a night in the past, since a Monday nobody cooked is
  // history by Thursday rather than a decision outstanding.
  const openNights = useMemo(
    () => weekNights(mealEntries, week, dayKeyOf(new Date())).filter(n => n.open && !n.past).length,
    [mealEntries, week],
  );

  const [index, setIndex] = useState(0);
  const [filed, setFiled] = useState(0);
  const [moved, setMoved] = useState(0);
  const [picking, setPicking] = useState<Task | null>(null);

  // Recomputed from live state rather than held, which is what makes the
  // ordering pay off — see the note above.
  const input = useMemo<WeeklyReviewInput>(() => ({
    inbox: inboxTasks(),
    stuck: [...waitingTasks(), ...driftingTaskList()],
    slipped: slippedTasks(tasks, isHeldBack, new Date(), dayResetTime),
    heavyDays,
    openNights,
  }), [tasks, inboxTasks, waitingTasks, driftingTaskList, dayResetTime, heavyDays, openNights]);

  const stages = useMemo(
    () => weeklyReviewStages(input, { kitchenEnabled }),
    [input, kitchenEnabled],
  );

  const stage: WeeklyReviewStage | null = stages[index] ?? null;
  const rows = stage ? weeklyReviewRows(stage, input) : [];
  const done = stage === null;

  const finish = useCallback(() => {
    haptics.success();
    onClose();
    // Reset after the dismissal so the closing frame still shows the finished
    // card rather than snapping back to stage one on the way out.
    setTimeout(() => { setIndex(0); setFiled(0); setMoved(0); }, 0);
  }, [onClose]);

  const next = () => {
    haptics.tap();
    animateLayout();
    setIndex(i => i + 1);
  };

  const moveTo = (task: Task, date: Date | null) => {
    haptics.tap();
    animateLayout();
    updateTask(task.id, scheduleMoveUpdates(task, date, dayResetTime));
    // A filed inbox task and a re-dated slipped one are different things the
    // person did, and the finished card says which.
    if (stage?.id === 'inbox') setFiled(n => n + 1);
    else setMoved(n => n + 1);
  };

  return (
    <SheetModal
      name="WeeklyReviewSheet"
      visible={visible}
      animationType="slide"
      presentationStyle="fullScreen"
      onRequestClose={onClose}
    >
      <View style={[styles.container, { paddingTop: insets.top }]}>
        <SheetHeader
          title="Review the week"
          left={<SheetHeaderButton label="Close" role="cancel" onPress={onClose} minWidth={72} />}
          right={
            done
              ? <SheetHeaderButton label="Done" onPress={finish} minWidth={72} />
              : <SheetHeaderButton label="Skip" role="cancel" onPress={next} minWidth={72} />
          }
        />

        {!done && (
          <View style={styles.progress}>
            {stages.map((s, i) => (
              <View
                key={s.id}
                style={[styles.pip, i <= index && styles.pipOn]}
              />
            ))}
          </View>
        )}

        <ScrollView
          style={styles.body}
          contentContainerStyle={[
            done ? styles.doneContent : styles.content,
            { paddingBottom: insets.bottom + spacing.xl },
          ]}
        >
          {done ? (
            <EmptyState
              icon="checkmark-done-outline"
              title="That's the week"
              subtitle={describeWeeklyReviewDone(filed, moved)}
            />
          ) : (
            <>
              <View style={styles.stageHead}>
                <View style={styles.stageIcon}>
                  <Ionicons name={stage!.icon as never} size={iconSize.md} color={colors.accent} />
                </View>
                <View style={styles.stageText}>
                  <Text style={styles.stageTitle}>{stage!.title}</Text>
                  <Text style={styles.stageHint}>{stage!.hint}</Text>
                </View>
              </View>

              {stage!.kind === 'look' ? (
                <View style={styles.card}>
                  <Text style={styles.lookCount}>{stage!.count}</Text>
                  <Text style={styles.lookLabel}>
                    {stage!.id === 'week'
                      ? (stage!.count === 1 ? 'day already looks full' : 'days already look full')
                      : (stage!.count === 1 ? 'night with nothing planned' : 'nights with nothing planned')}
                  </Text>
                </View>
              ) : (
                rows.map(task => (
                  <View key={task.id} style={styles.row}>
                    <Text style={styles.rowTitle} numberOfLines={2}>
                      {displayTitleFor(task)}
                    </Text>
                    {/* A held-back task is shown and not offered a date: it has
                        not slipped, it is waiting, and a date would answer the
                        wrong question. Same line slippedTasks draws. */}
                    {stage!.id !== 'stuck' && (
                      <View style={styles.actions}>
                        <PressableScale
                          style={styles.action}
                          onPress={() => moveTo(task, getLogicalToday(dayResetTime))}
                          accessibilityLabel={`Move ${displayTitleFor(task)} to today`}
                        >
                          <Text style={styles.actionText}>Today</Text>
                        </PressableScale>
                        <PressableScale
                          style={styles.action}
                          onPress={() => moveTo(task, getLogicalTomorrow(dayResetTime))}
                          accessibilityLabel={`Move ${displayTitleFor(task)} to tomorrow`}
                        >
                          <Text style={styles.actionText}>Tomorrow</Text>
                        </PressableScale>
                        <PressableScale
                          style={styles.action}
                          onPress={() => { haptics.tap(); setPicking(task); }}
                          accessibilityLabel={`Pick a date for ${displayTitleFor(task)}`}
                        >
                          <Text style={styles.actionText}>Pick…</Text>
                        </PressableScale>
                      </View>
                    )}
                  </View>
                ))
              )}

              <PressableScale
                style={styles.nextButton}
                onPress={next}
                accessibilityLabel={index === stages.length - 1 ? 'Finish the review' : 'Next stage'}
              >
                <Text style={styles.nextText}>
                  {index === stages.length - 1 ? 'Finish' : 'Next'}
                </Text>
              </PressableScale>
            </>
          )}
        </ScrollView>

        {/* Nested inside this sheet's own Modal rather than beside it: a Modal
            presents from the controller its React parent belongs to, so a
            sibling would ask this sheet's controller to present a second thing
            while it is already up. Same reason DeliverablePromptSheet nests its
            own WhenPicker. */}
        <WhenPicker
          visible={picking !== null}
          value={picking?.dueDate ? new Date(picking.dueDate) : null}
          onConfirm={(date: Date | null) => {
            if (picking) moveTo(picking, date);
            setPicking(null);
          }}
          onCancel={() => setPicking(null)}
          // No time-of-day and no Suggest: this is a re-dating pass over a pile,
          // not the task's own schedule being authored, and the same two flags
          // every caller that is only asking "what day" already turns off.
          showTimeOfDay={false}
          showSuggest={false}
        />
      </View>
    </SheetModal>
  );
}

const makeStyles = (colors: Colors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  progress: {
    flexDirection: 'row',
    gap: spacing.xs,
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.sm,
  },
  pip: {
    flex: 1,
    height: 3,
    borderRadius: 2,
    backgroundColor: colors.bgTertiary,
  },
  pipOn: { backgroundColor: colors.accent },
  body: { flex: 1 },
  content: { paddingHorizontal: spacing.md },
  // flexGrow so the finished state can centre itself, per EmptyState's note.
  doneContent: { flexGrow: 1 },
  stageHead: {
    flexDirection: 'row',
    gap: spacing.smd,
    alignItems: 'flex-start',
    marginBottom: spacing.md,
  },
  stageIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.accentSubtle,
  },
  stageText: { flex: 1 },
  stageTitle: { fontSize: font.xl, fontWeight: fontWeight.semibold, color: colors.text },
  stageHint: { fontSize: font.sm, color: colors.textSecondary, marginTop: spacing.xxs },
  card: {
    backgroundColor: colors.bgSecondary,
    borderRadius: radius.md,
    padding: spacing.lg,
    alignItems: 'center',
  },
  lookCount: { fontSize: font.xxl, fontWeight: fontWeight.bold, color: colors.text },
  lookLabel: { fontSize: font.sm, color: colors.textSecondary, marginTop: spacing.xs },
  row: {
    backgroundColor: colors.bgSecondary,
    borderRadius: radius.md,
    padding: spacing.smd,
    marginBottom: spacing.xs,
  },
  rowTitle: { fontSize: font.md, color: colors.text },
  // A wrapping row underneath the name rather than beside it, so the title
  // never loses the row to a set of buttons whose labels can grow. See the
  // note in CLAUDE.md about a numberOfLines title sharing a flex row.
  actions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
    marginTop: spacing.sm,
  },
  action: {
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.smd,
    borderRadius: radius.sm,
    backgroundColor: colors.bgTertiary,
  },
  actionText: { fontSize: font.sm, color: colors.accent },
  nextButton: {
    marginTop: spacing.lg,
    paddingVertical: spacing.smd,
    borderRadius: radius.md,
    backgroundColor: colors.accent,
    alignItems: 'center',
  },
  nextText: { fontSize: font.md, fontWeight: fontWeight.semibold, color: colors.onAccent },
  sep: { height: border.hairline, backgroundColor: colors.separator },
});
