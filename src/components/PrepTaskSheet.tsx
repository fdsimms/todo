import React, { useState, useEffect, useMemo } from 'react';
import { View, Text, TextInput, StyleSheet } from 'react-native';
import type { RecipePrepTask } from '../types';
import { TITLE_MAX_LENGTH } from '../types';
import { useRecipeStore } from '../store/useRecipeStore';
import { useColors } from '../theme/ThemeContext';
import { spacing, radius, font, fontWeight, type Colors } from '../theme';
import { formatOffsetLabel, formatMinutesOffset } from '../utils/templateUtils';
import { PREP_OFFSET_MIN, PREP_OFFSET_MAX } from '../utils/recipeUtils';
import { CountStepper } from './CountStepper';
import { SheetHeaderButton } from './SheetHeaderButton';
import { EditorSheet } from './EditorSheet';

interface Props {
  visible: boolean;
  recipeId: string;
  prepTask: RecipePrepTask | null;
  onClose: () => void;
}

const REMINDER_STEP_MINUTES = 15;
// A day either side of the meal covers everything a kitchen prep step needs —
// "thaw the turkey" a week out is a Task with its own due date, not a recipe
// prep task.
// 24 hours in 15-minute steps.
const REMINDER_STEPS_MAX = 96;

/**
 * One prep task: what to do and when, relative to the meal's date — the same
 * offset model TemplateItem uses, reduced to the two fields a kitchen step
 * needs. See resolvePrepTaskDraft for how offsetDays/reminderOffsetMinutes
 * resolve to an actual due date once a meal is scheduled.
 */
export function PrepTaskSheet({ visible, recipeId, prepTask, onClose }: Props) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const updatePrepTask = useRecipeStore(s => s.updatePrepTask);

  const [title, setTitle] = useState('');
  const [offsetDays, setOffsetDays] = useState(-1);
  const [reminderOffsetMinutes, setReminderOffsetMinutes] = useState<number | null>(null);

  useEffect(() => {
    if (!prepTask) return;
    setTitle(prepTask.title);
    setOffsetDays(prepTask.offsetDays);
    setReminderOffsetMinutes(prepTask.reminderOffsetMinutes);
  }, [prepTask]);

  const saveAndClose = () => {
    if (!prepTask) { onClose(); return; }
    const trimmed = title.trim();
    // An emptied title would strand the row — keep the old one rather than
    // storing something with nothing to remind about.
    updatePrepTask(recipeId, prepTask.id, {
      title: trimmed || prepTask.title,
      offsetDays,
      reminderOffsetMinutes,
    });
    onClose();
  };

  if (!prepTask) return null;

  const reminderSteps = reminderOffsetMinutes === null ? null : Math.round(reminderOffsetMinutes / REMINDER_STEP_MINUTES);

  return (
    <EditorSheet
      visible={visible}
      onRequestClose={saveAndClose}
      rootStyle={styles.root}
      headerStyle={styles.header}
      scrollStyle={styles.scroll}
      scrollContentStyle={styles.scrollContent}
      header={
        <>
          <SheetHeaderButton label="Done" onPress={saveAndClose} minWidth={40} />
          <Text style={styles.headerTitle}>Prep task</Text>
          <View style={styles.headerSpacer} />
        </>
      }
    >
      <View style={styles.sectionCard}>
        <Text style={styles.groupLabel}>What to do</Text>
        <TextInput
          style={styles.input}
          value={title}
          onChangeText={setTitle}
          placeholder="e.g. Marinate the chicken"
          placeholderTextColor={colors.textTertiary}
          maxLength={TITLE_MAX_LENGTH}
          accessibilityLabel="Prep task title"
        />
      </View>

      <View style={styles.sectionCard}>
        <Text style={styles.groupLabel}>When</Text>
        <CountStepper
          value={offsetDays}
          onChange={n => setOffsetDays(n ?? 0)}
          min={PREP_OFFSET_MIN}
          max={PREP_OFFSET_MAX}
          format={n => formatOffsetLabel(n)}
          label="Days before the meal"
        />
        <Text style={styles.hint}>
          Once this recipe is on a planned meal, this task lands on that day.
        </Text>
      </View>

      <View style={styles.sectionCard}>
        <Text style={styles.groupLabel}>Reminder</Text>
        <CountStepper
          value={reminderSteps}
          onChange={n => setReminderOffsetMinutes(n === null ? null : n * REMINDER_STEP_MINUTES)}
          min={0}
          max={REMINDER_STEPS_MAX}
          allowNull
          emptyLabel="No reminder"
          format={n => formatMinutesOffset(n * REMINDER_STEP_MINUTES)}
          label="Reminder"
        />
      </View>
    </EditorSheet>
  );
}

const makeStyles = (colors: Colors) => StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.separator,
  },
  headerTitle: {
    color: colors.text,
    fontSize: font.md,
    fontWeight: fontWeight.semibold,
  },
  headerSpacer: {
    width: 40,
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    padding: spacing.md,
    gap: spacing.md,
    paddingBottom: spacing.xl * 2,
  },
  sectionCard: {
    backgroundColor: colors.bgSecondary,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    gap: spacing.xs,
  },
  groupLabel: {
    color: colors.textSecondary,
    fontSize: font.xs,
    fontWeight: fontWeight.semibold,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
  input: {
    color: colors.text,
    fontSize: font.md,
    minHeight: 36,
  },
  hint: {
    color: colors.textTertiary,
    fontSize: font.xs,
    lineHeight: font.xs * 1.4,
  },
});
