import React, { useEffect, useMemo, useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { CardSheet, useCardSheet } from './CardSheet';
import { TextField } from './TextField';
import { SheetHeaderButton } from './SheetHeaderButton';
import { useColors } from '../theme/ThemeContext';
import { spacing, radius, font, fontWeight, interaction, type Colors } from '../theme';
import { haptics } from '../utils/haptics';
import type { ShieldReasonEntry } from '../utils/appShield';
import { shieldReasonLines } from '../utils/shieldReasonText';
import { releaseAllBlocks } from '../utils/releaseBlocks';
import {
  MAX_RELEASE_REASON_LENGTH, releaseReasonProblem, releasesThisMonth, timesWord,
} from '../utils/shieldRelease';
import { useShieldReleaseStore } from '../store/useShieldReleaseStore';

interface Props {
  visible: boolean;
  /** What is blocking now, so the card names exactly what it is about to end. */
  reasons: readonly ShieldReasonEntry[];
  /** Formats an ISO time against the person's 12/24-hour setting. */
  formatTime: (iso: string) => string | null;
  onClose: () => void;
}

/**
 * The emergency way out: ends every live block, once a reason has been typed.
 *
 * Ending a block this way is allowed and recorded, not discouraged by tone. The
 * weight is in three plain things on the card: what exactly will end, the
 * month's count so far, and a reason that has to be written and is kept with
 * the record (`useShieldReleaseStore`). A key tag does the same thing without
 * the typing, which is why this lives beside it on the Screen Time screen.
 */
export function EmergencyReleaseSheet({ visible, reasons, formatTime, onClose }: Props) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const card = useCardSheet();
  const log = useShieldReleaseStore(s => s.log);
  const [reason, setReason] = useState('');

  useEffect(() => {
    if (visible) setReason('');
  }, [visible]);

  const problem = releaseReasonProblem(reason);
  const monthCount = releasesThisMonth(log, new Date()).length;
  const lines = reasons.flatMap(r => shieldReasonLines(r, formatTime));

  const dismiss = (after?: () => void) => card.close(() => { onClose(); after?.(); });

  const confirm = () => {
    if (problem) return;
    haptics.warning();
    dismiss(() => { releaseAllBlocks('emergency', reason); });
  };

  return (
    <CardSheet
      name="EmergencyReleaseSheet"
      visible={visible}
      controller={card}
      onRequestClose={() => dismiss()}
    >
      <View style={styles.card}>
        <View style={styles.headerRow}>
          <SheetHeaderButton label="Cancel" role="cancel" onPress={() => dismiss()} minWidth={56} />
          <Text style={styles.heading}>End all blocks</Text>
          <View style={styles.headerSpacer} />
        </View>

        <Text style={styles.label}>Blocking now</Text>
        <View style={styles.body}>
          {lines.map((line, index) => (
            <View key={`${index}:${line}`} style={styles.line}>
              <View style={styles.dot} />
              <Text style={styles.lineText}>{line}</Text>
            </View>
          ))}
          <Text style={styles.note}>
            Each one ends now. A schedule starts again at its next window, and a focus session keeps running with your apps unblocked.
          </Text>
        </View>

        <Text style={styles.label}>Why do you need to?</Text>
        <View style={styles.body}>
          <TextField
            style={styles.input}
            value={reason}
            onChangeText={setReason}
            placeholder="e.g. I need a blocked app to reach my ride home"
            placeholderTextColor={colors.textTertiary}
            multiline
            maxLength={MAX_RELEASE_REASON_LENGTH}
            accessibilityLabel="Why you need to end the blocks"
          />
          <Text style={styles.note}>
            {problem && reason.length > 0 ? problem : 'This is saved in the record on the Screen Time screen.'}
          </Text>
          <Text style={styles.note}>
            {monthCount === 0
              ? 'You haven’t ended blocks early this month.'
              : `You have ended blocks early ${timesWord(monthCount)} this month.`}
          </Text>
        </View>

        <TouchableOpacity
          style={[styles.confirm, problem !== null && styles.confirmOff]}
          onPress={confirm}
          disabled={problem !== null}
          activeOpacity={interaction.activeOpacity}
          accessibilityRole="button"
          accessibilityState={{ disabled: problem !== null }}
        >
          <Text style={styles.confirmText}>End all blocks</Text>
        </TouchableOpacity>
      </View>
    </CardSheet>
  );
}

const makeStyles = (colors: Colors) => StyleSheet.create({
  card: { paddingBottom: spacing.md },
  headerRow: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    paddingHorizontal: spacing.md, paddingTop: spacing.md,
  },
  heading: {
    flex: 1, textAlign: 'center', color: colors.text, fontSize: font.lg, fontWeight: fontWeight.semibold,
  },
  headerSpacer: { minWidth: 56 },
  label: {
    color: colors.textSecondary, fontSize: font.xs, fontWeight: fontWeight.semibold,
    letterSpacing: 0.8, textTransform: 'uppercase',
    paddingHorizontal: spacing.md, paddingTop: spacing.md, paddingBottom: spacing.sm,
  },
  body: { paddingHorizontal: spacing.md, gap: spacing.sm },
  line: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.accent, marginTop: 7 },
  lineText: { flex: 1, color: colors.text, fontSize: font.md, lineHeight: 20 },
  note: { color: colors.textSecondary, fontSize: font.sm, lineHeight: 18 },
  input: {
    color: colors.text, fontSize: font.md, minHeight: 72, textAlignVertical: 'top',
    backgroundColor: colors.bgTertiary, borderRadius: radius.md, padding: spacing.smd,
  },
  confirm: {
    marginTop: spacing.md, marginHorizontal: spacing.md, minHeight: 44, borderRadius: radius.md,
    alignItems: 'center', justifyContent: 'center', backgroundColor: colors.redFill,
  },
  confirmOff: { opacity: 0.4 },
  confirmText: { color: colors.onFill, fontSize: font.md, fontWeight: fontWeight.semibold },
});
