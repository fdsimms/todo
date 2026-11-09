import React, { useEffect, useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SheetModal } from './SheetModal';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useTaskStore } from '../store/useTaskStore';
import { useTaskGroupStore } from '../store/useTaskGroupStore';
import { useColors } from '../theme/ThemeContext';
import { border, font, fontWeight, iconSize, interaction, radius, spacing, type Colors } from '../theme';
import { haptics } from '../utils/haptics';
import { animateLayout } from '../utils/layoutAnimation';
import { EmptyState } from './EmptyState';
import { SheetHeaderButton } from './SheetHeaderButton';
import type { Task, TaskGroup } from '../types';
import { hasMission } from '../utils/missions';
import { isAnsweredByRecord } from '../utils/recordTasks';
import { BUTTON_LABEL } from '../copy/shared';

interface Props {
  visible: boolean;
  onClose: () => void;
  /** The tasks to review, already filtered — see morningCheckInTasks. */
  tasks: Task[];
}

interface SheetGroup {
  key: string;
  label: string;
  tasks: Task[];
}

type AnswerKind = 'yes' | 'someoneElse' | 'skip' | 'missed';

/**
 * What was said about one task, kept here because answering it removes it from
 * `tasks`. The group is captured with it for the same reason: by the time the
 * review draws, the task row is no longer there to read it from.
 */
interface Answer {
  taskId: string;
  title: string;
  groupKey: string;
  groupLabel: string;
  kind: AnswerKind;
  /** A skip rewrites the whole row, so taking it back puts this copy back. Unused by the other three. */
  before: Task | null;
}

/** The section a task sits under in the list and in the review: its stack, else its category. */
function groupOfTask(task: Task, groups: readonly TaskGroup[]): { key: string; label: string } {
  return {
    key: task.groupId ?? `category:${task.category ?? ''}`,
    label: task.groupId
      ? (groups.find(g => g.id === task.groupId)?.title ?? 'Stack')
      : (task.category ?? 'No category'),
  };
}

const ANSWER_DISPLAY: Record<AnswerKind, { label: string; icon: React.ComponentProps<typeof Ionicons>['name'] }> = {
  yes: { label: 'Did it', icon: 'checkmark' },
  someoneElse: { label: 'Someone else did it', icon: 'people-outline' },
  skip: { label: 'Skipped', icon: 'play-skip-forward-outline' },
  missed: { label: 'Missed', icon: 'close' },
};

/**
 * Shown once a day if anything qualifies (see morningCheckIn.ts): recurring
 * tasks whose day has already passed with nothing said about them yet. Lets
 * the user answer "did you get to this?" for each one instead of leaving it to
 * just sit there looking overdue, or to quietly roll over unresolved.
 *
 * Yes backdates the completion to the day the task was actually due — see
 * completeTask's `completedAt` option — so it reads as done last night, not
 * done the moment this sheet was answered, and streaks land the same way
 * completing it on time would have. Someone else did it backdates the same way
 * and closes the occurrence with no coins and the streak untouched. Skip moves
 * to the next date with nothing recorded, and Missed hands it to markMissed.
 * These are the same four ways the row's checkbox hold menu closes a repeating
 * task (CompletionOptionsMenu), so a task is never offered fewer here.
 *
 * Once the last one is answered the list gives way to a review of the answers
 * given in this opening. Each row has an Undo that reopens the task, which
 * brings it back into the list above the rest.
 *
 * Every tap commits straight through to the store, the same reasoning
 * RuleListSheet gives for skipping an unsaved-changes guard: there's nothing
 * staged here to lose on a swipe-down, so `close` needs no confirm.
 */
export function MorningCheckInSheet({ visible, onClose, tasks }: Props) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const completeTask = useTaskStore(s => s.completeTask);
  const markMissed = useTaskStore(s => s.markMissed);
  const skipNextRecurrence = useTaskStore(s => s.skipNextRecurrence);
  const uncompleteTask = useTaskStore(s => s.uncompleteTask);
  const updateTask = useTaskStore(s => s.updateTask);
  const groups = useTaskGroupStore(s => s.groups);

  // Answers given since the sheet last opened. Cleared on open rather than on
  // close, so the review doesn't empty itself while the sheet is sliding away.
  const [answers, setAnswers] = useState<Answer[]>([]);
  useEffect(() => {
    if (visible) setAnswers([]);
  }, [visible]);

  const record = (task: Task, kind: AnswerKind, before: Task | null = null) => {
    const { key, label } = groupOfTask(task, groups);
    setAnswers(prev => [
      ...prev.filter(a => a.taskId !== task.id),
      { taskId: task.id, title: task.title, groupKey: key, groupLabel: label, kind, before },
    ]);
  };

  // Takes one answer back through the same store actions the row's own undo
  // uses, and drops it from the review only if the task actually reopened:
  // uncompleteTask refuses once a later occurrence exists, and claiming an
  // undo that didn't happen would be worse than leaving the row listed.
  // The task is back in `tasks` afterward, so the list reappears under it.
  const undoAnswer = (answer: Answer) => {
    haptics.tap();
    if (answer.kind === 'skip') {
      if (!answer.before) return;
      animateLayout();
      updateTask(answer.taskId, answer.before);
    } else {
      uncompleteTask(answer.taskId);
      const reopened = useTaskStore.getState().tasks.find(t => t.id === answer.taskId);
      if (!reopened || reopened.completed) return;
      animateLayout();
    }
    setAnswers(prev => prev.filter(a => a.taskId !== answer.taskId));
  };

  const sheetGroups = useMemo(() => {
    const byKey = new Map<string, SheetGroup>();
    for (const task of tasks) {
      const { key, label } = groupOfTask(task, groups);
      const existing = byKey.get(key);
      if (existing) existing.tasks.push(task);
      else byKey.set(key, { key, label, tasks: [task] });
    }
    return Array.from(byKey.values());
  }, [tasks, groups]);

  const total = tasks.length;

  const answeredGroups = useMemo(() => {
    const byKey = new Map<string, { key: string; label: string; answers: Answer[] }>();
    for (const a of answers) {
      const existing = byKey.get(a.groupKey);
      if (existing) existing.answers.push(a);
      else byKey.set(a.groupKey, { key: a.groupKey, label: a.groupLabel, answers: [a] });
    }
    return Array.from(byKey.values());
  }, [answers]);
  const showReview = total === 0 && answers.length > 0;

  const answerTint = (kind: AnswerKind) =>
    kind === 'yes' ? colors.done : kind === 'missed' ? colors.red : colors.accent;

  const answerYes = (task: Task) => {
    haptics.success();
    animateLayout();
    completeTask(task.id, { completedAt: task.dueDate ?? undefined });
    record(task, 'yes');
  };

  const answerSomeoneElse = (task: Task) => {
    haptics.tap();
    animateLayout();
    completeTask(task.id, { byOther: true, completedAt: task.dueDate ?? undefined });
    record(task, 'someoneElse');
  };

  const answerSkip = (task: Task) => {
    haptics.tap();
    animateLayout();
    const before = useTaskStore.getState().tasks.find(t => t.id === task.id) ?? task;
    skipNextRecurrence(task.id);
    record(task, 'skip', { ...before });
  };

  const answerMissed = (task: Task) => {
    haptics.impactMedium();
    animateLayout();
    markMissed(task.id);
    record(task, 'missed');
  };

  const renderChoice = (
    label: string,
    icon: React.ComponentProps<typeof Ionicons>['name'],
    tint: string,
    onPress: () => void,
    accessibilityLabel: string,
  ) => (
    <TouchableOpacity
      key={label}
      style={[styles.choiceBtn, { borderColor: tint }]}
      activeOpacity={interaction.activeOpacity}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
    >
      <Ionicons name={icon} size={iconSize.sm} color={tint} />
      <Text style={styles.choiceLabel}>{label}</Text>
    </TouchableOpacity>
  );

  return (
    <SheetModal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={styles.root}>
        <View style={styles.header}>
          <SheetHeaderButton label={BUTTON_LABEL.done} onPress={onClose} minWidth={56} />
        </View>
        <View style={styles.titleBlock}>
          <Text style={styles.title}>Morning check-in</Text>
          <Text style={styles.subtitle}>
            {showReview
              ? "You’re all caught up. Here’s what you answered."
              : total === 0
              ? "You’re all caught up."
              : "Repeating tasks from yesterday are still unanswered. Did you get to them?"}
          </Text>
        </View>

        <ScrollView contentContainerStyle={total === 0 && !showReview ? styles.listEmpty : styles.list}>
          {showReview ? (
            answeredGroups.map(group => (
              <View key={group.key} style={styles.groupBlock}>
                <Text style={styles.groupLabel}>{group.label}</Text>
                <View style={styles.card}>
                  {group.answers.map((a, i) => (
                    <View key={a.taskId}>
                      <View style={styles.answeredRow}>
                        <View style={styles.answeredBody}>
                          <Text style={styles.rowTitle}>{a.title}</Text>
                          <View style={styles.answerLine}>
                            <Ionicons name={ANSWER_DISPLAY[a.kind].icon} size={iconSize.sm} color={answerTint(a.kind)} />
                            <Text style={styles.answerText}>{ANSWER_DISPLAY[a.kind].label}</Text>
                          </View>
                        </View>
                        <TouchableOpacity
                          activeOpacity={interaction.activeOpacity}
                          onPress={() => undoAnswer(a)}
                          hitSlop={8}
                          accessibilityRole="button"
                          accessibilityLabel={`Undo “${ANSWER_DISPLAY[a.kind].label}” for ${a.title}`}
                        >
                          <Text style={styles.undoText}>Undo</Text>
                        </TouchableOpacity>
                      </View>
                      {i < group.answers.length - 1 && <View style={styles.sep} />}
                    </View>
                  ))}
                </View>
              </View>
            ))
          ) : total === 0 ? (
            <EmptyState
              icon="checkmark-circle-outline"
              title="Nothing to review"
              subtitle="Everything from yesterday is accounted for."
            />
          ) : (
            sheetGroups.map(group => (
              <View key={group.key} style={styles.groupBlock}>
                <Text style={styles.groupLabel}>{group.label}</Text>
                <View style={styles.card}>
                  {group.tasks.map((task, i) => (
                    <View key={task.id}>
                      <View style={styles.row}>
                        <Text style={styles.rowTitle}>{task.title}</Text>
                        <View style={styles.choice}>
                          {/* Yesterday's mission can't be done now, and
                              completeTask refuses a tick the mission didn't
                              make, so a task with one has no Did it. Someone
                              else and a miss are the exceptions it allows. */}
                          {!hasMission(task) && renderChoice('Did it', 'checkmark', colors.done, () => answerYes(task), `Did ${task.title}`)}
                          {/* A task only its own record can complete has no
                              someone-else answer, as in the hold menu. */}
                          {!isAnsweredByRecord(task) && renderChoice('Someone else', 'people-outline', colors.accent, () => answerSomeoneElse(task), `Someone else did ${task.title}. No coins, and your streak is unchanged.`)}
                          {renderChoice('Skip', 'play-skip-forward-outline', colors.accent, () => answerSkip(task), `Skip ${task.title}. Moves to the next date and nothing is recorded.`)}
                          {renderChoice('Missed', 'close', colors.red, () => answerMissed(task), `Didn’t do ${task.title}`)}
                        </View>
                      </View>
                      {i < group.tasks.length - 1 && <View style={styles.sep} />}
                    </View>
                  ))}
                </View>
              </View>
            ))
          )}
        </ScrollView>
      </View>
    </SheetModal>
  );
}

function makeStyles(colors: Colors) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: colors.bg },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'flex-end',
      paddingHorizontal: spacing.md,
      paddingTop: spacing.md,
      paddingBottom: spacing.sm,
    },
    titleBlock: { paddingHorizontal: spacing.md, paddingBottom: spacing.md },
    title: { color: colors.text, fontSize: font.xxl, fontWeight: fontWeight.bold },
    subtitle: { color: colors.textSecondary, fontSize: font.sm, marginTop: spacing.sm },
    list: { padding: spacing.md, paddingBottom: spacing.xl },
    listEmpty: { flexGrow: 1, padding: spacing.md, paddingBottom: spacing.xl },
    groupBlock: { marginBottom: spacing.md },
    groupLabel: {
      color: colors.textSecondary,
      fontSize: font.xs,
      fontWeight: fontWeight.semibold,
      textTransform: 'uppercase',
      letterSpacing: 0.8,
      marginBottom: spacing.xs,
      marginLeft: spacing.xs,
    },
    card: { backgroundColor: colors.bgSecondary, borderRadius: radius.md },
    sep: { height: border.hairline, backgroundColor: colors.separator, marginLeft: spacing.md },
    // The title takes the whole line and the answers sit under it, so a long
    // task name is never squeezed by the buttons beside it.
    row: {
      gap: spacing.smd,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.md,
    },
    rowTitle: { color: colors.text, fontSize: font.md },
    choice: { flexDirection: 'row', gap: spacing.sm },
    answeredRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.smd,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.md,
    },
    answeredBody: { flex: 1, minWidth: 0, gap: spacing.xs },
    undoText: { color: colors.accent, fontSize: font.sm, fontWeight: fontWeight.semibold },
    answerLine: { flexDirection: 'row', alignItems: 'center', gap: spacing.xsm },
    answerText: { color: colors.textSecondary, fontSize: font.sm },
    choiceBtn: {
      flex: 1,
      minHeight: 52,
      borderRadius: radius.md,
      alignItems: 'center',
      justifyContent: 'center',
      gap: spacing.xxs,
      paddingHorizontal: spacing.xs,
      borderWidth: border.hairline,
    },
    choiceLabel: {
      color: colors.text,
      fontSize: font.xs,
      fontWeight: fontWeight.semibold,
      textAlign: 'center',
    },
  });
}
