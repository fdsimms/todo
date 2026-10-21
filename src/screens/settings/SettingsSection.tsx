import React, { useMemo, useState } from 'react';
import { View, Text, Animated, TouchableOpacity, type GestureResponderEvent } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useColors } from '../../theme/ThemeContext';
import { iconSize, interaction } from '../../theme';
import { haptics } from '../../utils/haptics';
import { CardSheet, type CardAnchor } from '../../components/CardSheet';
import { LazySheet } from '../../components/LazySheet';
import { useSettingsStore } from '../../store/useSettingsStore';
import { makeSettingsStyles } from './settingsStyles';
import { useSettingsFocusFlash } from './SettingsFocus';

/** The long half of a section's explanation, shown in a popover from the header's help button. */
export interface SectionExplanation {
  title: string;
  paragraphs: string[];
}

interface Props {
  /**
   * Uppercase header above the card.
   *
   * Optional for the one case where it would only restate the screen's own
   * title: a screen holding a single section (Automations). Every group
   * with two or more sections needs them all labelled, so leave it off only
   * when the header directly above is already saying it.
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
  /**
   * Explanation too long for the footer, opened from a help button at the end
   * of the header. Keep the one sentence the section can't be used without in
   * `footer` and move the rest here: a four-sentence footer under a card is
   * easy to skim past. Needs a `label`, since the button sits in that row.
   * It does not follow Settings › Hide help text, because the person asked
   * for it by tapping.
   */
  explain?: SectionExplanation;
  children: React.ReactNode;
}

export function SettingsSection({ label, entryId, footer, explain, children }: Props) {
  const colors = useColors();
  const styles = useMemo(() => makeSettingsStyles(colors), [colors]);
  const hideHelpText = useSettingsStore(s => s.hideHelpText);
  const { focused, setFocusRef, highlight } = useSettingsFocusFlash(entryId);
  const [explainOpen, setExplainOpen] = useState(false);
  const [explainAnchor, setExplainAnchor] = useState<CardAnchor | null>(null);
  const hasExplain = explain != null && label != null;

  const openExplain = (e: GestureResponderEvent) => {
    haptics.tap();
    setExplainAnchor({ x: e.nativeEvent.pageX, y: e.nativeEvent.pageY });
    setExplainOpen(true);
  };

  return (
    <View style={styles.section}>
      {label != null && (hasExplain ? (
        <View style={styles.sectionLabelRow}>
          <Text style={styles.sectionLabelInRow}>{label}</Text>
          <TouchableOpacity
            onPress={openExplain}
            activeOpacity={interaction.activeOpacity}
            hitSlop={10}
            accessibilityRole="button"
            accessibilityLabel={`About ${label}`}
          >
            <Ionicons name="help-circle-outline" size={iconSize.md} color={colors.textSecondary} />
          </TouchableOpacity>
        </View>
      ) : (
        <Text style={styles.sectionLabel}>{label}</Text>
      ))}
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
      {hasExplain && (
        <LazySheet open={explainOpen}>
          <CardSheet
            visible={explainOpen}
            onClose={() => setExplainOpen(false)}
            anchor={explainAnchor}
            popoverWidth={320}
            name="SectionExplanation"
          >
            <View style={styles.explainCard}>
              <Text style={styles.explainTitle}>{explain.title}</Text>
              {explain.paragraphs.map((p, i) => (
                <Text key={i} style={[styles.explainBody, i > 0 && styles.explainBodyNext]}>{p}</Text>
              ))}
            </View>
          </CardSheet>
        </LazySheet>
      )}
    </View>
  );
}
