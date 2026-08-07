import React, { useRef } from 'react';
import { View, StyleSheet, Platform, ScrollView, KeyboardAvoidingView } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { useColors } from '../theme/ThemeContext';
import { spacing, type Colors } from '../theme';
import { DetailHeader } from '../components/DetailHeader';
import { AppearanceSettings } from './settings/AppearanceSettings';
import { DayTimeSettings } from './settings/DayTimeSettings';
import { NotificationSettings } from './settings/NotificationSettings';
import { RemindersCaptureSettings } from './settings/RemindersCaptureSettings';
import { TasksProjectsSettings } from './settings/TasksProjectsSettings';
import { PrivacyAiSettings } from './settings/PrivacyAiSettings';
import { DataResetSettings } from './settings/DataResetSettings';
import { AboutSettings } from './settings/AboutSettings';

export function SettingsScreen() {
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const colors = useColors();
  const styles = React.useMemo(() => makeStyles(colors), [colors]);
  const scrollRef = useRef<ScrollView>(null);

  return (
    <View style={[styles.root, { paddingTop: insets.top + spacing.md }]}>
      <DetailHeader title="Settings" onBack={() => navigation.goBack()} />

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          ref={scrollRef}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ paddingBottom: insets.bottom + spacing.xl }}
        >
          <AppearanceSettings />
          <DayTimeSettings />
          <NotificationSettings />
          {Platform.OS === 'ios' && <RemindersCaptureSettings />}
          <TasksProjectsSettings />
          <PrivacyAiSettings scrollRef={scrollRef} />
          <DataResetSettings />
          <AboutSettings />
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

const makeStyles = (colors: Colors) => StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
});
