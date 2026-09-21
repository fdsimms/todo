import React, { useEffect, useMemo, useRef } from 'react';
import { Animated, Linking, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { SheetModal } from './SheetModal';
import { SafeBlurView } from './SafeBlurView';
import { SheetScrim } from './SheetScrim';
import { SheetHeaderButton } from './SheetHeaderButton';
import { useSheetHiddenOffset } from '../hooks/useSheetHiddenOffset';
import { useColors, useTheme } from '../theme/ThemeContext';
import { useSettingsStore } from '../store/useSettingsStore';
import { getCurrentDayStart } from '../utils/dateUtils';
import { displayTitleFor } from '../utils/visibilityUtils';
import { haptics } from '../utils/haptics';
import { openInAppUrl } from '../utils/deepLinks';
import { rotationLastDoneLabel, rotationMembers } from '../utils/rotation';
import { spacing, radius, font, fontWeight, iconSize, animation, interaction, type Colors } from '../theme';
import type { Task } from '../types';

interface Props {
  visible: boolean;
  /** The rotation being logged against. Its title heads the sheet. */
  task: Task;
  /** A member was picked. The sheet has already animated out by the time this runs. */
  onPick: (itemId: string) => void;
  /** Backs out — nothing is logged and the task stays where it was. */
  onCancel: () => void;
}

/**
 * "Which did you do?" — the sheet a rotation raises instead of ticking
 * straight off. See `src/utils/rotation.ts` for what a rotation is.
 *
 * Rows rather than pills, which is a deliberate departure from the rule that
 * sends an open-ended user-built set to `PillGroup`. A pill can carry a name
 * and nothing else, and the second line here is most of the value: "Last done
 * 3 weeks ago" beside French is what turns a list of five equivalent options
 * into a decision you can make. A set big enough for `PillGroup`'s cap to
 * matter is a set this feature is the wrong shape for anyway.
 *
 * Three rules, all of them about not pushing:
 *
 * - **Cancel changes nothing, and it is the only way out besides picking.**
 *   There is no "log it without saying which": an anonymous unit against a set
 *   whose whole point is coverage would move the meter while leaving every
 *   member outstanding, which is a week that reads as done and isn't.
 * - **A member already down this period is still tappable.** It sits under its
 *   own heading, dimmed and ticked, and picking it logs the listen without
 *   re-counting the week (see `rotationCoversNew`). Listening to Spanish twice
 *   is a real thing to do, and a picker that refuses to record it is the app
 *   arguing with you about what you did.
 * - **The secondary line says when, and stops.** No "you keep skipping this",
 *   no ordering by neglect — the set stays in the user's own order. That line
 *   is `docs/arch/people.md`'s and `docs/arch/mood-log.md`'s, and a feature
 *   that watches which of five things you avoid is close enough to it to need
 *   saying twice.
 */
export function RotationPickSheet({ visible, task, onPick, onCancel }: Props) {
  const colors = useColors();
  const { isDark } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const weekStartsOn = useSettingsStore(s => s.weekStartsOn);

  const hiddenY = useSheetHiddenOffset();
  const translateY = useRef(new Animated.Value(hiddenY)).current;
  const backdropOpacity = useRef(new Animated.Value(0)).current;

  // Read once per open rather than per render: a sheet held across the
  // dayResetTime boundary re-deciding which week it is about, mid-tap, is a
  // worse answer than the one it opened with.
  const dayStart = useMemo(() => getCurrentDayStart(), [visible]);
  const members = rotationMembers(task, dayStart, weekStartsOn);
  const remaining = members.filter(m => m.doneAt === null);
  const done = members.filter(m => m.doneAt !== null);

  useEffect(() => {
    if (!visible) return;
    Animated.parallel([
      Animated.spring(translateY, { toValue: 0, ...animation.spring.smooth, useNativeDriver: true }),
      Animated.timing(backdropOpacity, { toValue: 1, duration: animation.duration.normal, useNativeDriver: true }),
    ]).start();
  }, [visible, task.id]);

  const dismiss = (after: () => void) => {
    Animated.parallel([
      Animated.spring(translateY, { toValue: hiddenY, ...animation.spring.sheetDismiss, useNativeDriver: true }),
      Animated.timing(backdropOpacity, { toValue: 0, duration: animation.duration.fast, useNativeDriver: true }),
    ]).start(() => {
      // No re-arming setValue here — see useSheetHiddenOffset.
      after();
    });
  };

  const pick = (itemId: string) => {
    haptics.success();
    dismiss(() => onPick(itemId));
  };

  /**
   * Opens a member's own link without logging it — "take me to the French
   * feed" is a different intent from "I did French", and a row that did both
   * would make the picker unusable for the first.
   *
   * Same two-branch open `TaskItem` uses: an in-app URL navigates in place
   * rather than making an app-switch round trip that flashes, and
   * `canOpenURL` is skipped because on iOS it only answers for schemes
   * declared up front.
   */
  const openLink = async (url: string) => {
    haptics.tap();
    if (openInAppUrl(url)) { dismiss(onCancel); return; }
    try {
      await Linking.openURL(url);
    } catch {
      // silently ignore — no toast infra for a row-level action
    }
  };

  const renderRow = (
    member: (typeof members)[number],
    isDone: boolean,
  ) => {
    const ago = rotationLastDoneLabel(isDone ? member.doneAt : member.lastDoneAt, dayStart);
    const link = member.item.linkUrl?.trim() || null;
    return (
      <TouchableOpacity
        key={member.item.id}
        style={styles.row}
        activeOpacity={interaction.activeOpacity}
        onPress={() => pick(member.item.id)}
        accessibilityRole="button"
        accessibilityLabel={
          isDone
            ? `${member.item.title}, already done this week. Log it again.`
            : `${member.item.title}${ago ? `, last done ${ago.toLowerCase()}` : ''}`
        }
      >
        <View style={[styles.bullet, isDone && styles.bulletDone]}>
          {!isDone && (
            <Ionicons name="headset-outline" size={iconSize.sm} color={colors.accentText} />
          )}
        </View>
        <View style={styles.rowBody}>
          <Text style={[styles.name, isDone && styles.nameDone]} numberOfLines={1}>
            {member.item.title}
          </Text>
          {ago !== null && <Text style={styles.ago}>{ago}</Text>}
        </View>
        {link !== null && (
          <TouchableOpacity
            onPress={() => openLink(link)}
            hitSlop={8}
            style={styles.linkButton}
            accessibilityRole="button"
            accessibilityLabel={`Open the link for ${member.item.title}`}
          >
            <Ionicons name="open-outline" size={iconSize.sm} color={colors.accentText} />
          </TouchableOpacity>
        )}
        {isDone && <Ionicons name="checkmark" size={iconSize.md} color={colors.green} />}
      </TouchableOpacity>
    );
  };

  return (
    <SheetModal
      name="RotationPickSheet"
      visible={visible}
      animationType="none"
      transparent
      onRequestClose={() => dismiss(onCancel)}
    >
      <Animated.View style={[StyleSheet.absoluteFill, { opacity: backdropOpacity }]} pointerEvents="none">
        <SafeBlurView intensity={isDark ? 20 : 15} tint="dark" style={StyleSheet.absoluteFill} />
        <View style={[StyleSheet.absoluteFill, styles.backdropDim]} />
      </Animated.View>
      {/* Tapping out logs nothing — the reflex gesture has to be the safe one. */}
      <SheetScrim onPress={() => dismiss(onCancel)} />

      <Animated.View style={[styles.sheetOuter, { transform: [{ translateY }] }]}>
        <View style={styles.card}>
          <View style={styles.headerRow}>
            <SheetHeaderButton label="Cancel" role="cancel" onPress={() => dismiss(onCancel)} minWidth={56} />
            <Text style={styles.heading} numberOfLines={2}>{displayTitleFor(task)}</Text>
            <View style={styles.headerRight} />
          </View>

          <ScrollView
            style={styles.scroll}
            contentContainerStyle={styles.scrollContent}
            showsVerticalScrollIndicator={false}
          >
            {remaining.length > 0 && (
              <>
                <Text style={styles.label}>Which did you do?</Text>
                <View style={styles.group}>{remaining.map(m => renderRow(m, false))}</View>
              </>
            )}
            {done.length > 0 && (
              <>
                <Text style={styles.label}>
                  {remaining.length > 0 ? 'Already done this week' : 'All done this week'}
                </Text>
                <View style={styles.group}>{done.map(m => renderRow(m, true))}</View>
              </>
            )}
          </ScrollView>
        </View>
      </Animated.View>
    </SheetModal>
  );
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
  card: {
    backgroundColor: colors.bgSecondary,
    borderRadius: radius.lg,
    paddingBottom: spacing.md,
  },
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
  headerRight: { minWidth: 56 },
  // Capped so a long set scrolls inside the card rather than growing the sheet
  // past the top of the screen.
  scroll: { maxHeight: 420 },
  scrollContent: { paddingBottom: spacing.xs },
  label: {
    color: colors.textSecondary,
    fontSize: font.xs,
    fontWeight: fontWeight.semibold,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
    paddingBottom: spacing.sm,
  },
  group: {
    marginHorizontal: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.bgTertiary,
    overflow: 'hidden',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.smd,
    paddingHorizontal: spacing.smd,
    paddingVertical: spacing.smd,
  },
  bullet: {
    width: 28,
    height: 28,
    borderRadius: radius.full,
    backgroundColor: colors.accentSubtle,
    alignItems: 'center',
    justifyContent: 'center',
  },
  bulletDone: { backgroundColor: 'transparent' },
  rowBody: { flex: 1, minWidth: 0 },
  name: { color: colors.text, fontSize: font.md },
  nameDone: { color: colors.textTertiary },
  linkButton: {
    width: 32,
    height: 28,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.sm,
    backgroundColor: colors.bgQuaternary,
  },
  ago: { color: colors.textTertiary, fontSize: font.xxs, marginTop: spacing.xxs },
});
