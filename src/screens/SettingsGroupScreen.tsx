import React, { useMemo } from 'react';
import { View, StyleSheet, Platform, ScrollView, KeyboardAvoidingView } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import { useColors } from '../theme/ThemeContext';
import { spacing, type Colors } from '../theme';
import { DetailHeader } from '../components/DetailHeader';
import { settingsGroup, type SettingsGroupId } from '../utils/settingsIndex';
import { SettingsFocusProvider, useSettingsFocusScroll } from './settings/SettingsFocus';
import { FeatureAreasSettings } from './settings/FeatureAreasSettings';
import { AppearanceSettings } from './settings/AppearanceSettings';
import { DayTimeSettings } from './settings/DayTimeSettings';
import { NotificationSettings } from './settings/NotificationSettings';
import { RemindersCaptureSettings } from './settings/RemindersCaptureSettings';
import { CalendarSettings } from './settings/CalendarSettings';
import { DeadlineCalendarSettings } from './settings/DeadlineCalendarSettings';
import { CompletionCalendarSettings } from './settings/CompletionCalendarSettings';
import { MealCalendarSettings } from './settings/MealCalendarSettings';
import { ClaudeCalendarSettings } from './settings/ClaudeCalendarSettings';
import { TasksProjectsSettings } from './settings/TasksProjectsSettings';
import { FocusSettings } from './settings/FocusSettings';
import { VacationTripsSettings } from './settings/VacationTripsSettings';
import { HealthSettings } from './settings/HealthSettings';
import { PermissionsSettings } from './settings/PermissionsSettings';
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
 * One route for every group rather than a route each: they differ only in which
 * component fills the scroll view, and a dozen registrations would mean a dozen
 * more entries in the navigator's pushed-route list too. The one exception is
 * Automations, which is a menu screen of its own (`SettingsGroup.screen`).
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
  const { scrollRef, contentRef, reportRow, scrollProps } = useSettingsFocusScroll();

  // Straight off the route param, not state: a search pushes this screen fresh
  // each time, so there is nothing to reset, and the highlight ends by fading
  // itself rather than by being switched off from here.
  const focusedEntryId = entryId ?? null;

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
          {...scrollProps}
        >
          <View ref={contentRef} collapsable={false}>
          <SettingsFocusProvider focusedEntryId={focusedEntryId} reportRow={reportRow}>
          {groupId === 'featureAreas' && <FeatureAreasSettings />}
          {groupId === 'appearance' && <AppearanceSettings />}
          {groupId === 'dayTime' && <DayTimeSettings />}
          {groupId === 'dayTime' && <VacationTripsSettings />}
          {groupId === 'notifications' && <NotificationSettings />}
          {groupId === 'capture' && <RemindersCaptureSettings />}
          {groupId === 'calendar' && <CalendarSettings />}
          {groupId === 'calendar' && <DeadlineCalendarSettings />}
          {groupId === 'calendar' && <CompletionCalendarSettings />}
          {groupId === 'calendar' && kitchenEnabled && <MealCalendarSettings />}
          {groupId === 'calendar' && <ClaudeCalendarSettings />}
          {groupId === 'tasksProjects' && <TasksProjectsSettings />}
          {groupId === 'focus' && <FocusSettings />}
          {/* No 'generated' case: that group lives on the Automations screen
              (SettingsGroup.screen), so nothing routes it here. */}
          {/* No Platform check: the whole group is `iosOnly`, so the index
              stops offering it and this route stops being reachable. */}
          {groupId === 'health' && <HealthSettings />}
          {groupId === 'permissions' && <PermissionsSettings />}
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
