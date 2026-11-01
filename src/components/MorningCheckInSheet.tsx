import React, { useMemo } from 'react';
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
import type { Task } from '../types';
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
  const groups = useTaskGroupStore(s => s.groups);

  const sheetGroups = useMemo(() => {
    const byKey = new Map<string, SheetGroup>();
    for (const task of tasks) {
      const key = task.groupId ?? `category:${task.category ?? ''}`;
      const label = task.groupId
        ? (groups.find(g => g.id === task.groupId)?.title ?? 'Stack')
        : (task.category ?? 'No category');
      const existing = byKey.get(key);
      if (existing) existing.tasks.push(task);
      else byKey.set(key, { key, label, tasks: [task] });
    }
    return Array.from(byKey.values());
  }, [tasks, groups]);

  const total = tasks.length;

  const answerYes = (task: Task) => {
    haptics.success();
    animateLayout();
    completeTask(task.id, { completedAt: task.dueDate ?? undefined });
  };

  const answerSomeoneElse = (task: Task) => {
    haptics.tap();
    animateLayout();
    completeTask(task.id, { byOther: true, completedAt: task.dueDate ?? undefined });
  };

  const answerSkip = (task: Task) => {
    haptics.tap();
    animateLayout();
    skipNextRecurrence(task.id);
  };

  const answerMissed = (task: Task) => {
    haptics.impactMedium();
    animateLayout();
    markMissed(task.id);
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
            {total === 0
              ? "You’re all caught up."
              : "Repeating tasks from yesterday are still unanswered. Did you get to them?"}
          </Text>
        </View>

        <ScrollView contentContainerStyle={total === 0 ? styles.listEmpty : styles.list}>
          {total === 0 ? (
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
