import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, type StyleProp, type ViewStyle } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { InlineAction } from './InlineAction';
import { useColors } from '../theme/ThemeContext';
import { spacing, radius, font, fontWeight, iconSize, interaction, type Colors } from '../theme';
import { TASK_CHECKBOX_SIZE } from './TaskCheckbox';
import { PressableScale } from './PressableScale';
import { haptics } from '../utils/haptics';
import {
  doseStepper, isRunnable, MAX_DOSE_STEPS, MAX_GLASSES, withDoseCount, withGlasses,
  type ActionDescription, type PantryAnswer, type SearchAction,
} from '../utils/searchActions';
import { SYMPTOM_SEVERITIES } from '../utils/moodLog';
import type { SearchActionReceipt } from '../utils/searchActionRun';

const PANTRY_ANSWERS: { value: PantryAnswer; label: string }[] = [
  { value: 'out', label: 'Out of it' },
  { value: 'low', label: 'Running low' },
];

/**
 * One search action ("Record a dose of Aleve", "Add milk to Groceries"), in
 * either search surface: `card` is the pull-down quick search's plain row,
 * `list` the Search screen's inset card with a tinted icon badge, matching
 * the rows around it in each.
 *
 * Once run, the row stays where it was and says what it did, with an Undo
 * beside it (see `searchActionRun.ts` for why it doesn't close the search).
 * A row that can't be run (milk already on the list) is drawn the same but
 * isn't a button, so it answers the question without offering a no-op.
 *
 * A water row carries a `− N +` stepper beside it, so several glasses are one
 * tap. The count is the row's own state (a query's rows are short-lived), and
 * the row is described and run as that many glasses through `describe`.
 *
 * A dose row that states an amount carries the same stepper, moving the amount
 * a step at a time (`doseStepper`): a counted unit by one, a measured one by
 * the amount itself.
 *
 * A symptom row carries its severity pills on a line of their own under the
 * title, so the name keeps the whole row: tapping a pill logs at that severity.
 * No pill is marked unless the line stated one, and the title does nothing
 * until one is, so a severity is always a choice.
 *
 * A receipt may carry a follow-up ("Add to grocery list" after a pantry
 * answer): a pill on a line under the receipt, so the write that already
 * happened isn't held back by a question about a second one.
 *
 * A pantry row ("out of milk") is the same shape with Out of it / Running low
 * as the pills. The line always names one, so that pill is marked and the
 * title runs it; a tap on the other writes that instead.
 */
export function SearchActionRow({ action, description, describe, receipt, layout, onRun, onUndo, onFollowUp }: {
  action: SearchAction;
  description: ActionDescription;
  /** Describes the action as stepped, for the water row's count. */
  describe: (action: SearchAction) => ActionDescription;
  receipt: SearchActionReceipt | null;
  layout: 'card' | 'list';
  onRun: (action: SearchAction) => void;
  onUndo: (action: SearchAction) => void;
  onFollowUp: (action: SearchAction) => void;
}) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const list = layout === 'list';

  // A typed "3 glasses of water" starts the stepper at 3, and a new query
  // that reads differently starts it over. A dose row's stepper starts at the
  // amount it would have recorded.
  const doseSteps = action.kind === 'dose' ? doseStepper(action) : null;
  const typedCount = action.kind === 'water' ? action.glasses : doseSteps?.count ?? 1;
  const baseAmount = action.kind === 'dose' ? `${action.dose.amount}${action.dose.unit}` : '';
  const [count, setCount] = useState(typedCount);
  useEffect(() => setCount(typedCount), [typedCount, baseAmount]);
  const maxCount = action.kind === 'dose' ? Math.max(MAX_DOSE_STEPS, typedCount) : MAX_GLASSES;
  let stepped: SearchAction = action;
  if (action.kind === 'water' && count !== action.glasses) stepped = withGlasses(action, count);
  else if (action.kind === 'dose' && doseSteps && count !== doseSteps.count) stepped = withDoseCount(action, count);
  if (stepped !== action) description = describe(stepped);

  const icon = (name: string) => (
    <View style={list ? styles.listIconSlot : styles.cardIconSlot}>
      <View style={list ? styles.listIconBadge : null}>
        <Ionicons name={name as keyof typeof Ionicons.glyphMap} size={iconSize.sm} color={colors.accent} />
      </View>
    </View>
  );

  if (receipt) {
    const followUp = receipt.followUp;
    const done = (
      <View style={[styles.row, list && !followUp && styles.listRow, list && followUp && styles.listShellRow]}>
        {icon('checkmark-circle')}
        <View
          style={styles.content}
          accessible
          accessibilityLabel={[receipt.title, receipt.meta].filter(Boolean).join(', ')}
        >
          <Text style={styles.title} numberOfLines={1}>{receipt.title}</Text>
          {receipt.meta.length > 0 && <Text style={styles.meta} numberOfLines={1}>{receipt.meta}</Text>}
        </View>
        <InlineAction
          label="Undo"
          variant="neutral"
          onPress={() => onUndo(action)}
          accessibilityLabel={`Undo: ${receipt.title}`}
        />
      </View>
    );
    if (!followUp) return done;
    return (
      <View style={list ? styles.listShell : null}>
        {done}
        <View style={[styles.severityRow, list ? styles.listSeverityRow : styles.cardSeverityRow]}>
          <InlineAction
            label={followUp.label}
            icon="add"
            onPress={() => onFollowUp(action)}
            accessibilityLabel={followUp.accessibilityLabel}
          />
        </View>
      </View>
    );
  }

  const body = (
    <>
      {icon(description.icon)}
      <View style={styles.content}>
        <Text style={styles.title} numberOfLines={list ? 2 : 1}>{description.title}</Text>
        {description.meta.length > 0 && (
          <Text style={styles.meta} numberOfLines={1}>
            {description.meta.map((part, i) => {
              const warn = description.warn && i === description.meta.length - 1;
              return (
                <Text key={i} style={warn ? styles.metaWarn : undefined}>
                  {i > 0 ? ' · ' : ''}{part}
                </Text>
              );
            })}
          </Text>
        )}
      </View>
    </>
  );

  const label = [description.title, ...description.meta].join(', ');
  const button = (rowStyle: StyleProp<ViewStyle>) => (
    <TouchableOpacity
      style={rowStyle}
      onPress={() => onRun(stepped)}
      activeOpacity={interaction.activeOpacity}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={action.kind === 'mood' ? 'Opens the mood log' : 'Runs it right away'}
    >
      {body}
    </TouchableOpacity>
  );
  if (action.kind === 'symptom' || action.kind === 'pantry') {
    const pills = action.kind === 'symptom'
      ? SYMPTOM_SEVERITIES.map(({ value, label: pill }) => ({
          key: String(value),
          label: pill,
          selected: value === action.severity,
          run: () => onRun({ ...action, severity: value }),
          accessibilityLabel: `Log ${action.symptom} as ${pill.toLowerCase()}`,
        }))
      : PANTRY_ANSWERS.map(({ value, label: pill }) => ({
          key: value,
          label: pill,
          selected: value === action.answer,
          run: () => onRun({ ...action, answer: value }),
          accessibilityLabel: `Mark ${action.name} as ${value === 'low' ? 'running low' : 'out'}`,
        }));
    return (
      <View style={list ? styles.listShell : null}>
        {isRunnable(action) ? (
          button([styles.row, list && styles.listShellRow])
        ) : (
          <View style={[styles.row, list && styles.listShellRow]} accessible accessibilityLabel={label}>
            {body}
          </View>
        )}
        <View style={[styles.severityRow, list ? styles.listSeverityRow : styles.cardSeverityRow]}>
          {pills.map(pill => (
            <InlineAction
              key={pill.key}
              label={pill.label}
              variant={pill.selected ? 'accent' : 'neutral'}
              onPress={pill.run}
              accessibilityLabel={pill.accessibilityLabel}
            />
          ))}
        </View>
      </View>
    );
  }
  if (!isRunnable(action)) {
    return (
      <View style={[styles.row, list && styles.listRow]} accessible accessibilityLabel={label}>
        {body}
      </View>
    );
  }
  if (action.kind === 'water' || (action.kind === 'dose' && doseSteps)) {
    const step = (delta: number) => {
      haptics.tap();
      setCount(g => Math.min(maxCount, Math.max(1, g + delta)));
    };
    const [fewer, more, valueLabel] = action.kind === 'water'
      ? ['Fewer glasses', 'More glasses', `${count} ${count === 1 ? 'glass' : 'glasses'}`]
      : ['Smaller dose', 'Larger dose', 'Dose amount'];
    // The button and the stepper are siblings rather than nested, so a screen
    // reader reads the row as one button and the stepper as its own controls.
    return (
      <View style={[styles.row, list && styles.listRow]}>
        {button(styles.rowMain)}
        <View style={styles.stepper}>
          <PressableScale
            onPress={() => step(-1)}
            disabled={count <= 1}
            style={styles.stepButton}
            accessibilityLabel={fewer}
          >
            <Ionicons name="remove" size={iconSize.sm} color={colors.text} style={count <= 1 ? styles.stepOff : undefined} />
          </PressableScale>
          {action.kind === 'water' && (
            <Text style={styles.stepValue} accessibilityLabel={valueLabel}>{count}</Text>
          )}
          <PressableScale
            onPress={() => step(1)}
            disabled={count >= maxCount}
            style={styles.stepButton}
            accessibilityLabel={more}
          >
            <Ionicons name="add" size={iconSize.sm} color={colors.text} style={count >= maxCount ? styles.stepOff : undefined} />
          </PressableScale>
        </View>
      </View>
    );
  }
  return button([styles.row, list && styles.listRow]);
}

const makeStyles = (colors: Colors) => StyleSheet.create({
  // The quick-search card's own row shape (QuickSearchModal's `resultRow`).
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: 9,
    paddingHorizontal: spacing.xs,
    borderRadius: radius.sm,
  },
  // The tappable part of a row that has a stepper beside it: the row's own
  // layout, minus the padding the wrapper carries.
  rowMain: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  stepper: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: radius.full,
    backgroundColor: colors.bgTertiary,
  },
  stepButton: { width: 36, height: 32, alignItems: 'center', justifyContent: 'center' },
  stepOff: { opacity: 0.35 },
  stepValue: { minWidth: 20, textAlign: 'center', color: colors.text, fontSize: font.md, fontWeight: fontWeight.semibold },
  // The Search screen's inset-grouped card (SearchScreen's `resultRow`).
  listRow: {
    backgroundColor: colors.bgSecondary,
    marginHorizontal: spacing.md,
    marginVertical: spacing.xxs,
    borderRadius: radius.md,
    paddingVertical: spacing.smd,
    paddingLeft: spacing.md,
    paddingRight: spacing.md,
  },
  // A symptom row is the same card with its pills inside, so the card's
  // background and margins move to a shell and the touchable keeps the padding.
  listShell: {
    backgroundColor: colors.bgSecondary,
    marginHorizontal: spacing.md,
    marginVertical: spacing.xxs,
    borderRadius: radius.md,
    paddingBottom: spacing.smd,
  },
  listShellRow: { paddingVertical: spacing.smd, paddingHorizontal: spacing.md, paddingBottom: spacing.sm },
  severityRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xsm },
  // Under the title: past the row's side padding, the icon slot and the gap.
  cardSeverityRow: { paddingLeft: spacing.xs + 20 + spacing.sm, paddingBottom: spacing.sm },
  listSeverityRow: { paddingLeft: spacing.md + TASK_CHECKBOX_SIZE + spacing.sm, paddingRight: spacing.md },
  // The slot a task row's checkbox sits in, so the icon lines up with them.
  cardIconSlot: { width: 20, alignItems: 'center' },
  listIconSlot: { width: TASK_CHECKBOX_SIZE, alignItems: 'center' },
  listIconBadge: {
    width: TASK_CHECKBOX_SIZE,
    height: TASK_CHECKBOX_SIZE,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.accentSubtle,
  },
  content: { flex: 1, gap: spacing.xxs },
  title: { color: colors.text, fontSize: font.md },
  meta: { color: colors.textSecondary, fontSize: font.xs },
  metaWarn: { color: colors.orangeText },
});
