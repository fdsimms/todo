import React, { useMemo } from 'react';
import { View, Text, Animated } from 'react-native';
import { useColors } from '../../theme/ThemeContext';
import { useSettingsStore } from '../../store/useSettingsStore';
import { makeSettingsStyles } from './settingsStyles';
import { useSettingsFocusFlash } from './SettingsFocus';

interface Props {
  /**
   * Uppercase header above the card.
   *
   * Optional for the one case where it would only restate the screen's own
   * title: a group holding a single section (Automatic tasks). Every group
   * with two or more sections needs them all labelled, so leave it off only
   * when the `DetailHeader` directly above is already saying it.
   */
  label?: string;
  /**
   * The section's id in `SETTINGS_ENTRIES`, for a setting whose control is the
   * whole section rather than a row in it — the theme and typeface pickers are
   * a bare `SettingsSegments` under a header, with no `SettingsRow` to carry an
   * `entryId`. Same behaviour as the row's: search scrolls to it and it lights
   * up briefly.
   *
   * Prefer the row wherever there is one. This exists so those few settings
   * aren't the only ones in the app that drop you at the top of a group.
   */
  entryId?: string;
  /**
   * The paragraph under the card. These are the screen's only real
   * documentation, so they stay — a group holds two or three sections rather
   * than eighteen, which is the room they needed.
   */
  footer?: React.ReactNode;
  children: React.ReactNode;
}

export function SettingsSection({ label, entryId, footer, children }: Props) {
  const colors = useColors();
  const styles = useMemo(() => makeSettingsStyles(colors), [colors]);
  const hideHelpText = useSettingsStore(s => s.hideHelpText);
  const { focused, setFocusRef, highlight } = useSettingsFocusFlash(entryId);

  return (
    <View style={styles.section}>
      {label != null && <Text style={styles.sectionLabel}>{label}</Text>}
      {/* The card rather than the whole section: the highlight is meant to say
          "the control is in here", and tinting the footer paragraph too makes
          it read as a warning about the text. */}
      <Animated.View
        ref={setFocusRef}
        style={[styles.card, focused && { backgroundColor: highlight }]}
      >
        {children}
      </Animated.View>
      {footer != null && !hideHelpText && <Text style={styles.sectionFooter}>{footer}</Text>}
    </View>
  );
}
