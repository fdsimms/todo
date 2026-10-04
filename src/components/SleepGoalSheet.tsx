import React, { useEffect, useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { CardSheet, useCardSheet } from './CardSheet';
import { CountStepper } from './CountStepper';
import { InlineAction } from './InlineAction';
import { SheetHeaderButton } from './SheetHeaderButton';
import { useSettingsStore } from '../store/useSettingsStore';
import { useColors } from '../theme/ThemeContext';
import { spacing, font, fontWeight, type Colors } from '../theme';
import { haptics } from '../utils/haptics';
import { SLEEP_GOAL_RANGE, formatSleepDuration } from '../utils/sleepLog';

interface Props {
  visible: boolean;
  onClose: () => void;
}

/**
 * The hours a day's sleep is read against, set from the Sleep screen.
 *
 * One number, so a `CardSheet` rather than a bottom sheet. The value is staged
 * and written on Done, so Cancel leaves the goal as it was. Nothing here
 * suggests a figure or says whether the one picked is enough: the stepper's
 * bounds are an absurdity check (`SLEEP_GOAL_RANGE`), not advice. The same
 * setting is also a row in Settings › Health.
 */
export function SleepGoalSheet({ visible, onClose }: Props) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const card = useCardSheet();

  const saved = useSettingsStore(s => s.sleepGoalMinutes);
  const setSleepGoalMinutes = useSettingsStore(s => s.setSleepGoalMinutes);
  const [draft, setDraft] = useState<number | null>(saved ?? SLEEP_GOAL_RANGE.start);

  useEffect(() => {
    if (visible) setDraft(saved ?? SLEEP_GOAL_RANGE.start);
  }, [visible, saved]);

  const dismiss = (after?: () => void) => card.close(() => { after?.(); onClose(); });

  const save = () => {
    haptics.success();
    dismiss(() => setSleepGoalMinutes(draft));
  };

  const remove = () => {
    haptics.tap();
    dismiss(() => setSleepGoalMinutes(null));
  };

  return (
    <CardSheet
      name="SleepGoalSheet"
      visible={visible}
      controller={card}
      onRequestClose={() => dismiss()}
    >
      <View style={styles.card}>
        <View style={styles.headerRow}>
          <SheetHeaderButton label="Cancel" role="cancel" onPress={() => dismiss()} minWidth={56} />
          <Text style={styles.heading}>Sleep goal</Text>
          <SheetHeaderButton label="Done" onPress={save} minWidth={56} style={styles.headerRight} />
        </View>
        <View style={styles.body}>
          <Text style={styles.hint}>
            Hours asleep you want each day to reach. The Sleep screen draws it as a line and counts the
            days that reach it.
          </Text>
          <View style={styles.stepperRow}>
            <CountStepper
              value={draft}
              onChange={next => setDraft(next ?? SLEEP_GOAL_RANGE.min)}
              min={SLEEP_GOAL_RANGE.min}
              max={SLEEP_GOAL_RANGE.max}
              step={SLEEP_GOAL_RANGE.step}
              format={formatSleepDuration}
              label="sleep goal"
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
