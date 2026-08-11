import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Modal,
  View,
  Text,
  TextInput,
  TouchableOpacity,
  Animated,
  PanResponder,
  StyleSheet,
  Keyboard,
} from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { subDays } from 'date-fns/subDays';
import type { Leftover } from '../types';
import {
  LEFTOVER_KEEP_DAYS_DEFAULT,
  LEFTOVER_KEEP_DAYS_MAX,
  LEFTOVER_KEEP_DAYS_MIN,
  LEFTOVER_NAME_MAX_LENGTH,
} from '../types';
import { useColors, useTheme } from '../theme/ThemeContext';
import { spacing, radius, font, fontWeight, border, animation, interaction, iconSize, type Colors } from '../theme';
import { haptics } from '../utils/haptics';
import { SafeBlurView } from './SafeBlurView';
import { CountStepper } from './CountStepper';
import { SheetHeaderButton } from './SheetHeaderButton';
import {
  cleanLeftoverTitle,
  describeLeftover,
  describeOutcome,
  isLiveLeftover,
  keepDaysBetween,
} from '../utils/leftovers';

/** How far back "put away" can be nudged from the sheet. */
const PUT_AWAY_CHOICES = [0, 1, 2, 3] as const;

// Short forms for the last two so the four chips stay on one line at 390pt —
// "2 days ago" and "3 days ago" spelled out push the fourth chip onto a second
// row. The spoken label below says the whole thing.
const PUT_AWAY_LABELS: Record<number, string> = {
  0: 'Today',
  1: 'Yesterday',
  2: '2 days',
  3: '3 days',
};

const PUT_AWAY_SPOKEN: Record<number, string> = {
  0: 'today',
  1: 'yesterday',
  2: '2 days ago',
  3: '3 days ago',
};

export interface LeftoverSeed {
  /** Prefills the title — the dish the "Log leftovers" action came from. */
  title?: string;
  recipeId?: string | null;
  sourceEntryId?: string | null;
}

interface Props {
  visible: boolean;
  /**
   * The row being edited, or null to log a new one. Read live from the store by
   * id so the caption follows an edit the sheet just made — same discipline
   * MealEntrySheet's `entry` prop keeps.
   */
  leftover: Leftover | null;
  /** Used only when `leftover` is null. */
  seed?: LeftoverSeed;
  onLog: (title: string, storedAt: string, keepDays: number) => void;
  onRename: (title: string) => void;
  onSetStoredAt: (storedAt: string) => void;
  onSetKeepDays: (days: number) => void;
  onFinish: (outcome: 'eaten' | 'tossed') => void;
  onReopen: () => void;
  onDelete: () => void;
  onClose: () => void;
}

/**
 * Logging a container into the fridge, and everything you can do to one that's
 * already in there.
 *
 * One sheet for both because the fields are identical and the difference is
 * only *when* the write lands: a new leftover is a draft held here until "Log
 * it", an existing one applies every tap immediately, the way MealEntrySheet's
 * move chips do. Splitting them would be two copies of the same two controls.
 *
 * **"Put away" is a chip row of relative days, not a calendar.** A leftover is
 * hours-to-days old by definition — nobody is logging one they made in March —
 * so a date picker would be four taps to say "yesterday", and the arithmetic
 * this feature does is in calendar days from that day anyway.
 */
export function LeftoverSheet({
  visible, leftover, seed, onLog, onRename, onSetStoredAt, onSetKeepDays,
  onFinish, onReopen, onDelete, onClose,
}: Props) {
  const colors = useColors();
  const { isDark } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const translateY = useRef(new Animated.Value(600)).current;
  const backdropOpacity = useRef(new Animated.Value(0)).current;

  const editing = leftover !== null;
  const live = leftover ? isLiveLeftover(leftover) : true;

  const [title, setTitle] = useState('');
  // Only meaningful while logging — an existing row's controls write straight
  // through, so there is no draft to hold.
  const [draftDaysAgo, setDraftDaysAgo] = useState(0);
  const [draftKeepDays, setDraftKeepDays] = useState<number | null>(LEFTOVER_KEEP_DAYS_DEFAULT);

  const storedDaysAgo = leftover ? daysAgoOf(leftover.storedAt) : draftDaysAgo;
  const keepDays = leftover
    ? keepDaysBetween(leftover.storedAt, leftover.keepUntil)
    : (draftKeepDays ?? LEFTOVER_KEEP_DAYS_DEFAULT);

  useEffect(() => {
    if (!visible) return;
    translateY.setValue(600);
    backdropOpacity.setValue(0);
    Animated.parallel([
      Animated.spring(translateY, { toValue: 0, ...animation.spring.smooth, useNativeDriver: true }),
      Animated.timing(backdropOpacity, { toValue: 1, duration: 200, useNativeDriver: true }),
    ]).start();
    // A fresh open always starts from the row (or the seed) rather than from
    // whatever the last one was left on.
    setTitle(leftover?.title ?? seed?.title ?? '');
    setDraftDaysAgo(0);
    setDraftKeepDays(LEFTOVER_KEEP_DAYS_DEFAULT);
  }, [visible, leftover?.id]);

  const dismiss = (after?: () => void) => {
    Keyboard.dismiss();
    Animated.parallel([
      Animated.spring(translateY, { toValue: 700, damping: 28, stiffness: 320, useNativeDriver: true }),
      Animated.timing(backdropOpacity, { toValue: 0, duration: 180, useNativeDriver: true }),
    ]).start(() => {
      translateY.setValue(600);
      onClose();
      after?.();
    });
  };

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: (_, { dy }) => dy > 4,
      onPanResponderMove: (_, { dy }) => {
        if (dy > 0) translateY.setValue(dy);
      },
      onPanResponderRelease: (_, { dy, vy }) => {
        if (dy > 80 || vy > 1.2) dismiss();
        else Animated.spring(translateY, { toValue: 0, damping: 22, stiffness: 300, useNativeDriver: true }).start();
      },
    })
  ).current;

  const cleanTitle = cleanLeftoverTitle(title);

  // Writes first, then animates out — the opposite order to MealEntrySheet's
  // destructive actions, which dismiss first so the list doesn't reflow under a
  // sheet that's still on screen. Nothing reflows here (the row this adds is
  // behind the modal), and writing first keeps the caller's handler free of any
  // dependence on state `onClose` has already cleared.
  const commit = () => {
    if (!cleanTitle) return;
    haptics.success();
    onLog(cleanTitle, instantDaysAgo(draftDaysAgo), draftKeepDays ?? LEFTOVER_KEEP_DAYS_DEFAULT);
    dismiss();
  };

  // An existing row's title commits on blur/submit rather than on every
  // keystroke: each write re-sorts the whole fridge, and re-sorting under a
  // caret is how a list jumps while you're still typing into it.
  const commitRename = () => {
    const clean = cleanLeftoverTitle(title);
    if (!leftover) return;
    if (!clean || clean === leftover.title) {
      setTitle(leftover.title);
      return;
    }
    onRename(clean);
  };

  const pickDaysAgo = (days: number) => {
    haptics.tap();
    if (leftover) onSetStoredAt(instantDaysAgo(days));
    else setDraftDaysAgo(days);
  };

  const pickKeepDays = (days: number | null) => {
    const next = days ?? LEFTOVER_KEEP_DAYS_DEFAULT;
    if (leftover) onSetKeepDays(next);
    else setDraftKeepDays(next);
  };

  return (
    <Modal visible={visible} animationType="none" transparent onRequestClose={() => dismiss()}>
      <Animated.View style={[StyleSheet.absoluteFill, { opacity: backdropOpacity }]} pointerEvents="none">
        <SafeBlurView intensity={isDark ? 20 : 15} tint="dark" style={StyleSheet.absoluteFill} />
        <View style={[StyleSheet.absoluteFill, styles.backdropDim]} />
      </Animated.View>
      <TouchableOpacity style={StyleSheet.absoluteFill} activeOpacity={1} onPress={() => dismiss()} />

      <Animated.View style={[styles.sheetOuter, { transform: [{ translateY }] }]}>
        <View style={styles.handleArea} {...panResponder.panHandlers}>
          <View style={styles.handle} />
        </View>

        <View style={styles.card}>
          <View style={styles.headerRow}>
            <Text style={styles.heading}>{editing ? 'In the fridge' : 'Log a leftover'}</Text>
            {!editing && (
              <SheetHeaderButton
                label="Log it"
                onPress={commit}
                disabled={!cleanTitle}
              />
            )}
          </View>

          <TextInput
            style={styles.titleInput}
            value={title}
            onChangeText={setTitle}
            onBlur={editing ? commitRename : undefined}
            onSubmitEditing={editing ? commitRename : commit}
            placeholder="What's in the container?"
            placeholderTextColor={colors.textTertiary}
            // Only when logging fresh with nothing to start from — a seeded
            // title (from "Log leftovers" on a planned meal) is already a
            // complete answer, not a draft to type over, so the keyboard
            // shouldn't summon itself on top of it.
            autoFocus={!editing && !seed?.title}
            autoCorrect={false}
            returnKeyType={editing ? 'done' : 'go'}
            maxLength={LEFTOVER_NAME_MAX_LENGTH}
            accessibilityLabel="Leftover name"
          />

          {editing && leftover && (
            <Text style={styles.caption}>
              {live ? describeLeftover(leftover) : describeOutcome(leftover)}
            </Text>
          )}

          <Text style={styles.label}>Put away</Text>
          <View style={styles.chips}>
            {PUT_AWAY_CHOICES.map(days => {
              const on = storedDaysAgo === days;
              return (
                <TouchableOpacity
                  key={days}
                  style={[styles.chip, on && styles.chipOn]}
                  onPress={() => pickDaysAgo(days)}
                  activeOpacity={interaction.activeOpacity}
                  accessibilityRole="button"
                  accessibilityState={{ selected: on }}
                  accessibilityLabel={`Put away ${PUT_AWAY_SPOKEN[days]}`}
                >
                  <Text style={[styles.chipText, on && styles.chipTextOn]}>
                    {PUT_AWAY_LABELS[days]}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
          {/* Older than the chips offer, so the row still reads honestly rather
              than showing four unselected chips and no explanation. */}
          {storedDaysAgo > PUT_AWAY_CHOICES[PUT_AWAY_CHOICES.length - 1] && (
            <Text style={styles.hint}>{`Put away ${storedDaysAgo} days ago`}</Text>
          )}

          <View style={styles.keepRow}>
            <View style={styles.keepText}>
              <Text style={styles.keepLabel}>Keep for</Text>
              <Text style={styles.hintInline}>How long before it should be used or tossed</Text>
            </View>
            <CountStepper
              value={keepDays}
              onChange={pickKeepDays}
              min={LEFTOVER_KEEP_DAYS_MIN}
              max={LEFTOVER_KEEP_DAYS_MAX}
              format={n => (n === 0 ? 'Today' : `${n}d`)}
              label="Keep for"
              describeValue={n => (n === 0 ? 'Use today' : `${n} days`)}
            />
          </View>

          {editing && live && (
            <>
              <View style={styles.sep} />
              <TouchableOpacity
                style={styles.action}
                onPress={() => { haptics.success(); dismiss(() => onFinish('eaten')); }}
                activeOpacity={interaction.activeOpacity}
                accessibilityRole="button"
                accessibilityLabel="Mark this leftover finished"
              >
                <View style={styles.actionIcon}>
                  <Ionicons name="checkmark-circle-outline" size={16} color={colors.green} />
                </View>
                <Text style={[styles.actionText, { color: colors.green }]}>Finished it</Text>
              </TouchableOpacity>

              <View style={styles.sep} />
              <TouchableOpacity
                style={styles.action}
                onPress={() => { haptics.warning(); dismiss(() => onFinish('tossed')); }}
                activeOpacity={interaction.activeOpacity}
                accessibilityRole="button"
                accessibilityLabel="Mark this leftover thrown out"
              >
                <View style={styles.actionIcon}>
                  <Ionicons name="trash-bin-outline" size={16} color={colors.orange} />
                </View>
                <Text style={[styles.actionText, { color: colors.orange }]}>Threw it out</Text>
              </TouchableOpacity>
            </>
          )}

          {editing && !live && (
            <>
              <View style={styles.sep} />
              <TouchableOpacity
                style={styles.action}
                onPress={() => { haptics.tap(); dismiss(onReopen); }}
                activeOpacity={interaction.activeOpacity}
                accessibilityRole="button"
                accessibilityLabel="Put this leftover back in the fridge"
              >
                <View style={styles.actionIcon}>
                  <Ionicons name="arrow-undo-outline" size={16} color={colors.accent} />
                </View>
                <Text style={[styles.actionText, { color: colors.accent }]}>Back in the fridge</Text>
              </TouchableOpacity>
            </>
          )}

          {editing && (
            <>
              <View style={styles.sep} />
              <TouchableOpacity
                style={styles.action}
                onPress={() => { haptics.warning(); dismiss(onDelete); }}
                activeOpacity={interaction.activeOpacity}
                accessibilityRole="button"
                accessibilityLabel="Delete this leftover"
              >
                <View style={styles.actionIcon}>
                  <Ionicons name="close-circle-outline" size={16} color={colors.red} />
                </View>
                <Text style={[styles.actionText, { color: colors.red }]}>Delete</Text>
              </TouchableOpacity>
            </>
          )}
        </View>

        <TouchableOpacity style={styles.cancelCard} onPress={() => dismiss()} activeOpacity={interaction.activeOpacity}>
          <Text style={styles.cancelLabel}>{editing ? 'Done' : 'Cancel'}</Text>
        </TouchableOpacity>
      </Animated.View>
    </Modal>
  );
}

/** Local midday `n` days back — a put-away instant the chips can round-trip. */
function instantDaysAgo(days: number): string {
  const d = subDays(new Date(), days);
  // Midday rather than now-minus-n-days so nudging "yesterday" late at night
  // can't land the instant on a third calendar day once the clock rolls over
  // mid-session. The time is never displayed; only its calendar day is read.
  d.setHours(12, 0, 0, 0);
  return d.toISOString();
}

function daysAgoOf(storedAt: string): number {
  const then = new Date(storedAt);
  then.setHours(12, 0, 0, 0);
  const now = new Date();
  now.setHours(12, 0, 0, 0);
  return Math.max(0, Math.round((+now - +then) / 86_400_000));
}

const makeStyles = (colors: Colors) => StyleSheet.create({
  backdropDim: { backgroundColor: colors.backdrop },
  sheetOuter: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: spacing.md,
    paddingBottom: 34,
  },
  handleArea: {
    alignItems: 'center',
    paddingTop: spacing.sm,
    paddingBottom: spacing.sm,
  },
  handle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.bgQuaternary,
  },
  card: {
    backgroundColor: colors.bgSecondary,
    borderRadius: radius.lg,
    overflow: 'hidden',
    marginBottom: spacing.sm,
    paddingBottom: spacing.sm,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
  },
  heading: {
    color: colors.text,
    fontSize: font.lg,
    fontWeight: fontWeight.semibold,
  },
  // No lineHeight — RN maps it onto the iOS paragraph style with no baseline
  // compensation and the glyphs sit low in the box. See CLAUDE.md.
  titleInput: {
    color: colors.text,
    fontSize: font.md,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
    height: 36,
  },
  caption: {
    color: colors.textSecondary,
    fontSize: font.sm,
    paddingHorizontal: spacing.md,
  },
  label: {
    color: colors.textTertiary,
    fontSize: font.xs,
    fontWeight: fontWeight.semibold,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
    paddingBottom: spacing.sm,
  },
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
    paddingHorizontal: spacing.md,
  },
  chip: {
    paddingHorizontal: spacing.md,
    paddingVertical: 7,
    borderRadius: radius.full,
    backgroundColor: colors.bgTertiary,
  },
  chipOn: { backgroundColor: colors.accent },
  chipText: {
    color: colors.textSecondary,
    fontSize: font.sm,
    fontWeight: fontWeight.medium,
  },
  chipTextOn: { color: colors.onAccent },
  hint: {
    color: colors.textTertiary,
    fontSize: font.sm,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
  },
  keepRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
  },
  keepText: { flex: 1, gap: 2 },
  keepLabel: {
    color: colors.text,
    fontSize: font.md,
    fontWeight: fontWeight.medium,
  },
  hintInline: {
    color: colors.textTertiary,
    fontSize: font.xs,
  },
  sep: {
    height: border.hairline,
    backgroundColor: colors.separator,
    marginTop: spacing.md,
  },
  action: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: 14,
  },
  actionIcon: {
    width: iconSize.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionText: {
    fontSize: font.md,
    fontWeight: fontWeight.medium,
  },
  cancelCard: {
    backgroundColor: colors.bgSecondary,
    borderRadius: radius.lg,
    paddingVertical: 18,
    alignItems: 'center',
  },
  cancelLabel: {
    color: colors.text,
    fontSize: font.md,
    fontWeight: fontWeight.semibold,
  },
});
