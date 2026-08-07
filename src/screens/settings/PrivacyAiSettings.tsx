import React, { useState, useMemo } from 'react';
import { View, TextInput, Alert, AppState, type ScrollView } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { useSettingsStore } from '../../store/useSettingsStore';
import { useAppLockStore } from '../../store/useAppLockStore';
import { APP_LOCK_GRACE_OPTIONS, graceLabel } from '../../utils/appLock';
import { authenticateForAppLock, getAppLockSupport, type AppLockSupport } from '../../utils/appLockAuth';
import { useColors } from '../../theme/ThemeContext';
import { SettingsSection } from './SettingsSection';
import { SettingsRow } from './SettingsRow';
import { SettingsPills, type PillOption } from './SettingsPills';
import { makeSettingsStyles } from './settingsStyles';

interface Props {
  /** The host screen's scroll view, so focusing the key field can reveal it. */
  scrollRef?: React.RefObject<ScrollView | null>;
}

const GRACE_OPTIONS: PillOption<number>[] =
  APP_LOCK_GRACE_OPTIONS.map(o => ({ value: o.value, label: o.label }));

export function PrivacyAiSettings({ scrollRef }: Props) {
  const appLockEnabled = useSettingsStore(s => s.appLockEnabled);
  const setAppLockEnabled = useSettingsStore(s => s.setAppLockEnabled);
  const appLockGraceSeconds = useSettingsStore(s => s.appLockGraceSeconds);
  const setAppLockGraceSeconds = useSettingsStore(s => s.setAppLockGraceSeconds);
  const anthropicApiKey = useSettingsStore(s => s.anthropicApiKey);
  const setAnthropicApiKey = useSettingsStore(s => s.setAnthropicApiKey);

  const colors = useColors();
  const styles = useMemo(() => makeSettingsStyles(colors), [colors]);

  // What the device can authenticate with changes in the system Settings app,
  // which is exactly where the row below sends anyone who hasn't set Face ID
  // up yet — so re-read on focus *and* on foreground.
  const [lockSupport, setLockSupport] = useState<AppLockSupport | null>(null);
  const refreshLockSupport = React.useCallback(() => {
    getAppLockSupport().then(setLockSupport).catch(() => setLockSupport(null));
  }, []);

  const [apiKeyDraft, setApiKeyDraft] = useState('');

  useFocusEffect(
    React.useCallback(() => {
      refreshLockSupport();
      setApiKeyDraft(useSettingsStore.getState().anthropicApiKey ?? '');
      const sub = AppState.addEventListener('change', state => {
        if (state === 'active') refreshLockSupport();
      });
      return () => sub.remove();
    }, [refreshLockSupport])
  );

  /**
   * Turning the lock on authenticates first. Two reasons, and the second is the
   * one that matters: it proves the prompt this device will show is one the
   * person holding it can actually pass, *before* anything starts depending on
   * that. Getting it wrong the other way round means a task list nobody can
   * open, and there is no recovery path — no password, no account, no server.
   *
   * Turning it off doesn't re-authenticate: whoever is looking at this screen
   * has already passed the lock to get here.
   */
  const onToggleAppLock = async (next: boolean) => {
    if (!next) {
      setAppLockEnabled(false);
      return;
    }

    const support = await getAppLockSupport();
    setLockSupport(support);
    if (support.capability === 'none' || support.capability === 'unsupported') {
      Alert.alert(
        'Nothing to unlock with',
        `Set up ${support.label} or a passcode for this device in the Settings app first — without one there'd be no way back into the app.`
      );
      return;
    }

    if ((await authenticateForAppLock('Turn on the app lock')) !== 'success') {
      Alert.alert('Not turned on', 'The app lock is still off.');
      return;
    }

    // Unlocked *first*: the lock screen is shown whenever the setting is on and
    // this session hasn't authenticated, and the prompt just passed counts.
    // Flipping the setting first would put the lock screen up on the way back
    // from the prompt that turned it on.
    useAppLockStore.getState().unlock();
    setAppLockEnabled(true);
  };

  const lockLabel = lockSupport?.label ?? 'Face ID';

  return (
    <>
      <SettingsSection
        label="App lock"
        footer={`Everything the app knows sits on this device, so an unlocked phone is the only thing between someone and your whole task list. This puts ${lockLabel} in front of it — with your device passcode as the fallback, the same as anywhere else. The grace period is there so switching to Messages and back doesn't ask again.`}
      >
        <SettingsRow
          icon={appLockEnabled ? 'lock-closed-outline' : 'lock-open-outline'}
          iconColor={appLockEnabled ? colors.accent : undefined}
          label={`Require ${lockLabel} to open`}
          hint={
            lockSupport && lockSupport.capability !== 'biometric' && !appLockEnabled
              ? lockSupport.capability === 'passcode'
                ? `No ${lockSupport.label} enrolled — the lock would ask for this device's passcode`
                : `Set up ${lockSupport.label} or a passcode in the Settings app first`
              : appLockEnabled
                ? 'Asks when you open the app, and when you come back to it'
                : 'Anyone holding an unlocked phone can read your tasks'
          }
          toggle={appLockEnabled}
          onPress={() => onToggleAppLock(!appLockEnabled)}
          tight={appLockEnabled}
        />
        {appLockEnabled && (
          <>
            <View style={styles.sep} />
            <SettingsRow
              icon="time-outline"
              label="Lock again after"
              hint={appLockGraceSeconds === 0
                ? 'Every time you leave the app, however briefly'
                : `Leaving for less than ${graceLabel(appLockGraceSeconds).toLowerCase()} comes straight back in`}
              tight
            />
            <SettingsPills
              attached
              options={GRACE_OPTIONS}
              selected={appLockGraceSeconds}
              onSelect={setAppLockGraceSeconds}
              accessibilityLabelFor={o => `Lock again after ${o.label}`}
            />
          </>
        )}
      </SettingsSection>

      <SettingsSection
        label="AI suggestions"
        footer="Get a key at console.anthropic.com. The key is kept in this device's keychain and never leaves it; using a suggestion sends that task's (or template's) title, notes, and your tag/category names to Anthropic."
      >
        <SettingsRow
          icon="sparkles-outline"
          iconColor={anthropicApiKey ? colors.purple : undefined}
          label="Anthropic API Key"
          hint="Enables auto-tag, effort, and date suggestions in the task editor, plus template drafting"
        >
          <TextInput
            style={[styles.apiKeyInput, { color: colors.text, borderBottomColor: colors.separator }]}
            value={apiKeyDraft}
            onChangeText={setApiKeyDraft}
            onFocus={() => {
              setTimeout(() => scrollRef?.current?.scrollToEnd({ animated: true }), 100);
            }}
            onBlur={() => setAnthropicApiKey(apiKeyDraft.trim())}
            placeholder="sk-ant-..."
            placeholderTextColor={colors.textTertiary}
            secureTextEntry
            autoCapitalize="none"
            autoCorrect={false}
            spellCheck={false}
            accessibilityLabel="Anthropic API key"
          />
        </SettingsRow>
      </SettingsSection>
    </>
  );
}
