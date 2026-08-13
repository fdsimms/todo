import React, { useRef, useMemo } from 'react';
import { View, StyleSheet, Platform, ScrollView, KeyboardAvoidingView } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import { useColors } from '../theme/ThemeContext';
import { spacing, type Colors } from '../theme';
import { DetailHeader } from '../components/DetailHeader';
import { settingsGroup, type SettingsGroupId } from '../utils/settingsIndex';
import { AppearanceSettings } from './settings/AppearanceSettings';
import { DayTimeSettings } from './settings/DayTimeSettings';
import { NotificationSettings } from './settings/NotificationSettings';
import { RemindersCaptureSettings } from './settings/RemindersCaptureSettings';
import { CalendarSettings } from './settings/CalendarSettings';
import { DeadlineCalendarSettings } from './settings/DeadlineCalendarSettings';
import { TasksProjectsSettings } from './settings/TasksProjectsSettings';
import { PrivacyAiSettings } from './settings/PrivacyAiSettings';
import { DataResetSettings } from './settings/DataResetSettings';
import { AboutSettings } from './settings/AboutSettings';

type RootStackParamList = {
  SettingsGroup: { groupId: SettingsGroupId };
};

/**
 * One route for all eight groups rather than eight routes: they differ only in
 * which component fills the scroll view, and eight registrations would mean
 * eight more entries in the navigator's pushed-route list too.
 */
export function SettingsGroupScreen() {
  const navigation = useNavigation();
  const route = useRoute<RouteProp<RootStackParamList, 'SettingsGroup'>>();
  const { groupId } = route.params;
  const insets = useSafeAreaInsets();
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const scrollRef = useRef<ScrollView>(null);

  const group = settingsGroup(groupId);

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
        >
          {groupId === 'appearance' && <AppearanceSettings />}
          {groupId === 'dayTime' && <DayTimeSettings />}
          {groupId === 'notifications' && <NotificationSettings />}
          {groupId === 'capture' && <RemindersCaptureSettings />}
          {groupId === 'capture' && <CalendarSettings />}
          {groupId === 'capture' && <DeadlineCalendarSettings />}
          {groupId === 'tasksProjects' && <TasksProjectsSettings />}
          {groupId === 'privacyAi' && <PrivacyAiSettings scrollRef={scrollRef} />}
          {groupId === 'dataReset' && <DataResetSettings />}
          {groupId === 'about' && <AboutSettings />}
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

const makeStyles = (colors: Colors) => StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
});
