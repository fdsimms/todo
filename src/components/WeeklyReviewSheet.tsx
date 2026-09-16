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
import { CategoryPickerSheet } from './CategoryPicker';
import { useTaskStore } from '../store/useTaskStore';
import { usePersonStore, displayNameOf } from '../store/usePersonStore';
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
  describeStuckRow,
  describeWeeklyReviewDone,
  slippedTasks,
  stuckActionFor,
  stuckKindOf,
  stuckPile,
  weeklyReviewRows,
  weeklyReviewStages,
  type StuckKind,
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
 * asymmetry lives. A review that grew its own way of moving a task would be a
 * fifth half-implementation of the thing `taskMoves.ts` exists to hold.
 *
 * **Every stage that lists rows offers the action that stage is asking for**,
 * which is the rule the stuck stage broke: it listed titles and nothing else,
 * so the one stage whose hint promises to tell two kinds of hold apart was the
 * one that said neither which nor what to do about it. The action differs by
 * what is holding the row rather than being a date for everything — see
 * `stuckActionFor`, and `StuckScreen`'s own note on why a wait is released and
 * a drift is decided.
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
  // Subscribed so "Waiting on <name>" follows somebody being renamed or
  // archived, the same read StuckScreen makes for its own wait headings.
  const people = usePersonStore(useShallow(s => s.people));
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
  const [unblocked, setUnblocked] = useState(0);
  const [picking, setPicking] = useState<Task | null>(null);
  const [filing, setFiling] = useState<Task | null>(null);

  // What a stuck row is waiting on, by name. Both resolve-or-shrug: a blocker
  // frees its waiters when it is deleted or completed and a person can be
  // archived, so `describeStuckRow` is written to take a miss rather than this
  // having to guarantee a hit.
  //
  // Built only while the sheet is up. TodayScreen mounts this component for
  // the whole life of the screen, so an ungated walk of every task would run
  // `displayTitleFor` over the lot on every task-store write to a sheet nobody
  // is looking at.
  const taskTitles = useMemo(
    () => (visible ? new Map(tasks.map(t => [t.id, displayTitleFor(t)])) : new Map<string, string>()),
    [visible, tasks],
  );
  const personNames = useMemo(
    () => (visible ? new Map(people.map(p => [p.id, displayNameOf(p)])) : new Map<string, string>()),
    [visible, people],
  );

  // Recomputed from live state rather than held, which is what makes the
  // ordering pay off — see the note above.
  const input = useMemo<WeeklyReviewInput>(() => ({
    inbox: inboxTasks(),
    stuck: stuckPile(waitingTasks(), driftingTaskList()),
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
    setTimeout(() => { setIndex(0); setFiled(0); setMoved(0); setUnblocked(0); }, 0);
  }, [onClose]);

  const next = () => {
    haptics.tap();
    animateLayout();
    setIndex(i => i + 1);
  };

  // Skip is one tap from Next in the header, and a stage skipped by accident
  // was otherwise only recoverable by closing the review and opening it again.
  // Nothing is undone by going back: the stages are recomputed from live state
  // on every render, so an earlier one re-derives around whatever the later
  // ones already changed.
  const back = () => {
    haptics.tap();
    animateLayout();
    setIndex(i => Math.max(0, i - 1));
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

  // Giving an inbox task a category is the other half of what this stage's own
  // hint asks for, and the one the sheet had no control for — so a task
  // captured with no date *and* no category could only leave the pile by being
  // dated, which is an answer to a question the person may not have.
  const fileUnder = (task: Task, category: string | null) => {
    haptics.tap();
    animateLayout();
    updateTask(task.id, { category });
    setFiled(n => n + 1);
  };

  // The one action that ends a stuck row's hold, which differs by what is
  // holding it: a wait is released, a drift is a decision (see stuckActionFor).
  const resolveStuck = (task: Task, kind: StuckKind) => {
    if (stuckActionFor(kind).key === 'today') {
      // Through moveTo like every other date in this sheet, so the pull-forward
      // rule stays in taskMoves.ts rather than being restated here.
      moveTo(task, getLogicalToday(dayResetTime));
      return;
    }
    haptics.tap();
    animateLayout();
    // Both, always: clearing only the one the row was filed under would leave
    // it waiting on the other with nothing left on screen to say so. Same call
    // StuckScreen's own release makes, for that reason.
    updateTask(task.id, { blockedById: null, waitingOnPersonId: null });
    setUnblocked(n => n + 1);
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
              subtitle={describeWeeklyReviewDone(filed, moved, unblocked)}
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
                rows.map(task => {
                  const title = displayTitleFor(task);
                  // A held-back task is never offered a date: it has not
                  // slipped, it is waiting, and a date would answer the wrong
                  // question. Same line slippedTasks draws. What it is offered
                  // instead is the action that ends the hold it is actually
                  // under, which is what this stage's hint promises to tell it
                  // apart — a column of bare titles said neither.
                  const kind = stage!.id === 'stuck' ? stuckKindOf(task) : null;
                  const action = kind ? stuckActionFor(kind) : null;
                  return (
                    <View key={task.id} style={styles.row}>
                      <Text style={styles.rowTitle} numberOfLines={2}>{title}</Text>
                      {kind && (
                        <Text style={styles.rowMeta} numberOfLines={1}>
                          {describeStuckRow(kind, {
                            blockerTitle: task.blockedById ? taskTitles.get(task.blockedById) : null,
                            personName: task.waitingOnPersonId ? personNames.get(task.waitingOnPersonId) : null,
                            postponeCount: task.postponeCount,
                          })}
                        </Text>
                      )}
                      <View style={styles.actions}>
                        {kind && action ? (
                          <PressableScale
                            style={styles.action}
                            onPress={() => resolveStuck(task, kind)}
                            accessibilityLabel={`${action.label}: ${title}`}
                          >
                            <Text style={styles.actionText}>{action.label}</Text>
                          </PressableScale>
                        ) : (
                          <>
                            <PressableScale
                              style={styles.action}
                              onPress={() => moveTo(task, getLogicalToday(dayResetTime))}
                              accessibilityLabel={`Move ${title} to today`}
                            >
                              <Text style={styles.actionText}>Today</Text>
                            </PressableScale>
                            <PressableScale
                              style={styles.action}
                              onPress={() => moveTo(task, getLogicalTomorrow(dayResetTime))}
                              accessibilityLabel={`Move ${title} to tomorrow`}
                            >
                              <Text style={styles.actionText}>Tomorrow</Text>
                            </PressableScale>
                            <PressableScale
                              style={styles.action}
                              onPress={() => { haptics.tap(); setPicking(task); }}
                              accessibilityLabel={`Pick a date for ${title}`}
                            >
                              <Text style={styles.actionText}>Pick…</Text>
                            </PressableScale>
                            {stage!.id === 'inbox' && (
                              <PressableScale
                                style={styles.action}
                                onPress={() => { haptics.tap(); setFiling(task); }}
                                accessibilityLabel={`Pick a category for ${title}`}
                              >
                                <Text style={styles.actionText}>Category…</Text>
                              </PressableScale>
                            )}
                          </>
                        )}
                      </View>
                    </View>
                  );
                })
              )}

              <View style={styles.footer}>
                {index > 0 && (
                  <PressableScale
                    style={styles.backButton}
                    onPress={back}
                    accessibilityLabel="Previous stage"
                  >
                    <Text style={styles.backText}>Back</Text>
                  </PressableScale>
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
              </View>
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

        {/* Nested for the same reason WhenPicker above is, and `showNone` off
            because filing is the whole point here: an inbox task already has
            no category, so "None" would be a row that changes nothing while
            reading like an answer. */}
        <CategoryPickerSheet
          visible={filing !== null}
          title="File under"
          value={filing?.category ?? undefined}
          showNone={false}
          onSelect={(name: string | null) => {
            if (filing) fileUnder(filing, name);
            setFiling(null);
          }}
          onClose={() => setFiling(null)}
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
  // Which hold a stuck row is under. `textSecondary` rather than the
  // `textTertiary` StuckScreen's own drift line carries: there it is context
  // beside a row that already offers its actions, here it is the thing the
  // stage's hint promises to tell you, which is information rather than a dim
  // aside. Same call EmptyNote's text makes, and it clears the contrast floor
  // tertiary misses on this surface.
  rowMeta: { fontSize: font.xs, color: colors.textSecondary, marginTop: spacing.xxs },
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
  footer: {
    flexDirection: 'row',
    gap: spacing.xs,
    marginTop: spacing.lg,
  },
  backButton: {
    paddingVertical: spacing.smd,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.md,
    backgroundColor: colors.bgTertiary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  backText: { fontSize: font.md, fontWeight: fontWeight.semibold, color: colors.accent },
  nextButton: {
    flex: 1,
    paddingVertical: spacing.smd,
    borderRadius: radius.md,
    backgroundColor: colors.accent,
    alignItems: 'center',
  },
  nextText: { fontSize: font.md, fontWeight: fontWeight.semibold, color: colors.onAccent },
  sep: { height: border.hairline, backgroundColor: colors.separator },
});
