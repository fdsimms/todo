import React, { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { format } from 'date-fns/format';
import type { RewardUnlock } from '../types';
import { useColors } from '../theme/ThemeContext';
import { font, fontWeight, iconSize, radius, spacing, type Colors } from '../theme';
import { describePlayMinutes, lockedProgressLine, type UnlockStatus } from '../utils/rewardUnlocks';
import { ProgressBar } from './ProgressBar';

/**
 * The pieces of an unlock's card that the Rewards screen (`UnlocksSection`)
 * and the Screen Time page (`LockedUnlockCards`) both draw, so the two cannot
 * word the same unlock differently: its glyph and name, the line under the
 * name, and how far the day's work has got toward opening it.
 */

/** The line under an unlock's name. */
export function unlockSubtitle(unlock: RewardUnlock, status: UnlockStatus, running: boolean, timeToken: string): string {
  if (status.kind === 'free') return status.reason === 'weekend' ? 'Unlocked all day: it’s the weekend' : 'Unlocked all day: you’re on vacation';
  if (running && unlock.playStartedAt) return `Playing since ${format(new Date(unlock.playStartedAt), timeToken)}`;
  const cap = unlock.playMinutes !== null ? ` · ${describePlayMinutes(unlock.playMinutes)}` : '';
  if (status.kind === 'open') return `Unlocked for today${cap}`;
  return `Unlocks at ${unlock.sharePct}% of today’s work${cap}`;
}

/** The glyph tile, name and subtitle, with whatever sits at the trailing edge (an edit button, a chevron). */
export function UnlockHead({ unlock, subtitle, trailing }: { unlock: Pick<RewardUnlock, 'glyph' | 'title'>; subtitle: string; trailing?: React.ReactNode }) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  return (
    <View style={styles.head}>
      <View style={styles.glyph}>
        {unlock.glyph
          ? <Text style={styles.glyphText} accessible={false}>{unlock.glyph}</Text>
          : <Ionicons name="lock-open-outline" size={iconSize.md} color={colors.accent} />}
      </View>
      <View style={styles.headText}>
        <Text style={styles.title} numberOfLines={2}>{unlock.title}</Text>
        <Text style={styles.subtitle}>{subtitle}</Text>
      </View>
      {trailing}
    </View>
  );
}

/** How much of today's work is done toward a locked unlock, and what it still needs. */
export function LockedProgress({ sharePct, share, coinsShort, pendingTitles }: {
  sharePct: number;
  share: number;
  coinsShort: number;
  pendingTitles: readonly string[];
}) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  return (
    <View style={styles.block}>
      <Text style={styles.status}>{lockedProgressLine(share, coinsShort)}</Text>
      <ProgressBar progress={Math.min(1, share * 100 / sharePct)} height={6} color={colors.green} decorative />
      {pendingTitles.length > 0 && (
        <Text style={styles.meta}>{`Still needs ${pendingTitles.join(', ')}`}</Text>
      )}
    </View>
  );
}

function makeStyles(colors: Colors) {
  return StyleSheet.create({
    head: { flexDirection: 'row', alignItems: 'center', gap: spacing.smd },
    glyph: {
      width: 44,
      height: 44,
      borderRadius: radius.md,
      backgroundColor: colors.accentSubtle,
      alignItems: 'center',
      justifyContent: 'center',
    },
    // An emoji sized as an icon, which is what a literal size is for.
    glyphText: { fontSize: 24 },
    headText: { flex: 1 },
    title: { color: colors.text, fontSize: font.md, fontWeight: fontWeight.semibold },
    subtitle: { color: colors.textSecondary, fontSize: font.sm, marginTop: spacing.xxs },
    block: { gap: spacing.sm },
    status: { color: colors.text, fontSize: font.sm, fontWeight: fontWeight.semibold },
    meta: { color: colors.textSecondary, fontSize: font.xs },
  });
}
