import React, { useRef, useMemo, useCallback } from 'react';
import { View, StyleSheet, Platform, ScrollView, KeyboardAvoidingView } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import { useColors } from '../theme/ThemeContext';
import { spacing, type Colors } from '../theme';
import { DetailHeader } from '../components/DetailHeader';
import { settingsGroup, type SettingsGroupId } from '../utils/settingsIndex';
import { settingsFocusScrollTarget } from '../utils/settingsFocusScroll';
import { SettingsFocusProvider, type MeasurableRow } from './settings/SettingsFocus';
import { AppearanceSettings } from './settings/AppearanceSettings';
import { DayTimeSettings } from './settings/DayTimeSettings';
import { NotificationSettings } from './settings/NotificationSettings';
import { RemindersCaptureSettings } from './settings/RemindersCaptureSettings';
import { CalendarSettings } from './settings/CalendarSettings';
import { DeadlineCalendarSettings } from './settings/DeadlineCalendarSettings';
import { MealCalendarSettings } from './settings/MealCalendarSettings';
import { TasksProjectsSettings } from './settings/TasksProjectsSettings';
import { GeneratedTasksSection } from './settings/GeneratedTasksSection';
import { HealthSettings } from './settings/HealthSettings';
import { KitchenSettings } from './settings/KitchenSettings';
import { PrivacyAiSettings } from './settings/PrivacyAiSettings';
import { DataResetSettings } from './settings/DataResetSettings';
import { SyncSettings } from './settings/SyncSettings';
import { AboutSettings } from './settings/AboutSettings';
import { useSettingsStore } from '../store/useSettingsStore';

type RootStackParamList = {
  SettingsGroup: {
    groupId: SettingsGroupId;
    /**
     * The row a search was looking for, if this group was opened from a result
     * rather than from the index. See SettingsFocus.
     */
    entryId?: string;
  };
};

/**
 * One route for all ten groups rather than ten routes: they differ only in
 * which component fills the scroll view, and ten registrations would mean ten
 * more entries in the navigator's pushed-route list too.
 *
 * It also takes an optional `entryId`, which is how a search result opens onto
 * the row it named rather than onto the top of the group holding it. See
 * `./settings/SettingsFocus`.
 */
export function SettingsGroupScreen() {
  const navigation = useNavigation();
  const route = useRoute<RouteProp<RootStackParamList, 'SettingsGroup'>>();
  const { groupId, entryId } = route.params;
  const insets = useSafeAreaInsets();
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const scrollRef = useRef<ScrollView>(null);
  // measureLayout needs an ancestor to measure against, and the ScrollView's
  // own ref is the wrong one — it measures the viewport, not the content. This
  // wraps the content so a row's `y` comes back as a content-Y, which is the
  // coordinate scrollTo speaks.
  const contentRef = useRef<View>(null);
  const contentHeight = useRef<number | undefined>(undefined);
  const viewportHeight = useRef<number | undefined>(undefined);

  // Straight off the route param, not state: a search pushes this screen fresh
  // each time, so there is nothing to reset, and the highlight ends by fading
  // itself rather than by being switched off from here.
  const focusedEntryId = entryId ?? null;
  const scrolledRef = useRef(false);

  const reportRow = useCallback((_id: string, node: MeasurableRow | null) => {
    // Once only: a row that re-lays out (its pills unfolding, a hint appearing)
    // would otherwise drag the list back under a finger that had moved on.
    if (!node || scrolledRef.current || typeof node.measureLayout !== 'function') return;
    const container = contentRef.current;
    if (!container) return;
    scrolledRef.current = true;
    try {
      node.measureLayout(
        container,
        (_x, y) => {
          scrollRef.current?.scrollTo({
            y: settingsFocusScrollTarget(y, contentHeight.current, viewportHeight.current),
            animated: true,
          });
        },
        // A row that can't be measured keeps its highlight and simply doesn't
        // scroll, which is the behaviour this whole feature replaces rather
        // than a new failure.
        () => {},
      );
    } catch {
      // Same: measuring is the optimisation, the highlight is the answer.
    }
  }, []);

  const group = settingsGroup(groupId);
  // Gated here rather than inside the section, so the whole thing — including
  // its header and footer — leaves with the rest of the area. Same rule the
  // Meals on Today section follows in TasksProjectsSettings.
  const kitchenEnabled = useSettingsStore(s => s.kitchenEnabled);

  return (
    <View style={[styles.root, { paddingTop: insets.top + spacing.md }]}>
      <DetailHeader title={group?.title ?? 'Settings'} onBack={() => navigation.goBack()} />

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          ref={scrollRef}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ paddingBottom: insets.bottom + spacing.xl }}
          onLayout={e => { viewportHeight.current = e.nativeEvent.layout.height; }}
          onContentSizeChange={(_w, h) => { contentHeight.current = h; }}
        >
          <View ref={contentRef} collapsable={false}>
          <SettingsFocusProvider focusedEntryId={focusedEntryId} reportRow={reportRow}>
          {groupId === 'appearance' && <AppearanceSettings />}
          {groupId === 'dayTime' && <DayTimeSettings />}
          {groupId === 'notifications' && <NotificationSettings />}
          {groupId === 'capture' && <RemindersCaptureSettings />}
          {groupId === 'capture' && <CalendarSettings />}
          {groupId === 'capture' && <DeadlineCalendarSettings />}
          {groupId === 'capture' && kitchenEnabled && <MealCalendarSettings />}
          {groupId === 'tasksProjects' && <TasksProjectsSettings />}
          {groupId === 'generated' && <GeneratedTasksSection />}
          {/* No Platform check: the whole group is `iosOnly`, so the index
              stops offering it and this route stops being reachable. */}
          {groupId === 'health' && <HealthSettings />}
          {/* No kitchenEnabled check: the whole group is `kitchenOnly`, so the
              index stops offering it and this route stops being reachable. */}
          {groupId === 'kitchen' && <KitchenSettings />}
          {groupId === 'privacyAi' && <PrivacyAiSettings scrollRef={scrollRef} />}
          {groupId === 'dataReset' && <SyncSettings />}
          {groupId === 'dataReset' && <DataResetSettings />}
          {groupId === 'about' && <AboutSettings />}
          </SettingsFocusProvider>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

const makeStyles = (colors: Colors) => StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
});
