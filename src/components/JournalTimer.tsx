import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useColors } from '../theme/ThemeContext';
import { spacing, radius, font, fontWeight, iconSize, interaction, type Colors } from '../theme';
import { haptics } from '../utils/haptics';
import {
  JOURNAL_TIMER_MINUTES,
  JOURNAL_TIMER_RANGE,
  formatJournalTimerClock,
  journalTimerProgress,
  journalTimerRemainingMs,
  readJournalTimerMinutes,
  writeJournalTimerMinutes,
} from '../utils/journalTimer';
import { ChoiceMenuChip } from './ChoiceMenuChip';
import { CustomMinutesPrompt } from './CustomMinutesPrompt';

interface Props {
  /** Whether the sheet is open. Closing it ends a running timer. */
  active: boolean;
  /** The line the timer sits beside (the word count). */
  children: React.ReactNode;
}

interface Run {
  startedAt: number;
  endsAt: number;
}

/** The listed lengths, plus the one in use when it was typed rather than picked, so the menu shows it as chosen. */
function lengthGroups(minutes: number) {
  const listed: readonly number[] = JOURNAL_TIMER_MINUTES;
  const lengths = listed.includes(minutes) ? listed : [...listed, minutes];
  return [{ options: lengths.map(m => ({ key: String(m), label: `${m} min` })) }];
}

/**
 * The writing timer's row under the field: the word count on the left, and on
 * the right a Start button beside the length menu, then a countdown while it
 * runs, then "Time’s up". Docs: `docs/arch/journal.md`, "The writing timer".
 *
 * Time up is a haptic and a label, and typing carries on: nothing ends the
 * sitting for you. The countdown is read off `endsAt`, never decremented, so a
 * tick the JS thread missed can't make it run slow.
 */
export function JournalTimer({ active, children }: Props) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [minutes, setMinutes] = useState(readJournalTimerMinutes);
  const [run, setRun] = useState<Run | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [finished, setFinished] = useState(false);
  const [customOpen, setCustomOpen] = useState(false);

  useEffect(() => {
    if (active) return;
    setRun(null);
    setFinished(false);
  }, [active]);

  useEffect(() => {
    if (!run) return;
    const id = setInterval(() => {
      const at = Date.now();
      setNow(at);
      if (at >= run.endsAt) {
        clearInterval(id);
        setRun(null);
        setFinished(true);
        haptics.success();
      }
    }, 1000);
    return () => clearInterval(id);
  }, [run]);

  const start = () => {
    haptics.tap();
    const at = Date.now();
    setNow(at);
    setFinished(false);
    setRun({ startedAt: at, endsAt: at + minutes * 60_000 });
  };
  const stop = () => {
    haptics.tap();
    setRun(null);
    setFinished(false);
  };
  const pick = (key: string) => {
    const next = Number(key);
    setMinutes(next);
    writeJournalTimerMinutes(next);
  };

  const remaining = run ? journalTimerRemainingMs(run.endsAt, now) : 0;

  return (
    <View>
      <View style={styles.row}>
        <View style={styles.left}>{children}</View>
        {run ? (
          <TouchableOpacity
            style={[styles.chip, styles.running]}
            activeOpacity={interaction.activeOpacity}
            onPress={stop}
            accessibilityRole="button"
            accessibilityLabel={`${formatJournalTimerClock(remaining)} left on the writing timer. Cancel timer`}
          >
            <Ionicons name="timer-outline" size={iconSize.sm} color={colors.accentText} />
            <Text style={[styles.chipText, styles.runningText]}>{formatJournalTimerClock(remaining)}</Text>
          </TouchableOpacity>
        ) : finished ? (
          <TouchableOpacity
            style={[styles.chip, styles.done]}
            activeOpacity={interaction.activeOpacity}
            onPress={() => setFinished(false)}
            accessibilityRole="button"
            accessibilityLabel="Time’s up. Dismiss"
          >
            <Ionicons name="timer-outline" size={iconSize.sm} color={colors.warningText} />
            <Text style={[styles.chipText, styles.doneText]}>Time’s up</Text>
          </TouchableOpacity>
        ) : (
          <View style={styles.controls}>
            <TouchableOpacity
              style={[styles.chip, styles.start]}
              activeOpacity={interaction.activeOpacity}
              onPress={start}
              accessibilityRole="button"
              accessibilityLabel={`Start a ${minutes} minute writing timer`}
            >
              <Ionicons name="timer-outline" size={iconSize.sm} color={colors.onAccent} />
              <Text style={[styles.chipText, styles.startText]}>Start</Text>
            </TouchableOpacity>
            <ChoiceMenuChip
              groups={lengthGroups(minutes)}
              selectedKey={String(minutes)}
              onSelect={pick}
              onOther={() => setCustomOpen(true)}
              noun="Timer length"
              name="JournalTimerLength"
              background={colors.bgTertiary}
            />
          </View>
        )}
      </View>
      {run && (
        <View style={styles.track} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
          <View style={[styles.fill, { width: `${journalTimerProgress(run.startedAt, run.endsAt, now) * 100}%` }]} />
        </View>
      )}
      <CustomMinutesPrompt
        visible={customOpen}
        title="Timer length"
        range={JOURNAL_TIMER_RANGE}
        initialMinutes={minutes}
        onSubmit={m => pick(String(m))}
        onClose={() => setCustomOpen(false)}
      />
    </View>
  );
}

function makeStyles(colors: Colors) {
  return StyleSheet.create({
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: spacing.sm,
      marginTop: spacing.sm,
    },
    left: { flexShrink: 1 },
    controls: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
    chip: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.xs,
      paddingHorizontal: spacing.smd,
      paddingVertical: spacing.xs,
      borderRadius: radius.full,
    },
    chipText: { fontSize: font.sm, fontWeight: fontWeight.semibold },
    start: { backgroundColor: colors.accentFill },
    startText: { color: colors.onAccent },
    running: { backgroundColor: colors.accentSubtle },
    runningText: { color: colors.accentText, fontVariant: ['tabular-nums'] },
    done: { backgroundColor: colors.warningBg },
    doneText: { color: colors.warningText },
    track: {
      height: 3,
      borderRadius: 2,
      backgroundColor: colors.bgTertiary,
      marginTop: spacing.sm,
      overflow: 'hidden',
    },
    fill: { height: '100%', backgroundColor: colors.accent },
  });
}
