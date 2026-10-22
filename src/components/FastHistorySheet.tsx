import React, { useMemo } from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { format } from 'date-fns/format';
import type { Fast } from '../types';
import { SheetModal } from './SheetModal';
import { SheetHeader } from './SheetHeader';
import { SheetHeaderButton } from './SheetHeaderButton';
import { EmptyNote } from './EmptyNote';
import { HelpText } from './HelpText';
import { useFastStore } from '../store/useFastStore';
import { useColors } from '../theme/ThemeContext';
import { spacing, radius, font, fontWeight, interaction, type Colors } from '../theme';
import { haptics } from '../utils/haptics';
import { formatTimeOfDay } from '../utils/dateUtils';
import { describeFastLength, fastElapsedMs, formatFastLengthShort, pastFasts } from '../utils/fasting';
import { BUTTON_LABEL } from '../copy/shared';

interface Props {
  visible: boolean;
  /** Opens one for editing (`FastSheet`). The caller closes this sheet first. */
  onEdit: (fast: Fast) => void;
  onClose: () => void;
}

/**
 * Every fast that has ended, newest first: the day it started, its start time
 * and goal, and how long it ran. Read only, with a tap handing a fast to the
 * editor. Lengths are stated, never graded (see the header of
 * `src/utils/fasting.ts`), so a fast short of its goal reads like any other.
 */
export function FastHistorySheet({ visible, onEdit, onClose }: Props) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const fasts = useFastStore(s => s.fasts);
  const past = useMemo(() => pastFasts(fasts), [fasts]);

  return (
    <SheetModal name="FastHistorySheet" visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={styles.root}>
        <SheetHeader
          title="Past fasts"
          left={<View style={styles.headerSpacer} />}
          right={<SheetHeaderButton label={BUTTON_LABEL.done} onPress={onClose} minWidth={56} />}
        />
        <ScrollView contentContainerStyle={styles.content}>
          {past.length === 0 ? (
            <EmptyNote icon="timer-outline">No fast has ended yet. One shows here once you end it.</EmptyNote>
          ) : (
            <>
              <Text style={styles.label}>{past.length === 1 ? '1 FAST' : `${past.length} FASTS`}</Text>
              <View style={styles.card}>
                {past.map((fast, index) => {
                  const start = new Date(fast.startedAt);
                  const length = fastElapsedMs(fast, start);
                  return (
                    <TouchableOpacity
                      key={fast.id}
                      style={[styles.row, index > 0 && styles.rowDivider]}
                      activeOpacity={interaction.activeOpacity}
                      onPress={() => { haptics.tap(); onEdit(fast); }}
                      accessibilityRole="button"
                      accessibilityLabel={`${format(start, 'EEEE, MMMM d')}, started ${formatTimeOfDay(start)}, ${describeFastLength(length)}, ${fast.goalHours} hour goal. Edit`}
                    >
                      <View style={styles.rowText}>
                        <Text style={styles.day} numberOfLines={1}>{format(start, 'EEE, MMM d')}</Text>
                        <Text style={styles.detail} numberOfLines={1}>
                          {`Started ${formatTimeOfDay(start)} · ${fast.goalHours}-hour goal`}
                        </Text>
                      </View>
                      <Text style={styles.length}>{formatFastLengthShort(length)}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
              <HelpText style={styles.hint}>Tap one to change when it started or its goal.</HelpText>
            </>
          )}
        </ScrollView>
      </View>
    </SheetModal>
  );
}

const makeStyles = (colors: Colors) => StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  headerSpacer: { minWidth: 56 },
  content: { padding: spacing.md, paddingBottom: spacing.xl },
  label: {
    color: colors.textSecondary, fontSize: font.xs, fontWeight: fontWeight.semibold, letterSpacing: 0.8,
    marginBottom: spacing.sm, marginLeft: spacing.xs,
  },
  card: { backgroundColor: colors.bgSecondary, borderRadius: radius.md, overflow: 'hidden' },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md,
    paddingHorizontal: spacing.md, paddingVertical: spacing.smd, minHeight: 56,
  },
  rowDivider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.separator },
  rowText: { flex: 1 },
  day: { color: colors.text, fontSize: font.md },
  detail: { color: colors.textSecondary, fontSize: font.sm, marginTop: spacing.xxs },
  length: { color: colors.text, fontSize: font.md, fontVariant: ['tabular-nums'] },
  hint: { color: colors.textSecondary, fontSize: font.sm, marginTop: spacing.sm, marginHorizontal: spacing.md },
});
