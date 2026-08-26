import React, { useMemo } from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useSettingsStore, type FabHand } from '../../store/useSettingsStore';
import { useColors } from '../../theme/ThemeContext';
import { interaction, type ThemeMode } from '../../theme';
import { APP_FONT_OPTIONS, resolveFontFace, type AppFont } from '../../theme/fonts';
import { useFontPreviewsLoaded } from '../../theme/AppFont';
import { SettingsSection } from './SettingsSection';
import { SettingsRow } from './SettingsRow';
import { SettingsSegments } from './SettingsSegments';
import { type SegmentOption } from '../../components/SegmentedControl';
import { makeSettingsStyles } from './settingsStyles';

const THEME_OPTIONS: SegmentOption<ThemeMode>[] = [
  { value: 'light', label: 'Light', icon: 'sunny' },
  { value: 'dark', label: 'Dark', icon: 'moon' },
  { value: 'darkPurple', label: 'Purple', icon: 'color-palette' },
  { value: 'system', label: 'System', icon: 'phone-portrait' },
];

const FAB_HAND_OPTIONS: SegmentOption<FabHand>[] = [
  { value: 'right', label: 'Right', icon: 'hand-right-outline' },
  { value: 'left', label: 'Left', icon: 'hand-left-outline' },
];

export function AppearanceSettings() {
  const themeMode = useSettingsStore(s => s.themeMode);
  const setThemeMode = useSettingsStore(s => s.setThemeMode);
  const fabHand = useSettingsStore(s => s.fabHand);
  const setFabHand = useSettingsStore(s => s.setFabHand);
  const appFont = useSettingsStore(s => s.appFont);
  const setAppFont = useSettingsStore(s => s.setAppFont);
  const appFontRandomize = useSettingsStore(s => s.appFontRandomize);
  const setAppFontRandomize = useSettingsStore(s => s.setAppFontRandomize);
  const appFontPool = useSettingsStore(s => s.appFontPool);
  const setAppFontPool = useSettingsStore(s => s.setAppFontPool);
  const hapticsEnabled = useSettingsStore(s => s.hapticsEnabled);
  const setHapticsEnabled = useSettingsStore(s => s.setHapticsEnabled);
  const shakeToUndoEnabled = useSettingsStore(s => s.shakeToUndoEnabled);
  const setShakeToUndoEnabled = useSettingsStore(s => s.setShakeToUndoEnabled);
  const confirmBeforeDeleting = useSettingsStore(s => s.confirmBeforeDeleting);
  const setConfirmBeforeDeleting = useSettingsStore(s => s.setConfirmBeforeDeleting);
  const hideHelpText = useSettingsStore(s => s.hideHelpText);
  const tipsEnabled = useSettingsStore(s => s.tipsEnabled);
  const setTipsEnabled = useSettingsStore(s => s.setTipsEnabled);
  const setHideHelpText = useSettingsStore(s => s.setHideHelpText);

  const fontPreviewsLoaded = useFontPreviewsLoaded();
  const colors = useColors();
  const styles = useMemo(() => makeSettingsStyles(colors), [colors]);

  const handleToggleRandomize = (on: boolean) => {
    // Turning it on with nothing checked would randomize over an empty pool
    // forever (pickRandomAppFont just leaves appFont where it was) — seed it
    // with the font already showing so there's something to switch away from.
    if (on && appFontPool.length === 0) setAppFontPool([appFont]);
    setAppFontRandomize(on);
  };

  const toggleAppFontInPool = (id: AppFont) => {
    setAppFontPool(
      appFontPool.includes(id) ? appFontPool.filter(f => f !== id) : [...appFontPool, id]
    );
  };

  return (
    <>
      <SettingsSection label="Theme">
        <SettingsSegments
          options={THEME_OPTIONS}
          selected={themeMode}
          onSelect={setThemeMode}
          accessibilityLabelFor={o => `${o.label} theme`}
        />
        <View style={styles.sep} />
        <SettingsRow
          icon="add-circle-outline"
          iconColor={colors.accent}
          label="Add button"
          hint="Which corner the + button rests in, on every list."
          tight
        />
        <SettingsSegments
          attached
          options={FAB_HAND_OPTIONS}
          selected={fabHand}
          onSelect={setFabHand}
          accessibilityLabelFor={o => `Add button on the ${o.label.toLowerCase()}`}
        />
      </SettingsSection>

      <SettingsSection
        label="Typeface"
        footer={
          appFontRandomize
            ? 'Picks one of the checked fonts at random every time the app cold starts.'
            : 'Changes every screen at once. These are bundled with the app, so nothing downloads.'
        }
      >
        <SettingsRow
          icon="shuffle-outline"
          iconColor={appFontRandomize ? colors.accent : undefined}
          label="Randomize"
          hint={
            appFontRandomize
              ? 'Switches to a random checked font below on each cold start'
              : 'Always use the font selected below'
          }
          toggle={appFontRandomize}
          onPress={() => handleToggleRandomize(!appFontRandomize)}
        />
        <View style={styles.sep} />
        {APP_FONT_OPTIONS.map((opt, i) => {
          const selected = appFontRandomize ? appFontPool.includes(opt.id) : appFont === opt.id;
          // Naming a family here is what stops the patched Text applying
          // the *selected* font to this row, so each option previews
          // itself. Undefined for System, which flattens over the
          // injected family and lands back on the real platform default.
          const family = fontPreviewsLoaded ? resolveFontFace(opt.id, '400') : undefined;
          return (
            <React.Fragment key={opt.id}>
              {i > 0 && <View style={styles.sep} />}
              <TouchableOpacity
                style={styles.row}
                onPress={() => (appFontRandomize ? toggleAppFontInPool(opt.id) : setAppFont(opt.id))}
                activeOpacity={interaction.activeOpacity}
                accessibilityRole={appFontRandomize ? 'checkbox' : 'radio'}
                accessibilityState={appFontRandomize ? { checked: selected } : { selected }}
                accessibilityLabel={`${opt.label} typeface`}
              >
                <Text
                  style={[styles.fontSample, selected && styles.fontSampleActive, { fontFamily: family }]}
                >
                  Aa
                </Text>
                <View style={styles.rowContent}>
                  <Text
                    style={[styles.fontName, selected && styles.fontNameActive, { fontFamily: family }]}
                  >
                    {opt.label}
                  </Text>
                  <Text style={styles.rowHint}>{opt.hint}</Text>
                </View>
                {appFontRandomize ? (
                  <Ionicons
                    name={selected ? 'checkbox' : 'square-outline'}
                    size={18}
                    color={selected ? colors.accent : colors.textTertiary}
                  />
                ) : (
                  selected && <Ionicons name="checkmark" size={18} color={colors.accent} />
                )}
              </TouchableOpacity>
            </React.Fragment>
          );
        })}
      </SettingsSection>

      <SettingsSection label="Feedback">
        <SettingsRow
          icon="phone-portrait-outline"
          iconColor={hapticsEnabled ? colors.accent : undefined}
          label="Haptic feedback"
          hint={hapticsEnabled
            ? 'The phone taps back on completions, drags and swipes'
            : 'Nothing in the app vibrates'}
          toggle={hapticsEnabled}
          onPress={() => setHapticsEnabled(!hapticsEnabled)}
        />
        <View style={styles.sep} />
        <SettingsRow
          icon="phone-portrait-outline"
          iconColor={shakeToUndoEnabled ? colors.accent : undefined}
          label="Shake to undo"
          hint={shakeToUndoEnabled
            ? 'Shake your phone right after completing, deleting or rescheduling to undo it'
            : 'Shaking your phone does nothing'}
          toggle={shakeToUndoEnabled}
          onPress={() => setShakeToUndoEnabled(!shakeToUndoEnabled)}
        />
        <View style={styles.sep} />
        <SettingsRow
          icon="trash-outline"
          iconColor={confirmBeforeDeleting ? colors.accent : undefined}
          label="Confirm before deleting"
          hint={confirmBeforeDeleting
            ? 'Shows an alert before deleting a recipe, template, tag, category, or clearing a list'
            : 'Deletes immediately, without asking first'}
          toggle={confirmBeforeDeleting}
          onPress={() => setConfirmBeforeDeleting(!confirmBeforeDeleting)}
        />
        <View style={styles.sep} />
        <SettingsRow
          icon="information-circle-outline"
          iconColor={hideHelpText ? colors.accent : undefined}
          label="Hide help text"
          hint={hideHelpText
            ? 'Settings and editor fields show only their labels'
            : 'Settings and editor fields show a line explaining what they do'}
          toggle={hideHelpText}
          onPress={() => setHideHelpText(!hideHelpText)}
        />
        <View style={styles.sep} />
        <SettingsRow
          icon="bulb-outline"
          iconColor={tipsEnabled ? colors.accent : undefined}
          label="Tips"
          hint={tipsEnabled
            ? 'Shows one tip a day on the screen it applies to, until you have seen them all'
            : 'Never shows a tip on its own. The Tips screen still lists all of them'}
          toggle={tipsEnabled}
          onPress={() => setTipsEnabled(!tipsEnabled)}
        />
      </SettingsSection>
    </>
  );
}
