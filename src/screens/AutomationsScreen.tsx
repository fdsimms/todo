import React, { useCallback, useMemo } from 'react';
import { View, ScrollView, StyleSheet } from 'react-native';
import { useBottomTabBarHeight } from '@react-navigation/bottom-tabs';
import { useFocusEffect, useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useShallow } from 'zustand/react/shallow';
import { useSettingsStore } from '../store/useSettingsStore';
import { ScreenHeader } from '../components/ScreenHeader';
import { useColors } from '../theme/ThemeContext';
import { spacing, type Colors } from '../theme';
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

type AutomationsParams = {
  Automations: {
    /** The row a Settings search was looking for. See SettingsFocus. */
    entryId?: string;
    /** Makes a second search for the same row a new request, since this tab stays mounted. */
    focusStamp?: number;
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
  const searchFilter = useFilterField();
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

  // A tab keeps its params, so a row found by search would otherwise count as
  // "the one you searched for" on every later visit from the menu. Cleared on
  // the way out rather than on a timer: the highlight fades by itself.
  useFocusEffect(useCallback(() => () => {
    if (entryId !== undefined) {
      (navigation as never as { setParams: (p: object) => void })
        .setParams({ entryId: undefined, focusStamp: undefined });
    }
  }, [entryId, navigation]));

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
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
        ref={scrollRef}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        contentContainerStyle={{ paddingBottom: tabBarHeight + spacing.xl }}
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
});
