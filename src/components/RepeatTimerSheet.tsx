import React, { useEffect, useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { CardSheet, useCardSheet } from './CardSheet';
import { CountStepper } from './CountStepper';
import { SheetHeaderButton } from './SheetHeaderButton';
import { HelpText } from './HelpText';
import { useColors } from '../theme/ThemeContext';
import { spacing, font, fontWeight, type Colors } from '../theme';
import { haptics } from '../utils/haptics';
import { MAX_REPEAT_ROUNDS } from '../utils/stepTimers';
import { BUTTON_LABEL } from '../copy/shared';

interface Props {
  visible: boolean;
  onClose: () => void;
  /** The card's `name`, for the presentation clash report. */
  name: string;
  /** "Every 30m". */
  heading: string;
  /** Where the number the stepper opens on came from, or what the card does. */
  hint: string;
  /** What the stepper opens on. */
  value: number;
  /** The right-hand button: "Start" for a new timer, "Done" for changing a running one. */
  confirmLabel: string;
  onConfirm: (rounds: number) => void;
}

/**
 * How many times a repeating step timer is expected to ring, set with one
 * stepper: asked when a timer is started from "every 30 minutes", and again
 * when the count on a running one is tapped.
 *
 * One number, so a `CardSheet` and not a bottom sheet, staged and written only
 * on the right-hand button, so Cancel leaves a running timer as it was. The
 * number is what the count is read against and nothing stops at it: a pot that
 * needs one more cycle goes on to "6 of 5", which is why the card says so
 * rather than leaving someone to wonder what happens at five.
 */
export function RepeatTimerSheet({ visible, onClose, name, heading, hint, value, confirmLabel, onConfirm }: Props) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const card = useCardSheet();

  const [draft, setDraft] = useState(value);
  useEffect(() => {
    if (visible) setDraft(value);
  }, [visible, value]);

  const dismiss = (after?: () => void) => card.close(() => { after?.(); onClose(); });

  const confirm = () => {
    haptics.success();
    dismiss(() => onConfirm(draft));
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
          <SheetHeaderButton label={BUTTON_LABEL.cancel} role="cancel" onPress={() => dismiss()} minWidth={56} />
          <Text style={styles.heading}>{heading}</Text>
          <SheetHeaderButton label={confirmLabel} onPress={confirm} minWidth={56} style={styles.headerRight} />
        </View>
        <View style={styles.body}>
          <View style={styles.stepperRow}>
            <CountStepper
              value={draft}
              onChange={next => setDraft(next ?? 1)}
              min={1}
              max={MAX_REPEAT_ROUNDS}
              format={n => (n === 1 ? '1 time' : `${n} times`)}
              label="number of times"
            />
          </View>
          <HelpText style={styles.hint}>{hint}</HelpText>
          <HelpText style={styles.hint}>
            It rings every time and keeps count. It keeps going past this number until you dismiss it.
          </HelpText>
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
});
