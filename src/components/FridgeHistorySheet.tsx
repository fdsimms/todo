import React, { useEffect, useMemo, useRef } from 'react';
import {
  Modal,
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  Animated,
  PanResponder,
  StyleSheet,
  useWindowDimensions,
} from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import type { Leftover } from '../types';
import { LEFTOVER_RETENTION_DAYS } from '../types';
import { useColors, useTheme } from '../theme/ThemeContext';
import { spacing, radius, font, fontWeight, border, animation, interaction, iconSize, type Colors } from '../theme';
import { haptics } from '../utils/haptics';
import { SafeBlurView } from './SafeBlurView';
import { SheetHeaderButton } from './SheetHeaderButton';
import { EmptyState } from './EmptyState';
import {
  describeFinishedWhen,
  describeFridgeHistory,
  describeOutcome,
  finishedLeftovers,
} from '../utils/leftovers';
import type { WeekStart } from '../store/useSettingsStore';

/** Kept clear above the sheet so its title never slides under the status bar. */
const TOP_INSET = 72;

interface Props {
  visible: boolean;
  /** Every leftover the store holds; the sheet takes the closed-out ones itself. */
  leftovers: readonly Leftover[];
  weekStartsOn: WeekStart;
  /** Opens a row in LeftoverSheet, where reopening and deleting already live. */
  onOpen: (leftover: Leftover) => void;
  onClose: () => void;
}

/**
 * What happened to everything that's been in the fridge — "Eaten yesterday",
 * "Thrown out on Tuesday".
 *
 * This is the read `LeftoverOutcome` was always for. The type's own doc calls
 * the eaten/tossed split "the two things the whole feature is trying to tell
 * apart", and until this existed the app captured it at the cheapest possible
 * moment, stored it, backed it up, retained it for `LEFTOVER_RETENTION_DAYS` —
 * and then showed it to nobody. `finishedLeftovers()` was written for this and
 * had no caller.
 *
 * **It reports and does not grade.** No percentage, no streak, no "you wasted
 * 11% this month" — the summary is two counts and the rows are two words each.
 * That's the same call `describeOutcome` makes in choosing "Thrown out" over
 * "Wasted", and the reason is the same: the app is not in a position to mark
 * the user's week, and a list that does is one they stop opening. Somebody who
 * wants to draw a conclusion from "3 thrown out" is welcome to; the app
 * doesn't draw it for them.
 *
 * **A row opens `LeftoverSheet` rather than acting here.** Putting something
 * back in the fridge (`reopenLeftover`) and deleting it are already that
 * sheet's, including the reasoning for why reopening is allowed at all when
 * mark-cooked isn't — "eaten" is a claim about a container that may still
 * physically be there, and the two-button question is asked at the exact
 * moment a wrong tap is cheap and likely. A second home for those actions
 * would be a second place to keep them right.
 */
export function FridgeHistorySheet({ visible, leftovers, weekStartsOn, onOpen, onClose }: Props) {
  const colors = useColors();
  const { isDark } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const { height: windowHeight } = useWindowDimensions();

  const translateY = useRef(new Animated.Value(600)).current;
  const backdropOpacity = useRef(new Animated.Value(0)).current;

  const history = useMemo(() => finishedLeftovers(leftovers), [leftovers]);
  const summary = useMemo(() => describeFridgeHistory(leftovers), [leftovers]);

  useEffect(() => {
    if (!visible) return;
    translateY.setValue(600);
    backdropOpacity.setValue(0);
    Animated.parallel([
      Animated.spring(translateY, { toValue: 0, ...animation.spring.smooth, useNativeDriver: true }),
      Animated.timing(backdropOpacity, { toValue: 1, duration: animation.duration.normal, useNativeDriver: true }),
    ]).start();
  }, [visible]);

  const dismiss = (after?: () => void) => {
    Animated.parallel([
      Animated.spring(translateY, { toValue: 700, ...animation.spring.snappy, useNativeDriver: true }),
      Animated.timing(backdropOpacity, { toValue: 0, duration: animation.duration.fast, useNativeDriver: true }),
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
        else Animated.spring(translateY, { toValue: 0, ...animation.spring.smooth, useNativeDriver: true }).start();
      },
    })
  ).current;

  return (
    <Modal visible={visible} animationType="none" transparent onRequestClose={() => dismiss()}>
      <Animated.View style={[StyleSheet.absoluteFill, { opacity: backdropOpacity }]} pointerEvents="none">
        <SafeBlurView intensity={isDark ? 20 : 15} tint="dark" style={StyleSheet.absoluteFill} />
        <View style={[StyleSheet.absoluteFill, styles.backdropDim]} />
      </Animated.View>
      <TouchableOpacity style={StyleSheet.absoluteFill} activeOpacity={1} onPress={() => dismiss()} />

      <Animated.View
        style={[
          styles.sheetOuter,
          { maxHeight: windowHeight - TOP_INSET },
          { transform: [{ translateY }] },
        ]}
      >
        <View style={styles.handleArea} {...panResponder.panHandlers}>
          <View style={styles.handle} />
        </View>

        <View style={styles.card}>
          <View style={styles.headerRow}>
            <View style={styles.headerText}>
              <Text style={styles.heading}>Fridge history</Text>
              {!!summary && <Text style={styles.summary}>{summary}</Text>}
            </View>
            <SheetHeaderButton label="Done" onPress={() => dismiss()} accessibilityLabel="Done" />
          </View>

          {history.length === 0 ? (
            <View style={styles.emptyWrap}>
              <EmptyState
                icon="time-outline"
                title="Nothing closed out yet"
                subtitle="Once you finish or throw out a leftover, it turns up here."
              />
            </View>
          ) : (
            <ScrollView style={styles.list} bounces={false} showsVerticalScrollIndicator={false}>
              {history.map((leftover, idx) => {
                const tossed = leftover.outcome === 'tossed';
                return (
                  <React.Fragment key={leftover.id}>
                    {idx > 0 && <View style={styles.sep} />}
                    <TouchableOpacity
                      style={styles.row}
                      onPress={() => { haptics.tap(); dismiss(() => onOpen(leftover)); }}
                      activeOpacity={interaction.activeOpacity}
                      accessibilityRole="button"
                      accessibilityLabel={`${leftover.title}. ${describeOutcome(leftover)} ${describeFinishedWhen(leftover, new Date(), weekStartsOn)}.`}
                      accessibilityHint="Double tap to reopen or delete this leftover."
                    >
                      {/* The glyph carries the outcome as well as the caption,
                          so it isn't colour alone saying which ending it got —
                          same discipline the fridge card's dot keeps. One
                          surface behind both, tinted only by the glyph: an
                          accentSubtle tile is blue, and a green tick on it
                          reads as two colours disagreeing. */}
                      <View style={styles.icon}>
                        <Ionicons
                          name={tossed ? 'trash-bin-outline' : 'checkmark'}
                          size={iconSize.sm}
                          color={tossed ? colors.textSecondary : colors.green}
                        />
                      </View>
                      <View style={styles.rowText}>
                        <Text style={styles.rowTitle} numberOfLines={1}>{leftover.title}</Text>
                        {/* Outcome and when, and deliberately not how long it
                            sat: "Thrown out on Monday · 6 days in the fridge"
                            is past a phone-width line, and the half that gets
                            truncated is the half the row exists to say. */}
                        <Text style={styles.rowCaption} numberOfLines={1}>
                          {`${describeOutcome(leftover)} ${describeFinishedWhen(leftover, new Date(), weekStartsOn)}`}
                        </Text>
                      </View>
                      <Ionicons name="chevron-forward" size={iconSize.sm} color={colors.textTertiary} />
                    </TouchableOpacity>
                  </React.Fragment>
                );
              })}
              {/* Says why the list stops rather than letting it look lossy. */}
              <Text style={styles.footnote}>
                {`Kept for ${LEFTOVER_RETENTION_DAYS} days.`}
              </Text>
            </ScrollView>
          )}
        </View>
      </Animated.View>
    </Modal>
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
    flexShrink: 1,
    paddingBottom: spacing.sm,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
    paddingBottom: spacing.sm,
  },
  headerText: { flexShrink: 1, gap: 2 },
  heading: {
    color: colors.text,
    fontSize: font.lg,
    fontWeight: fontWeight.semibold,
  },
  summary: {
    color: colors.textTertiary,
    fontSize: font.sm,
  },
  list: { flexShrink: 1 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
  },
  icon: {
    width: 32,
    height: 32,
    borderRadius: radius.sm,
    backgroundColor: colors.bgTertiary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowText: { flex: 1, gap: 1 },
  rowTitle: {
    color: colors.text,
    fontSize: font.md,
    fontWeight: fontWeight.medium,
  },
  rowCaption: {
    color: colors.textTertiary,
    fontSize: font.xs,
  },
  sep: {
    height: border.hairline,
    backgroundColor: colors.separator,
    marginLeft: spacing.md + 32 + spacing.md,
  },
  footnote: {
    color: colors.textTertiary,
    fontSize: font.xs,
    textAlign: 'center',
    paddingTop: spacing.md,
    paddingBottom: spacing.sm,
  },
  emptyWrap: {
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.md,
  },
});
