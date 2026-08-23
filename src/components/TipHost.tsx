import React, { useEffect, useMemo, useRef } from 'react';
import { Animated, StyleSheet, Text, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useNavigation } from '@react-navigation/native';
import { useColors } from '../theme/ThemeContext';
import { animation, font, fontWeight, iconSize, lineHeight, radius, spacing, type Colors } from '../theme';
import { PressableScale } from './PressableScale';
import { useSettingsStore } from '../store/useSettingsStore';
import { useTipSignals } from '../hooks/useTipSignals';
import { useReduceMotion } from '../utils/useReduceMotion';
import { haptics } from '../utils/haptics';
import { getLogicalDayKey } from '../utils/dateUtils';
import { chooseTip, unseenTipsForScreen, type Tip, type TipScreen } from '../utils/tips';

/**
 * The one place the app volunteers something about itself.
 *
 * A hub screen renders `<TipHost screen="today" />` under its header and does
 * nothing else; which tip appears, whether one appears at all, and what
 * dismissing it means are all decided here and in `src/utils/tips.ts`.
 *
 * **Not an `OfferBanner`, and the difference is not cosmetic.** An offer is a
 * question about the data in front of you ("3 ingredients aren't on your list,
 * add them?"), so its callers compute a count live and render nothing at zero
 * — the answer emptying the set *is* the dismissal, which is why none of them
 * persists anything. A tip asks nothing and is about the app rather than the
 * data, so it has no set to empty: it needs a stored "seen", a rate limit, and
 * a second home to be dismissed *into*. Sharing the component would have meant
 * bolting all three onto the offer, and an offer that could be permanently
 * silenced is a different thing than the four callers of that one want.
 *
 * **The split into two components is what keeps this cheap.** The outer half
 * reads three scalars off the settings store and answers "could anything show
 * here at all". Only if the answer is yes does `ActiveTip` mount and start
 * subscribing to eight stores through `useTipSignals`. Once a screen's tips
 * are all dismissed — which is the steady state after a couple of weeks — this
 * costs one `Set` construction over a list of about sixty ids and nothing else.
 */
export function TipHost({ screen }: { screen: TipScreen }) {
  const tipsEnabled = useSettingsStore(s => s.tipsEnabled);
  const seenTips = useSettingsStore(s => s.seenTips);
  const lastTipShown = useSettingsStore(s => s.lastTipShown);

  const candidates = useMemo(
    () => (tipsEnabled ? unseenTipsForScreen(screen, seenTips) : []),
    [tipsEnabled, screen, seenTips]
  );

  if (candidates.length === 0) return null;

  // Today's slot is spent and it wasn't spent on one of this screen's tips, so
  // nothing here can show until tomorrow. Checked out here rather than inside
  // ActiveTip so the common "already had my tip today" case doesn't mount the
  // signals either. The day key costs a settings read and a format.
  const todayKey = getLogicalDayKey(new Date());
  if (lastTipShown?.day === todayKey && !candidates.some(tip => tip.id === lastTipShown.id)) {
    return null;
  }

  return <ActiveTip candidates={candidates} todayKey={todayKey} />;
}

function ActiveTip({ candidates, todayKey }: { candidates: Tip[]; todayKey: string }) {
  const signals = useTipSignals();
  const lastTipShown = useSettingsStore(s => s.lastTipShown);
  const stampTipShown = useSettingsStore(s => s.stampTipShown);
  const markTipSeen = useSettingsStore(s => s.markTipSeen);

  const choice = useMemo(
    () => chooseTip(candidates, signals, lastTipShown, todayKey),
    [candidates, signals, lastTipShown, todayKey]
  );

  const tip = choice?.tip ?? null;
  const needsStamp = choice?.stamp ?? false;

  // Spending the day's slot is a write, so it can't happen during render. The
  // effect re-runs when the chosen tip changes rather than only on mount: a
  // signal crossing its threshold while the screen is open promotes a tip
  // there and then, and that promotion has to be recorded like any other.
  useEffect(() => {
    if (tip && needsStamp) stampTipShown(tip.id, todayKey);
  }, [tip, needsStamp, todayKey, stampTipShown]);

  if (!tip) return null;

  return <TipCard tip={tip} onDismiss={() => markTipSeen(tip.id)} />;
}

/**
 * The banner itself. Exported for `TipsScreen`, which draws the same card in
 * its list so a tip looks the same in both places — the whole point of one
 * content module feeding two surfaces is undone if they don't resemble each
 * other.
 *
 * `onDismiss` omitted drops the ✕, which is what the browsable list wants: a
 * tip you went looking for isn't one you're being asked to acknowledge.
 */
export function TipCard({
  tip,
  onDismiss,
  seen = false,
}: {
  tip: Tip;
  onDismiss?: () => void;
  /** Draws the card quietly, for a tip already dismissed and merely on file. */
  seen?: boolean;
}) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const navigation = useNavigation<{ navigate: (screen: string) => void }>();
  const reduceMotion = useReduceMotion();
  const progress = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (reduceMotion) {
      progress.setValue(1);
      return;
    }
    Animated.timing(progress, {
      toValue: 1,
      duration: animation.duration.normal,
      useNativeDriver: true,
    }).start();
  }, [progress, reduceMotion]);

  const handleLink = () => {
    if (!tip.link) return;
    haptics.tap();
    navigation.navigate(tip.link.screen);
  };

  const handleDismiss = () => {
    haptics.tap();
    onDismiss?.();
  };

  return (
    <Animated.View
      style={[
        styles.container,
        seen && styles.containerSeen,
        {
          opacity: progress,
          transform: [{ translateY: progress.interpolate({ inputRange: [0, 1], outputRange: [-8, 0] }) }],
        },
      ]}
      accessibilityRole="summary"
      accessibilityLabel={`Tip. ${tip.title}. ${tip.body}`}
    >
      <View style={styles.headRow}>
        <Ionicons
          name={tip.icon as React.ComponentProps<typeof Ionicons>['name']}
          size={iconSize.sm}
          color={seen ? colors.textSecondary : colors.accent}
          style={styles.icon}
        />
        <Text style={styles.title}>{tip.title}</Text>
        {onDismiss != null && (
          <PressableScale
            style={styles.dismiss}
            onPress={handleDismiss}
            accessibilityLabel={`Dismiss tip: ${tip.title}`}
          >
            <Ionicons name="close" size={iconSize.sm} color={colors.textSecondary} />
          </PressableScale>
        )}
      </View>
      <Text style={styles.body}>{tip.body}</Text>
      {tip.link != null && (
        <PressableScale
          style={styles.linkButton}
          onPress={handleLink}
          accessibilityLabel={tip.link.label}
        >
          <Text style={styles.linkText}>{tip.link.label}</Text>
        </PressableScale>
      )}
    </Animated.View>
  );
}

const makeStyles = (colors: Colors) => StyleSheet.create({
  // accentSubtle, the same call OfferBanner and ProjectNudgeBanner make: this
  // is an aside, not an alert, and nothing here needs answering.
  container: {
    backgroundColor: colors.accentSubtle,
    gap: spacing.xs,
    marginHorizontal: spacing.md,
    marginTop: spacing.sm,
    // Both sides, per the design-system note: the element under this one has
    // no top margin of its own to lean on.
    marginBottom: spacing.sm,
    paddingVertical: spacing.sm,
    paddingLeft: spacing.md,
    paddingRight: spacing.sm,
    borderRadius: radius.lg,
  },
  // On the Tips screen a dismissed tip is still listed, and sixty accent cards
  // in a column is a wall. Tinting only the unread ones is what makes "here is
  // something you haven't read" legible in a list that holds everything.
  containerSeen: { backgroundColor: colors.bgSecondary },
  headRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  icon: { marginTop: 1 },
  title: { flex: 1, color: colors.text, fontSize: font.md, fontWeight: fontWeight.semibold },
  body: { color: colors.textSecondary, fontSize: font.sm, lineHeight: lineHeight.sm },
  dismiss: { padding: spacing.xs },
  // Aligned left rather than stretched: it's an offer to go somewhere, not the
  // card's primary action, and a full-width button would read as one.
  linkButton: {
    alignSelf: 'flex-start',
    marginTop: spacing.xs,
    backgroundColor: colors.accent,
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
    borderRadius: radius.full,
  },
  linkText: { color: colors.onAccent, fontSize: font.sm, fontWeight: fontWeight.semibold },
});
