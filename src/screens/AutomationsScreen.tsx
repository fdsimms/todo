import React, { useCallback, useMemo } from 'react';
import { View, ScrollView, StyleSheet, Text } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useBottomTabBarHeight } from '@react-navigation/bottom-tabs';
import { useFocusEffect, useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useShallow } from 'zustand/react/shallow';
import { useSettingsStore } from '../store/useSettingsStore';
import { ScreenHeader } from '../components/ScreenHeader';
import { useColors } from '../theme/ThemeContext';
import { font, spacing, type Colors } from '../theme';
import { PressableScale } from '../components/PressableScale';
import { navigateToTab } from '../navigation/navigationRef';
import { menuLabelFor } from '../utils/navHubs';
import { haptics } from '../utils/haptics';
import {
  describeGeneratedCounts,
  generatedTaskCounts,
  GENERATED_KIND_LIST,
  type GeneratedEnabledKey,
} from '../utils/generatedTasks';
import { GeneratedTasksSection } from './settings/GeneratedTasksSection';
import { SettingsFocusProvider, useSettingsFocusScroll } from './settings/SettingsFocus';
import { SearchField } from '../components/SearchField';
import { useFilterField } from '../hooks/useFilterField';
import { usePullToSearch } from '../hooks/usePullToSearch';
import { useKeyboardInsetScroll } from '../hooks/useKeyboardInsetScroll';

type AutomationsParams = {
  Automations: {
    /** The row a Settings search was looking for. See SettingsFocus. */
    entryId?: string;
    /** Makes a second search for the same row a new request, since this tab stays mounted. */
    focusStamp?: number;
    /**
     * The screen whose gear sheet sent you here. A tab has no back button, so
     * this draws one, which takes you back there.
     */
    returnTo?: string;
  } | undefined;
};

/**
 * Every task the app writes without being asked: the generator switches, their
 * options and their rules, in one list.
 *
 * It used to be a group in Settings ("Automatic tasks"), and was moved out to
 * the menu because it is a feature people come back to (adding a weather rule,
 * turning birthday tasks on for a new friend) rather than configuration set
 * once. The rows are the same `GeneratedTasksSection` the Settings group drew,
 * and the settings index still carries them (`SettingsGroup.screen`), so a
 * Settings search for "weather" lands here on the right row.
 *
 * The pulse button opens Activity, the record of what these added and cleared,
 * which links back here. The two are the switch and its log.
 */
export function AutomationsScreen() {
  const pullSearch = usePullToSearch();
  const tabBarHeight = useBottomTabBarHeight();
  const insets = useSafeAreaInsets();
  const navigation = useNavigation();
  const route = useRoute<RouteProp<AutomationsParams, 'Automations'>>();
  const entryId = route.params?.entryId;
  const focusStamp = route.params?.focusStamp;
  const returnTo = route.params?.returnTo;
  const searchFilter = useFilterField();
  // The search field sits over the list rather than in it, so without this the
  // keyboard covers the last rows with no room to scroll them clear (see the
  // hook's `fieldAbove` note).
  const keyboardScroll = useKeyboardInsetScroll<ScrollView>({
    fieldAbove: true,
    refreshing: pullSearch.pulling,
  });
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  // Counted from the same listing the rows below render from, so the subtitle
  // can't disagree with the list under it.
  const counts = useSettingsStore(useShallow(s => generatedTaskCounts(
    Object.fromEntries(
      GENERATED_KIND_LIST.map(spec => [spec.enabledKey, s[spec.enabledKey]]),
    ) as Record<GeneratedEnabledKey, boolean>,
    s.kitchenEnabled,
  )));

  const { scrollRef, contentRef, reportRow, scrollProps } = useSettingsFocusScroll(focusStamp);

  // The list is scrolled by both: a search result scrolls it to a row, and the
  // keyboard hook re-clamps it once the keyboard goes.
  const setScrollRefs = useCallback((node: ScrollView | null) => {
    scrollRef.current = node;
    keyboardScroll.ref.current = node;
  }, [scrollRef, keyboardScroll.ref]);

  // A tab keeps its params, so a row found by search would otherwise count as
  // "the one you searched for" on every later visit from the menu. Cleared on
  // the way out rather than on a timer: the highlight fades by itself.
  // The hand-back goes the same way: it belongs to the one visit it was for.
  useFocusEffect(useCallback(() => () => {
    if (entryId !== undefined || returnTo !== undefined) {
      (navigation as never as { setParams: (p: object) => void })
        .setParams({ entryId: undefined, focusStamp: undefined, returnTo: undefined });
    }
  }, [entryId, returnTo, navigation]));

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      {returnTo && (
        <PressableScale
          style={styles.back}
          onPress={() => { haptics.tap(); navigateToTab(returnTo); }}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel={`Back to ${menuLabelFor(returnTo)}`}
        >
          <Ionicons name="chevron-back" size={22} color={colors.accent} />
          <Text style={styles.backLabel}>{menuLabelFor(returnTo)}</Text>
        </PressableScale>
      )}
      <ScreenHeader
        title="Automations"
        subtitle={describeGeneratedCounts(counts)}
        actions={[{
          icon: 'pulse-outline',
          onPress: () => navigation.navigate('UnattendedLog' as never),
          accessibilityLabel: 'Activity',
        }]}
      />
      <SearchField
        style={styles.search}
        placeholder="Search automations"
        field={searchFilter}
        accessibilityLabel="Search automations"
      />
      <ScrollView
        refreshControl={pullSearch.refreshControl}
        ref={setScrollRefs}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ paddingBottom: tabBarHeight + spacing.xl }}
        {...keyboardScroll.props}
        {...scrollProps}
      >
        {/* Keyed on the stamp so a repeat search for the same row remounts
            the list, which is what replays the row's highlight. */}
        <View ref={contentRef} collapsable={false} key={focusStamp ?? 'list'}>
          <SettingsFocusProvider focusedEntryId={entryId ?? null} reportRow={reportRow}>
            <GeneratedTasksSection query={searchFilter.query} />
          </SettingsFocusProvider>
        </View>
      </ScrollView>
      {pullSearch.sheet}
    </View>
  );
}

const makeStyles = (colors: Colors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  search: { marginHorizontal: spacing.md, marginTop: spacing.sm, marginBottom: spacing.sm },
  // The iOS back button's shape: a chevron and the name of where it goes, in
  // the accent, above the large title.
  back: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    minHeight: 44,
    paddingLeft: spacing.sm,
    paddingRight: spacing.md,
  },
  backLabel: { color: colors.accentText, fontSize: font.md },
});
