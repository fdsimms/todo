import React, { useEffect, useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { CardSheet, useCardSheet } from './CardSheet';
import { CountStepper } from './CountStepper';
import { InlineAction } from './InlineAction';
import { SheetHeaderButton } from './SheetHeaderButton';
import { useColors } from '../theme/ThemeContext';
import { spacing, font, fontWeight, type Colors } from '../theme';
import { haptics } from '../utils/haptics';

interface Props {
  visible: boolean;
  onClose: () => void;
  /** The card's `name`, for the presentation clash report. */
  name: string;
  heading: string;
  hint: string;
  /** The saved goal, or null for none. */
  saved: number | null;
  /** Written on Done, with null when the goal is removed. */
  onSave: (value: number | null) => void;
  /** The stepper's bounds and the value it opens on when nothing is saved. */
  range: { min: number; max: number; step: number; start: number };
  format: (value: number) => string;
  /** What a screen reader calls the number. */
  label: string;
}

/**
 * A goal set with one stepper: the sleep goal and the journal word goal.
 *
 * One number, so a `CardSheet` rather than a bottom sheet. The value is staged
 * and written on Done, so Cancel leaves the goal as it was. Nothing here
 * suggests a figure or says whether the one picked is enough: the range is an
 * absurdity check, not advice.
 */
export function GoalStepperSheet({ visible, onClose, name, heading, hint, saved, onSave, range, format, label }: Props) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const card = useCardSheet();

  const [draft, setDraft] = useState<number | null>(saved ?? range.start);

  useEffect(() => {
    if (visible) setDraft(saved ?? range.start);
  }, [visible, saved]);

  const dismiss = (after?: () => void) => card.close(() => { after?.(); onClose(); });

  const save = () => {
    haptics.success();
    dismiss(() => onSave(draft));
  };

  const remove = () => {
    haptics.tap();
    dismiss(() => onSave(null));
  };

  return (
    <CardSheet
      name={name}
      visible={visible}
      controller={card}
      onRequestClose={() => dismiss()}
    >
      <View style={styles.card}>
        <View style={styles.headerRow}>
          <SheetHeaderButton label="Cancel" role="cancel" onPress={() => dismiss()} minWidth={56} />
          <Text style={styles.heading}>{heading}</Text>
          <SheetHeaderButton label="Done" onPress={save} minWidth={56} style={styles.headerRight} />
        </View>
        <View style={styles.body}>
          <Text style={styles.hint}>{hint}</Text>
          <View style={styles.stepperRow}>
            <CountStepper
              value={draft}
              onChange={next => setDraft(next ?? range.min)}
              min={range.min}
              max={range.max}
              step={range.step}
              format={format}
              label={label}
            />
          </View>
          {saved !== null && (
            <View style={styles.removeRow}>
              <InlineAction label="Remove goal" icon="close" variant="neutral" onPress={remove} />
            </View>
          )}
        </View>
      </View>
    </CardSheet>
  );
}

const makeStyles = (colors: Colors) => StyleSheet.create({
  card: { paddingBottom: spacing.md },
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
  body: { paddingHorizontal: spacing.md, paddingTop: spacing.md, gap: spacing.md },
  hint: { color: colors.textSecondary, fontSize: font.sm },
  stepperRow: { alignItems: 'center' },
  removeRow: { alignItems: 'center' },
});
