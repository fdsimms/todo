import React, { useMemo } from 'react';
import { Modal, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
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
 * tasks with a deadline set whose day has already passed with nothing said
 * about them yet. Scoped to tasks the user marked with a deadline rather than
 * every overdue recurring task, or a daily habit with no deadline would
 * trigger this prompt every time it was missed. Lets the user answer "did
 * you get to this?" for each one instead of leaving it to just sit there
 * looking overdue, or to quietly roll over unresolved.
 *
 * Yes backdates the completion to the day the task was actually due — see
 * completeTask's `completedAt` option — so it reads as done last night, not
 * done the moment this sheet was answered, and streaks land the same way
 * completing it on time would have. No hands it to markMissed, same as the
 * row's own "I didn't get to this" action.
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

  const answerNo = (task: Task) => {
    haptics.tap();
    animateLayout();
    markMissed(task.id);
  };

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={styles.root}>
        <View style={styles.header}>
          <Text style={styles.eyebrow}>Yesterday</Text>
          <SheetHeaderButton label="Done" onPress={onClose} minWidth={56} />
        </View>
        <View style={styles.titleBlock}>
          <Text style={styles.title}>Morning check-in</Text>
          <Text style={styles.subtitle}>
            {total === 0
              ? "You're all caught up."
              : "A few tasks with a deadline from yesterday are still unanswered. Did you get to them?"}
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
                        <Text style={styles.rowTitle} numberOfLines={1}>{task.title}</Text>
                        <View style={styles.choice}>
                          <TouchableOpacity
                            style={[styles.choiceBtn, styles.choiceBtnNo]}
                            activeOpacity={interaction.activeOpacity}
                            onPress={() => answerNo(task)}
                            accessibilityRole="button"
                            accessibilityLabel={`Didn't do ${task.title}`}
                          >
                            <Ionicons name="close" size={iconSize.sm} color={colors.red} />
                          </TouchableOpacity>
                          <TouchableOpacity
                            style={[styles.choiceBtn, styles.choiceBtnYes]}
                            activeOpacity={interaction.activeOpacity}
                            onPress={() => answerYes(task)}
                            accessibilityRole="button"
                            accessibilityLabel={`Did ${task.title}`}
                          >
                            <Ionicons name="checkmark" size={iconSize.sm} color={colors.green} />
                          </TouchableOpacity>
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
    </Modal>
  );
}

function makeStyles(colors: Colors) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: colors.bg },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: spacing.md,
      paddingTop: spacing.md,
    },
    eyebrow: {
      color: colors.accentText,
      fontSize: font.sm,
      fontWeight: fontWeight.semibold,
      textTransform: 'uppercase',
      letterSpacing: 0.8,
    },
    titleBlock: { paddingHorizontal: spacing.md, paddingBottom: spacing.md },
    title: { color: colors.text, fontSize: font.xxl, fontWeight: fontWeight.bold },
    subtitle: { color: colors.textSecondary, fontSize: font.sm, marginTop: spacing.xs },
    list: { padding: spacing.md, paddingBottom: spacing.xl },
    listEmpty: { flexGrow: 1, padding: spacing.md, paddingBottom: spacing.xl },
    groupBlock: { marginBottom: spacing.md },
    groupLabel: {
      color: colors.textTertiary,
      fontSize: font.xs,
      fontWeight: fontWeight.semibold,
      textTransform: 'uppercase',
      letterSpacing: 0.8,
      marginBottom: spacing.xs,
      marginLeft: spacing.xs,
    },
    card: { backgroundColor: colors.bgSecondary, borderRadius: radius.md },
    sep: { height: border.hairline, backgroundColor: colors.separator, marginLeft: spacing.md },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.md,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.md,
    },
    rowTitle: { flex: 1, color: colors.text, fontSize: font.md },
    choice: { flexDirection: 'row', gap: spacing.sm },
    choiceBtn: {
      width: 36,
      height: 36,
      borderRadius: 18,
      alignItems: 'center',
      justifyContent: 'center',
      borderWidth: border.hairline,
    },
    choiceBtnNo: { borderColor: colors.red },
    choiceBtnYes: { borderColor: colors.green },
  });
}
