import React, { useState, useMemo } from 'react';
import { View, TextInput, Alert, AppState, type ScrollView } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { dbClearGtinLookups, dbCountGtinLookups } from '../../db/database';
import { useSettingsStore } from '../../store/useSettingsStore';
import { useAppLockStore } from '../../store/useAppLockStore';
import { APP_LOCK_GRACE_OPTIONS, graceLabel } from '../../utils/appLock';
import { authenticateForAppLock, getAppLockSupport, type AppLockSupport } from '../../utils/appLockAuth';
import { useColors } from '../../theme/ThemeContext';
import { SettingsSection } from './SettingsSection';
import { SettingsRow } from './SettingsRow';
import { SettingsSegments } from './SettingsSegments';
import { type SegmentOption } from '../../components/SegmentedControl';
import { makeSettingsStyles } from './settingsStyles';
import { AI_MODEL_OPTIONS, aiFeaturesFor } from '../../utils/aiFeatures';

interface Props {
  /** The host screen's scroll view, so focusing the key field can reveal it. */
  scrollRef?: React.RefObject<ScrollView | null>;
}

const GRACE_OPTIONS: SegmentOption<number>[] =
  APP_LOCK_GRACE_OPTIONS.map(o => ({ value: o.value, label: o.label }));

export function PrivacyAiSettings({ scrollRef }: Props) {
  const appLockEnabled = useSettingsStore(s => s.appLockEnabled);
  const setAppLockEnabled = useSettingsStore(s => s.setAppLockEnabled);
  const appLockGraceSeconds = useSettingsStore(s => s.appLockGraceSeconds);
  const setAppLockGraceSeconds = useSettingsStore(s => s.setAppLockGraceSeconds);
  const anthropicApiKey = useSettingsStore(s => s.anthropicApiKey);
  const setAnthropicApiKey = useSettingsStore(s => s.setAnthropicApiKey);
  const kitchenEnabled = useSettingsStore(s => s.kitchenEnabled);
  const simpleMode = useSettingsStore(s => s.simpleMode);
  const productLookupEnabled = useSettingsStore(s => s.productLookupEnabled);
  const setProductLookupEnabled = useSettingsStore(s => s.setProductLookupEnabled);
  const fdcApiKey = useSettingsStore(s => s.fdcApiKey);
  const setFdcApiKey = useSettingsStore(s => s.setFdcApiKey);
  const goUpcApiKey = useSettingsStore(s => s.goUpcApiKey);
  const setGoUpcApiKey = useSettingsStore(s => s.setGoUpcApiKey);
  const aiFeatureConfig = useSettingsStore(s => s.aiFeatureConfig);
  const setAiFeatureConfig = useSettingsStore(s => s.setAiFeatureConfig);

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
  const [fdcDraft, setFdcDraft] = useState('');
  const [goUpcDraft, setGoUpcDraft] = useState('');
  /**
   * Read on focus rather than held in a store: nothing else renders this, and a
   * cache that grows on every scan would otherwise need a subscription to a
   * table deliberately kept out of state — see dbGetGtinLookup's note.
   */
  const [cachedBarcodes, setCachedBarcodes] = useState(0);

  /**
   * Confirmed, but lightly. Nothing is lost that can't be fetched again, so the
   * alert is here to catch a mis-tap rather than to guard anything: the cost of
   * clearing is one request per barcode, next time each is scanned.
   */
  const confirmClearBarcodes = React.useCallback(() => {
    Alert.alert(
      'Forget saved barcodes?',
      'Every barcode gets looked up again the next time you scan it. Nothing on your list or in your pantry changes.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Forget',
          style: 'destructive',
          onPress: () => {
            dbClearGtinLookups();
            setCachedBarcodes(0);
          },
        },
      ]
    );
  }, []);

  useFocusEffect(
    React.useCallback(() => {
      refreshLockSupport();
      setApiKeyDraft(useSettingsStore.getState().anthropicApiKey ?? '');
      setFdcDraft(useSettingsStore.getState().fdcApiKey ?? '');
      setGoUpcDraft(useSettingsStore.getState().goUpcApiKey ?? '');
      setCachedBarcodes(dbCountGtinLookups());
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
        `Set up ${support.label} or a passcode for this device in the Settings app first. Without one there'd be no way back into the app.`
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
        footer={`Everything the app knows sits on this device, so an unlocked phone is the only thing between someone and your whole task list. This puts ${lockLabel} in front of it, with your device passcode as the fallback, the same as anywhere else. The grace period is there so switching to Messages and back doesn't ask again.`}
      >
        <SettingsRow
          icon={appLockEnabled ? 'lock-closed-outline' : 'lock-open-outline'}
          iconColor={appLockEnabled ? colors.accent : undefined}
          label={`Require ${lockLabel} to open`}
          hint={
            lockSupport && lockSupport.capability !== 'biometric' && !appLockEnabled
              ? lockSupport.capability === 'passcode'
                ? `No ${lockSupport.label} enrolled. The lock would ask for this device's passcode`
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
            <SettingsSegments
              attached
              columns={2}
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
          hint="Required for any of the features below to work"
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

      <SettingsSection
        label="AI features"
        footer="Turn any of these off if you'd rather they never call out to Anthropic, or pick a different model per feature: a faster, cheaper model for quick suggestions, or a stronger one where it's worth the extra cost."
      >
        {aiFeaturesFor(kitchenEnabled, simpleMode).map((feature, i) => {
          const config = aiFeatureConfig[feature.id];
          return (
            <React.Fragment key={feature.id}>
              {i > 0 && <View style={styles.sep} />}
              <SettingsRow
                icon="sparkles-outline"
                iconColor={config.enabled ? colors.purple : undefined}
                label={feature.label}
                hint={feature.hint}
                toggle={config.enabled}
                onPress={() => setAiFeatureConfig(feature.id, { enabled: !config.enabled })}
                tight={config.enabled}
              />
              {config.enabled && (
                <SettingsSegments
                  attached
                  options={AI_MODEL_OPTIONS}
                  selected={config.model}
                  onSelect={model => setAiFeatureConfig(feature.id, { model })}
                  accessibilityLabelFor={o => `${feature.label} model: ${o.label}`}
                />
              )}
            </React.Fragment>
          );
        })}
      </SettingsSection>

      {/* Its own section rather than a row among the AI features, because it is
          not one: no Anthropic key, no model to pick, and a different service
          on the other end. Gated on the groceries area for the same reason the
          kitchen AI features are — it is only reachable from the scanner, and
          on simplified mode for the same reason again (the scanner is gone). */}
      {kitchenEnabled && !simpleMode && (
        <SettingsSection
          label="Barcode lookups"
          footer="Open Food Facts is a free product database run by volunteers, and needs no key. Scanning sends one barcode at a time and nothing else, with no account and no identifier attached. Answers are saved on this device, so a barcode is only looked up once. Turning this off still uses the barcodes already saved here. The two keys below are optional and add more places to look."
        >
          <SettingsRow
            icon="barcode-outline"
            iconColor={productLookupEnabled ? colors.accent : undefined}
            label="Look up scanned barcodes"
            hint="Finds out what a barcode is so a scanned item arrives named."
            toggle={productLookupEnabled}
            onPress={() => setProductLookupEnabled(!productLookupEnabled)}
            accessibilityLabel="Look up scanned barcodes"
          />
          {/* Only while lookups are on: a key for a service that isn't being
              called is a field that can't do anything. */}
          {productLookupEnabled && (
            <>
              <View style={styles.sep} />
              <SettingsRow
                icon="key-outline"
                iconColor={fdcApiKey ? colors.accent : undefined}
                label="FoodData Central key"
                hint="Optional. The USDA's own database of US branded foods, asked first when set."
              >
                <TextInput
                  style={[styles.apiKeyInput, { color: colors.text, borderBottomColor: colors.separator }]}
                  value={fdcDraft}
                  onChangeText={setFdcDraft}
                  onBlur={() => setFdcApiKey(fdcDraft.trim())}
                  placeholder="e.g. a1b2c3..."
                  placeholderTextColor={colors.textTertiary}
                  secureTextEntry
                  autoCapitalize="none"
                  autoCorrect={false}
                  spellCheck={false}
                  accessibilityLabel="FoodData Central API key"
                />
              </SettingsRow>
              <View style={styles.sep} />
              <SettingsRow
                icon="key-outline"
                iconColor={goUpcApiKey ? colors.accent : undefined}
                label="Go-UPC key"
                hint="Optional and paid. Asked only for barcodes the two free databases don't know."
              >
                <TextInput
                  style={[styles.apiKeyInput, { color: colors.text, borderBottomColor: colors.separator }]}
                  value={goUpcDraft}
                  onChangeText={setGoUpcDraft}
                  onBlur={() => setGoUpcApiKey(goUpcDraft.trim())}
                  placeholder="e.g. a1b2c3..."
                  placeholderTextColor={colors.textTertiary}
                  secureTextEntry
                  autoCapitalize="none"
                  autoCorrect={false}
                  spellCheck={false}
                  accessibilityLabel="Go-UPC API key"
                />
              </SettingsRow>
            </>
          )}
          {/* Shown whether or not lookups are on, because the reason to reach
              for it is that something already saved is wrong, and switching
              lookups off doesn't stop those answers being used. */}
          {cachedBarcodes > 0 && (
            <>
              <View style={styles.sep} />
              <SettingsRow
                icon="refresh-outline"
                label="Forget saved barcodes"
                hint={`${cachedBarcodes.toLocaleString()} saved on this device. Clear them to look everything up fresh.`}
                onPress={confirmClearBarcodes}
                accessibilityLabel="Forget saved barcodes"
              />
            </>
          )}
        </SettingsSection>
      )}
    </>
  );
}
