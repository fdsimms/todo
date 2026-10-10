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
import { JOURNAL_WORD_GOAL_RANGE, formatWordCount } from '../utils/journal';

interface Props {
  visible: boolean;
  onClose: () => void;
}

/**
 * The words a day of journaling is read against, set from the Journal screen.
 *
 * One number, so a `CardSheet` rather than a bottom sheet. The value is staged
 * and written on Done, so Cancel leaves the goal as it was. Nothing here
 * suggests a figure or says whether the one picked is enough: the stepper's
 * bounds are an absurdity check (`JOURNAL_WORD_GOAL_RANGE`), not advice. The same
 * setting is also a row in Settings › Health.
 */
export function JournalWordGoalSheet({ visible, onClose }: Props) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const card = useCardSheet();

  const saved = useSettingsStore(s => s.journalWordGoal);
  const setJournalWordGoal = useSettingsStore(s => s.setJournalWordGoal);
  const [draft, setDraft] = useState<number | null>(saved ?? JOURNAL_WORD_GOAL_RANGE.start);

  useEffect(() => {
    if (visible) setDraft(saved ?? JOURNAL_WORD_GOAL_RANGE.start);
  }, [visible, saved]);

  const dismiss = (after?: () => void) => card.close(() => { after?.(); onClose(); });

  const save = () => {
    haptics.success();
    dismiss(() => setJournalWordGoal(draft));
  };

  const remove = () => {
    haptics.tap();
    dismiss(() => setJournalWordGoal(null));
  };

  return (
    <CardSheet
      name="JournalWordGoalSheet"
      visible={visible}
      controller={card}
      onRequestClose={() => dismiss()}
    >
      <View style={styles.card}>
        <View style={styles.headerRow}>
          <SheetHeaderButton label="Cancel" role="cancel" onPress={() => dismiss()} minWidth={56} />
          <Text style={styles.heading}>Word goal</Text>
          <SheetHeaderButton label="Done" onPress={save} minWidth={56} style={styles.headerRight} />
        </View>
        <View style={styles.body}>
          <Text style={styles.hint}>
            Words you want each journal day to reach. The Journal shows each day's count against it and
            counts the days that reach it.
          </Text>
          <View style={styles.stepperRow}>
            <CountStepper
              value={draft}
              onChange={next => setDraft(next ?? JOURNAL_WORD_GOAL_RANGE.min)}
              min={JOURNAL_WORD_GOAL_RANGE.min}
              max={JOURNAL_WORD_GOAL_RANGE.max}
              step={JOURNAL_WORD_GOAL_RANGE.step}
              format={formatWordCount}
              label="word goal"
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
