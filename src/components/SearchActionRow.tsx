import React, { useMemo } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, type StyleProp, type ViewStyle } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { InlineAction } from './InlineAction';
import { useColors } from '../theme/ThemeContext';
import { spacing, radius, font, iconSize, interaction, type Colors } from '../theme';
import { TASK_CHECKBOX_SIZE } from './TaskCheckbox';
import { isRunnable, type ActionDescription, type SearchAction } from '../utils/searchActions';
import { SYMPTOM_SEVERITIES } from '../utils/moodLog';
import type { SearchActionReceipt } from '../utils/searchActionRun';

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
 * A symptom row carries its severity pills on a line of their own under the
 * title, so the name keeps the whole row: tapping a pill logs at that severity
 * and tapping the title logs at the one marked (Mild unless the line said).
 */
export function SearchActionRow({ action, description, receipt, layout, onRun, onUndo }: {
  action: SearchAction;
  description: ActionDescription;
  receipt: SearchActionReceipt | null;
  layout: 'card' | 'list';
  onRun: (action: SearchAction) => void;
  onUndo: (action: SearchAction) => void;
}) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const list = layout === 'list';

  const icon = (name: string) => (
    <View style={list ? styles.listIconSlot : styles.cardIconSlot}>
      <View style={list ? styles.listIconBadge : null}>
        <Ionicons name={name as keyof typeof Ionicons.glyphMap} size={iconSize.sm} color={colors.accent} />
      </View>
    </View>
  );

  if (receipt) {
    return (
      <View style={[styles.row, list && styles.listRow]}>
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
  if (!isRunnable(action)) {
    return (
      <View style={[styles.row, list && styles.listRow]} accessible accessibilityLabel={label}>
        {body}
      </View>
    );
  }
  const button = (rowStyle: StyleProp<ViewStyle>) => (
    <TouchableOpacity
      style={rowStyle}
      onPress={() => onRun(action)}
      activeOpacity={interaction.activeOpacity}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={action.kind === 'mood' ? 'Double tap to open the mood log' : 'Double tap to do it now'}
    >
      {body}
    </TouchableOpacity>
  );
  if (action.kind !== 'symptom') return button([styles.row, list && styles.listRow]);
  return (
    <View style={list ? styles.listShell : null}>
      {button([styles.row, list && styles.listShellRow])}
      <View style={[styles.severityRow, list ? styles.listSeverityRow : styles.cardSeverityRow]}>
        {SYMPTOM_SEVERITIES.map(({ value, label: severity }) => (
          <InlineAction
            key={value}
            label={severity}
            variant={value === action.severity ? 'accent' : 'neutral'}
            onPress={() => onRun({ ...action, severity: value })}
            accessibilityLabel={`Log ${action.symptom} as ${severity.toLowerCase()}`}
          />
        ))}
      </View>
    </View>
  );
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
