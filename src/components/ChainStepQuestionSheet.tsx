import React, { useEffect, useMemo, useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { CardSheet, useCardSheet } from './CardSheet';
import Ionicons from '@expo/vector-icons/Ionicons';
import type { ChainItem, DeliverableKind } from '../types';
import { deliverableMeta } from '../utils/deliverables';
import { useColors } from '../theme/ThemeContext';
import { spacing, radius, font, fontWeight, interaction, type Colors } from '../theme';
import { haptics } from '../utils/haptics';
import { animateLayout } from '../utils/layoutAnimation';
import { DeliverableKindPicker } from './DeliverableKindPicker';
import { SheetHeaderButton } from './SheetHeaderButton';

interface Props {
  visible: boolean;
  /** The step being edited; its title is the sheet's subject. */
  step: ChainItem | null;
  /**
   * The step that follows this one, or null when there isn't one. Only its
   * title is used, and only to name what a date answer would move — a last
   * step has nothing to offer, so the switch doesn't appear at all.
   */
  nextStepTitle: string | null;
  /** Applies the step's new settings. `onClose` follows it — the host hides the sheet. */
  onSave: (patch: Pick<ChainItem, 'deliverableKind' | 'deliverableDatesNextStep'>) => void;
  onClose: () => void;
}

/**
 * What one chain step asks for when it's completed — the per-step half of
 * "Ask on completion" (see `ChainItem.deliverableKind`), plus the one thing
 * only a chain can do with the answer: hand a date to the next step.
 *
 * A sheet rather than another control unfolding on the step row, for the
 * reason `StepMinutes` gives for staying a fixed-height field: the row lives
 * inside a `SortableList`, and a control that expands in place changes the
 * row's height mid-drag, which is the one thing that list's displacement math
 * can't absorb. The row keeps a fixed-size button; everything that needs room
 * happens here.
 *
 * Shared by the task editor and the template item editor, like
 * `DeliverableKindPicker` inside it — both declare the same question about the
 * same step shape, so neither can end up offering the other's options.
 */
export function ChainStepQuestionSheet({ visible, step, nextStepTitle, onSave, onClose }: Props) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const card = useCardSheet();

  const [kind, setKind] = useState<DeliverableKind | null>(null);
  const [datesNextStep, setDatesNextStep] = useState(false);

  useEffect(() => {
    if (!visible) return;
    setKind(step?.deliverableKind ?? null);
    setDatesNextStep(step?.deliverableDatesNextStep ?? false);
  }, [visible, step?.id]);

  const dismiss = (after: () => void) => {
    card.close(() => {
      after();
    });
  };

  // The switch is only meaningful for a date step with somewhere to send the
  // answer, and the stored flag is cleared alongside it rather than left set
  // and inert: a step switched from Date to Text and back would otherwise come
  // back with a setting the user never re-chose.
  const canDateNextStep = kind === 'date' && nextStepTitle !== null;

  const save = () => {
    haptics.success();
    const patch = {
      deliverableKind: kind,
      deliverableDatesNextStep: canDateNextStep && datesNextStep,
    };
    dismiss(() => { onSave(patch); onClose(); });
  };

  return (
    <CardSheet
      name="ChainStepQuestionSheet"
      visible={visible}
      controller={card}
      onRequestClose={() => dismiss(onClose)}
    >
      <View style={styles.card}>
        <View style={styles.headerRow}>
          <SheetHeaderButton label="Cancel" role="cancel" onPress={() => dismiss(onClose)} minWidth={56} />
          <Text style={styles.heading} numberOfLines={2}>{step?.title ?? 'Step'}</Text>
          <SheetHeaderButton label="Done" onPress={save} minWidth={56} style={styles.headerRight} />
        </View>

        <Text style={styles.label}>Ask on completion</Text>
        <View style={styles.pickerWrap}>
          <DeliverableKindPicker
            value={kind}
            onChange={next => {
              animateLayout();
              setKind(next);
            }}
            exclude={['choice']}
          />
          <Text style={styles.hint}>
            {kind
              ? deliverableMeta(kind).hint
              : 'Nothing is asked when you complete this step. Pick another option to be asked a question.'}
          </Text>
        </View>

        {canDateNextStep && (
          <TouchableOpacity
            style={styles.optionRow}
            onPress={() => { haptics.tap(); setDatesNextStep(v => !v); }}
            activeOpacity={interaction.activeOpacity}
            accessibilityRole="switch"
            accessibilityLabel="Schedule the next step for this date"
            accessibilityState={{ checked: datesNextStep }}
          >
            <Ionicons
              name="arrow-forward-circle-outline"
              size={18}
              color={datesNextStep ? colors.accent : colors.textSecondary}
            />
            <View style={styles.optionContent}>
              <Text style={styles.optionLabel}>Schedule the next step for this date</Text>
              <Text style={styles.optionHint}>
                {`“${nextStepTitle}” gets the date you answer with, instead of the day you finish this step.`}
              </Text>
            </View>
            <View style={[styles.toggle, datesNextStep && styles.toggleOn]}>
              <View style={[styles.toggleKnob, datesNextStep && styles.toggleKnobOn]} />
            </View>
          </TouchableOpacity>
        )}
      </View>
    </CardSheet>
  );
}

const makeStyles = (colors: Colors) => StyleSheet.create({
  card: {
    paddingBottom: spacing.md,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
  },
  heading: {
    flex: 1,
    textAlign: 'center',
    color: colors.text,
    fontSize: font.lg,
    fontWeight: fontWeight.semibold,
  },
  headerRight: { textAlign: 'right' },
  label: {
    color: colors.textSecondary,
    fontSize: font.xs,
    fontWeight: fontWeight.semibold,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
    paddingBottom: spacing.sm,
  },
  pickerWrap: { paddingHorizontal: spacing.md, gap: spacing.sm },
  hint: { color: colors.textSecondary, fontSize: font.sm },
  optionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginTop: spacing.md,
    marginHorizontal: spacing.md,
    padding: spacing.md,
    backgroundColor: colors.bgTertiary,
    borderRadius: radius.md,
  },
  optionContent: { flex: 1, gap: spacing.xxs },
  optionLabel: { color: colors.text, fontSize: font.md },
  optionHint: { color: colors.textSecondary, fontSize: font.sm, lineHeight: 18 },
  toggle: {
    width: 46, height: 27, borderRadius: 14,
    backgroundColor: colors.bgQuaternary, justifyContent: 'center', paddingHorizontal: 3,
  },
  toggleOn: { backgroundColor: colors.orange },
  toggleKnob: {
    width: 21, height: 21, borderRadius: 11,
    backgroundColor: colors.bg,
  },
  toggleKnobOn: { backgroundColor: colors.bg, alignSelf: 'flex-end' },
});
