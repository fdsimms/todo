import React, { useCallback, useMemo, useState } from 'react';
import { FlatList, StyleSheet, Text, View, Alert } from 'react-native';
import { useBottomTabBarHeight } from '@react-navigation/bottom-tabs';
import { useShallow } from 'zustand/react/shallow';
import { ScreenHeader, type ScreenHeaderAction } from '../components/ScreenHeader';
import { SearchField } from '../components/SearchField';
import { EmptyState } from '../components/EmptyState';
import { TipCard } from '../components/TipHost';
import { useKeyboardInsetScroll } from '../hooks/useKeyboardInsetScroll';
import { useSettingsStore } from '../store/useSettingsStore';
import { useColors } from '../theme/ThemeContext';
import { font, fontWeight, spacing, type Colors } from '../theme';
import { haptics } from '../utils/haptics';
import { TIPS, TIP_AREAS, filterTips, tipsFor, type Tip } from '../utils/tips';

/**
 * Everything the app can do, in one list.
 *
 * The other half of the tip system, and the half that makes dismissing one
 * safe: `TipHost` shows a tip once, and a ✕ on a banner would otherwise be the
 * last time that sentence existed anywhere. Here every tip is on file whether
 * it ever surfaced, whether it was dismissed, and whether its `when` has ever
 * been true — which also makes this the app's answer to "what can this thing
 * even do", a question nothing in here could previously answer.
 *
 * Unread tips are tinted and sort to nothing in particular: the order is the
 * one in `TIPS`, grouped by area, because a list that reorders itself as you
 * read it is one you can't come back to. Same call `filterEditorRows` makes
 * about not ranking a form.
 */

type Row =
  | { type: 'header'; key: string; title: string; unread: number }
  | { type: 'tip'; key: string; tip: Tip; seen: boolean };

export function TipsScreen() {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const tabBarHeight = useBottomTabBarHeight();
  const keyboardScroll = useKeyboardInsetScroll<FlatList>();

  const seenTips = useSettingsStore(useShallow(s => s.seenTips));
  const markAllTipsSeen = useSettingsStore(s => s.markAllTipsSeen);
  const simpleMode = useSettingsStore(s => s.simpleMode);
  const resetTips = useSettingsStore(s => s.resetTips);

  const [query, setQuery] = useState('');

  const seenSet = useMemo(() => new Set(seenTips), [seenTips]);
  // Every count on this page is over the same set the list draws, so "12 of 40
  // not read yet" can't name tips the page doesn't show.
  const visible = useMemo(() => tipsFor(simpleMode), [simpleMode]);
  const matches = useMemo(() => filterTips(query, visible), [query, visible]);
  const unreadCount = useMemo(
    () => visible.filter(tip => !seenSet.has(tip.id)).length,
    [visible, seenSet]
  );

  const rows = useMemo<Row[]>(() => {
    const out: Row[] = [];
    for (const area of TIP_AREAS) {
      const tips = matches.filter(tip => tip.area === area.id);
      // A section with no match under the current query drops out entirely,
      // header included, so searching narrows the page rather than leaving a
      // column of empty headings behind.
      if (tips.length === 0) continue;
      out.push({
        type: 'header',
        key: `header-${area.id}`,
        title: area.title,
        unread: tips.filter(tip => !seenSet.has(tip.id)).length,
      });
      for (const tip of tips) {
        out.push({ type: 'tip', key: tip.id, tip, seen: seenSet.has(tip.id) });
      }
    }
    return out;
  }, [matches, seenSet]);

  // Marks what's on screen, not what exists. A tip hidden by simplified mode
  // hasn't been read, so it stays unread and comes back with its feature.
  const handleMarkAllRead = useCallback(() => {
    haptics.tap();
    markAllTipsSeen(visible.map(tip => tip.id));
  }, [markAllTipsSeen, visible]);

  const handleReset = useCallback(() => {
    haptics.tap();
    Alert.alert(
      'Show all tips again',
      'Every tip becomes unread, and the app will start offering them on their screens again, one a day.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Show again', onPress: () => resetTips() },
      ]
    );
  }, [resetTips]);

  const actions = useMemo<ScreenHeaderAction[]>(() => {
    const list: ScreenHeaderAction[] = [];
    if (unreadCount > 0) {
      list.push({
        icon: 'checkmark-done-outline',
        onPress: handleMarkAllRead,
        accessibilityLabel: 'Mark every tip as read',
      });
    }
    if (unreadCount < TIPS.length) {
      list.push({
        icon: 'refresh-outline',
        onPress: handleReset,
        accessibilityLabel: 'Show all tips again',
      });
    }
    return list;
  }, [unreadCount, handleMarkAllRead, handleReset]);

  const renderRow = useCallback(({ item }: { item: Row }) => {
    if (item.type === 'header') {
      return (
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionHeaderText}>{item.title}</Text>
          {item.unread > 0 && <Text style={styles.sectionHeaderCount}>{item.unread} new</Text>}
        </View>
      );
    }
    // No `onDismiss`: a tip you came here to read isn't one you're being asked
    // to acknowledge, and sixty ✕s is a chore rather than a list. The header's
    // "mark all read" is the way to silence them.
    return <TipCard tip={item.tip} seen={item.seen} />;
  }, [styles]);

  return (
    <View style={styles.container}>
      <ScreenHeader
        title="Tips"
        subtitle={
          unreadCount > 0
            ? `${unreadCount} of ${TIPS.length} not read yet`
            : `All ${TIPS.length} read`
        }
        actions={actions}
      />

      <SearchField
        value={query}
        onChangeText={setQuery}
        placeholder="Search tips"
        style={styles.search}
        accessibilityLabel="Search tips"
      />

      {rows.length === 0 ? (
        <EmptyState
          icon="bulb-outline"
          title="Nothing matches"
          subtitle={`No tip mentions "${query}". Try one word instead of two.`}
          bottomOffset={tabBarHeight}
        />
      ) : (
        <FlatList
          ref={keyboardScroll.ref}
          data={rows}
          keyExtractor={row => row.key}
          renderItem={renderRow}
          contentContainerStyle={{ paddingBottom: tabBarHeight + spacing.xl }}
          keyboardDismissMode="on-drag"
          showsVerticalScrollIndicator={false}
          {...keyboardScroll.props}
        />
      )}
    </View>
  );
}

const makeStyles = (colors: Colors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  search: { marginHorizontal: spacing.md, marginBottom: spacing.xs },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.lg,
    paddingBottom: spacing.xs,
  },
  // textSecondary, not textTertiary — the app-wide section-header rule.
  sectionHeaderText: {
    flex: 1,
    color: colors.textSecondary,
    fontSize: font.xs,
    fontWeight: fontWeight.semibold,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
  sectionHeaderCount: { color: colors.accent, fontSize: font.xs, fontWeight: fontWeight.semibold },
});
