import React, { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { PressableScale } from './PressableScale';
import { useColors } from '../theme/ThemeContext';
import { spacing, radius, font, fontWeight, iconSize, type Colors } from '../theme';
import { formatStopwatch } from '../utils/effort';
import { DICTATION_BARS, barHeight } from '../utils/dictation';
import type { DictationState } from '../hooks/useDictation';

/** The bar's height above the home indicator: its padding and the 44pt button. */
export const JOURNAL_DICTATION_BAR_HEIGHT = 68;

interface Props {
  state: DictationState;
  /** The newest microphone levels, 0..1, drawn as the waveform. */
  levels: readonly number[];
  elapsed: number;
  onStop: () => void;
  onKeepTalking: () => void;
}

const BAR_MIN = 4;
const BAR_MAX = 28;

/**
 * What sits under a journal entry while it is being spoken, and after.
 *
 * Listening: a red dot, the waveform, the time and a Stop button. Stopped: one
 * "Keep talking" button, because the words are now in the field to read and fix
 * and the next thing a person may want is to say more. Rendered in the sheet's
 * `footer`, floating at the bottom like `JournalFormatBar`, which the sheet
 * shows instead while the keyboard is up.
 */
export function JournalDictationBar({ state, levels, elapsed, onStop, onKeepTalking }: Props) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const insets = useSafeAreaInsets();
  const listening = state === 'listening' || state === 'starting' || state === 'stopping';

  // Newest on the right, with silence on the left until the bars fill.
  const bars = useMemo(() => {
    const padded = Array<number>(Math.max(0, DICTATION_BARS - levels.length)).fill(0).concat(levels);
    return padded.slice(padded.length - DICTATION_BARS);
  }, [levels]);

  return (
    <View style={[styles.bar, { paddingBottom: spacing.smd + insets.bottom }]}>
      {listening ? (
        <>
          <View style={styles.dot} />
          <View style={styles.wave} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
            {bars.map((level, i) => (
              <View key={i} style={[styles.waveBar, { height: barHeight(level, BAR_MIN, BAR_MAX) }]} />
            ))}
          </View>
          <Text style={styles.time} accessibilityLabel={`Recording, ${formatStopwatch(elapsed)}`}>
            {formatStopwatch(elapsed)}
          </Text>
          <PressableScale
            style={[styles.stop, state === 'stopping' && styles.stopping]}
            haptic
            disabled={state !== 'listening'}
            onPress={onStop}
            accessibilityLabel="Stop recording"
          >
            <Text style={styles.stopText}>Stop</Text>
          </PressableScale>
        </>
      ) : (
        <PressableScale style={styles.keep} haptic onPress={onKeepTalking} accessibilityLabel="Keep talking">
          <Ionicons name="mic" size={iconSize.sm} color={colors.accentText} />
          <Text style={styles.keepText}>Keep talking</Text>
        </PressableScale>
      )}
    </View>
  );
}

const makeStyles = (colors: Colors) => StyleSheet.create({
  bar: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.smd,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.smd,
    backgroundColor: colors.bgSecondary,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.separator,
  },
  dot: {
    width: 10,
    height: 10,
    borderRadius: radius.full,
    backgroundColor: colors.red,
  },
  wave: {
    flex: 1,
    height: BAR_MAX,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  waveBar: {
    width: 3,
    borderRadius: 2,
    backgroundColor: colors.accent,
  },
  time: {
    fontSize: font.md,
    fontWeight: fontWeight.semibold,
    color: colors.text,
    fontVariant: ['tabular-nums'],
  },
  stop: {
    minHeight: 44,
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
    borderRadius: radius.full,
    backgroundColor: colors.redFill,
  },
  stopping: { opacity: 0.5 },
  stopText: {
    fontSize: font.md,
    fontWeight: fontWeight.semibold,
    color: colors.onFill,
  },
  keep: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radius.full,
    backgroundColor: colors.bgTertiary,
  },
  keepText: {
    fontSize: font.md,
    fontWeight: fontWeight.semibold,
    color: colors.text,
  },
});
