import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Text, View, StyleSheet, Animated, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useColors } from '../theme/ThemeContext';
import { animation, font, fontWeight, iconSize, interaction, radius, spacing, type Colors } from '../theme';
import { PressableScale } from './PressableScale';
import { useReduceMotion } from '../utils/useReduceMotion';
import { haptics } from '../utils/haptics';
import { animateLayout } from '../utils/layoutAnimation';
import type { ProjectStall } from '../utils/projectPull';

/** How many projects the banner lists before it collapses the rest into "+N more". */
const PREVIEW_LIMIT = 3;

interface Props {
  stalls: ProjectStall[];
  /**
   * Opens the pull sheet, scoped to the project the tap was about — the
   * banner's overall Review button scopes to every quiet project it's
   * currently showing, a single row's tap scopes to just that one.
   */
  onReview: (projectIds: string[]) => void;
  onDismiss: () => void;
}

/**
 * Banner shown on Today when projects have gone quiet — nothing in them is
 * scheduled, so nothing in them appears in any list (see utils/projectPull for
 * why that happens and what "quiet" means).
 *
 * It names the projects and how long each has been silent rather than only
 * counting them, for the same reason NewTasksBanner names its tasks: the whole
 * problem is that these projects are invisible, so a bare count would tell you
 * something is missing without telling you what.
 */
export function ProjectNudgeBanner({ stalls, onReview, onDismiss }: Props) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const reduceMotion = useReduceMotion();
  const progress = useRef(new Animated.Value(0)).current;
  const [collapsed, setCollapsed] = useState(false);
  const [showAll, setShowAll] = useState(false);

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

  const count = stalls.length;
  const shown = collapsed ? [] : showAll ? stalls : stalls.slice(0, PREVIEW_LIMIT);
  const remaining = count - shown.length;

  const handleDismiss = () => {
    haptics.tap();
    onDismiss();
  };

  const toggleCollapsed = () => {
    haptics.tap();
    animateLayout();
    setCollapsed(v => !v);
  };

  const handleShowAll = () => {
    haptics.tap();
    animateLayout();
    setShowAll(true);
  };

  return (
    <Animated.View
      style={[
        styles.container,
        {
          opacity: progress,
          transform: [{ translateY: progress.interpolate({ inputRange: [0, 1], outputRange: [-8, 0] }) }],
        },
      ]}
    >
      <View style={styles.headerRow}>
        <TouchableOpacity
          style={styles.summary}
          onPress={toggleCollapsed}
          activeOpacity={interaction.activeOpacity}
          accessibilityRole="button"
          accessibilityState={{ expanded: !collapsed }}
          accessibilityLabel={`${count} project${count === 1 ? '' : 's'} ${count === 1 ? 'has' : 'have'} gone quiet`}
          accessibilityHint={collapsed ? 'Show which projects are quiet' : 'Hide the list of quiet projects'}
        >
          <Text style={styles.text} numberOfLines={1}>
            <Text style={styles.count}>{count}</Text> project{count === 1 ? '' : 's'} gone quiet
          </Text>
          <Ionicons
            name={collapsed ? 'chevron-down' : 'chevron-up'}
            size={iconSize.sm}
            color={colors.textSecondary}
          />
        </TouchableOpacity>
        <PressableScale
          style={styles.button}
          onPress={() => onReview(stalls.map(s => s.project.id))}
          accessibilityLabel="Pull a task from a quiet project"
        >
          <Text style={styles.buttonText}>Review</Text>
        </PressableScale>
        <PressableScale
          style={styles.dismiss}
          onPress={handleDismiss}
          accessibilityLabel="Dismiss quiet projects notice for today"
        >
          <Ionicons name="close" size={iconSize.sm} color={colors.textSecondary} />
        </PressableScale>
      </View>

      {shown.length > 0 && (
        <View style={styles.list}>
          {shown.map(stall => (
            <TouchableOpacity
              key={stall.project.id}
              style={styles.projectRow}
              onPress={() => onReview([stall.project.id])}
              activeOpacity={interaction.activeOpacity}
              accessibilityRole="button"
              accessibilityLabel={`${stall.project.title}, nothing scheduled for ${stall.quietDays} days`}
            >
              <View style={styles.dot} />
              <Text style={styles.projectTitle} numberOfLines={1}>{stall.project.title}</Text>
              <Text style={styles.quiet} numberOfLines={1}>{stall.quietDays}d</Text>
              <Ionicons name="chevron-forward" size={iconSize.sm} color={colors.textTertiary} />
            </TouchableOpacity>
          ))}
          {remaining > 0 && (
            <TouchableOpacity
              style={styles.moreRow}
              onPress={handleShowAll}
              activeOpacity={interaction.activeOpacity}
              accessibilityRole="button"
              accessibilityLabel={`Show ${remaining} more quiet project${remaining === 1 ? '' : 's'}`}
            >
              <Text style={styles.moreText}>+{remaining} more</Text>
            </TouchableOpacity>
          )}
        </View>
      )}
    </Animated.View>
  );
}

const makeStyles = (colors: Colors) => StyleSheet.create({
  container: {
    // accentSubtle, not warningBg: the yellow banner means "something new
    // arrived and you may have missed it". A quiet project is neither new nor
    // an alert — it's an offer, so it takes the informational tint that pairs
    // with the accent Review button rather than competing with NewTasksBanner
    // directly above it.
    backgroundColor: colors.accentSubtle,
    marginHorizontal: spacing.md,
    marginTop: spacing.md,
    marginBottom: spacing.sm,
    paddingVertical: spacing.sm,
    paddingLeft: spacing.md,
    paddingRight: spacing.sm,
    borderRadius: radius.lg,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  summary: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  text: { flexShrink: 1, color: colors.text, fontSize: font.md },
  count: { fontWeight: fontWeight.bold },
  button: {
    backgroundColor: colors.accent,
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
    borderRadius: radius.full,
  },
  buttonText: { color: colors.onAccent, fontSize: font.sm, fontWeight: fontWeight.bold },
  dismiss: { padding: spacing.xs },
  list: {
    marginTop: spacing.xs,
    paddingRight: spacing.xs,
  },
  projectRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.xs,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.accent,
  },
  projectTitle: { flexShrink: 1, color: colors.text, fontSize: font.sm },
  quiet: {
    flexShrink: 0,
    marginLeft: 'auto',
    color: colors.textSecondary,
    fontSize: font.xs,
  },
  moreRow: { paddingVertical: spacing.xs },
  moreText: { color: colors.textSecondary, fontSize: font.xs, fontWeight: fontWeight.semibold },
});
