import React, { useMemo } from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useSettingsStore, type FabHand } from '../../store/useSettingsStore';
import { useColors } from '../../theme/ThemeContext';
import { interaction, type ThemeMode } from '../../theme';
import { APP_FONT_OPTIONS, resolveFontFace } from '../../theme/fonts';
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
  const hapticsEnabled = useSettingsStore(s => s.hapticsEnabled);
  const setHapticsEnabled = useSettingsStore(s => s.setHapticsEnabled);
  const shakeToUndoEnabled = useSettingsStore(s => s.shakeToUndoEnabled);
  const setShakeToUndoEnabled = useSettingsStore(s => s.setShakeToUndoEnabled);
  const confirmBeforeDeleting = useSettingsStore(s => s.confirmBeforeDeleting);
  const setConfirmBeforeDeleting = useSettingsStore(s => s.setConfirmBeforeDeleting);

  const fontPreviewsLoaded = useFontPreviewsLoaded();
  const colors = useColors();
  const styles = useMemo(() => makeSettingsStyles(colors), [colors]);

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
          hint="Which corner the + button rests in, on every list"
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
        footer="Changes every screen at once. These all ship with the OS, so nothing downloads."
      >
        {APP_FONT_OPTIONS.map((opt, i) => {
          const selected = appFont === opt.id;
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
                onPress={() => setAppFont(opt.id)}
                activeOpacity={interaction.activeOpacity}
                accessibilityRole="radio"
                accessibilityState={{ selected }}
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
                {selected && <Ionicons name="checkmark" size={18} color={colors.accent} />}
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
      </SettingsSection>
    </>
  );
}
