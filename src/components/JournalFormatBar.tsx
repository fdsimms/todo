import React from 'react';
import { Keyboard, Platform, StyleSheet, Text, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { PressableScale } from './PressableScale';
import { useColors } from '../theme/ThemeContext';
import { useKeyboardHeight } from '../hooks/useKeyboardHeight';
import { spacing, radius, font, fontWeight, iconSize, type Colors } from '../theme';
import type { LineFormat } from '../utils/journalMarkdown';

export type FormatAction = { wrap: '**' | '*' } | { line: LineFormat };

interface Props {
  /** Whether the journal field has focus. A floating bar has no native tie to it. */
  focused: boolean;
  onFormat: (action: FormatAction) => void;
}

interface ButtonDef {
  action: FormatAction;
  label: string;
  glyph?: string;
  icon?: React.ComponentProps<typeof Ionicons>['name'];
  /** How the glyph is drawn, so B reads bold and I reads italic. */
  glyphStyle?: 'bold' | 'italic';
}

const BUTTONS: ButtonDef[] = [
  { action: { wrap: '**' }, label: 'Bold', glyph: 'B', glyphStyle: 'bold' },
  { action: { wrap: '*' }, label: 'Italic', glyph: 'I', glyphStyle: 'italic' },
  { action: { line: 'heading' }, label: 'Heading', glyph: 'H', glyphStyle: 'bold' },
  { action: { line: 'bullet' }, label: 'Bulleted list', icon: 'list-outline' },
  { action: { line: 'numbered' }, label: 'Numbered list', glyph: '1.' },
  { action: { line: 'quote' }, label: 'Quote', glyph: '“' },
];

/**
 * Formatting buttons above the keyboard for a journal entry — see
 * `toggleWrap`/`toggleLinePrefix` in `journalMarkdown.ts` for what each does
 * to the text. They type the Markdown markers for you; the field still shows
 * the markers, and the entry is drawn formatted when read back.
 *
 * Floating, the way `TitleTokenAccessory`'s floating mode is, because the
 * journal field is multiline and a real `InputAccessoryView` never attaches to
 * one. Render it in an `EditorSheet`'s `footer`, where it is positioned
 * against the full-screen sheet. The buttons share the row equally rather than
 * taking the token bar's 44pt minimum each: seven at that width don't fit a
 * phone.
 */
export function JournalFormatBar({ focused, onFormat }: Props) {
  const colors = useColors();
  const keyboardHeight = useKeyboardHeight(focused);
  if (Platform.OS !== 'ios' || !focused || keyboardHeight <= 0) return null;
  const styles = makeStyles(colors);

  return (
    <View style={[styles.floatingWrap, { bottom: keyboardHeight }]}>
      <View style={styles.bar}>
        {BUTTONS.map(button => (
          <PressableScale
            key={button.label}
            style={styles.btn}
            haptic
            onPress={() => onFormat(button.action)}
            accessibilityLabel={button.label}
          >
            {button.icon ? (
              <Ionicons name={button.icon} size={iconSize.md} color={colors.text} />
            ) : (
              <Text
                style={[
                  styles.glyph,
                  button.glyphStyle === 'bold' && styles.bold,
                  button.glyphStyle === 'italic' && styles.italic,
                ]}
              >
                {button.glyph}
              </Text>
            )}
          </PressableScale>
        ))}
        <PressableScale
          style={styles.btn}
          haptic
          onPress={() => Keyboard.dismiss()}
          accessibilityLabel="Hide keyboard"
        >
          <Ionicons name="chevron-down" size={iconSize.md} color={colors.text} />
        </PressableScale>
      </View>
      {/* The keyboard's top corners are rounded; paint behind them as
          TitleTokenAccessory's floating bar does. */}
      <View style={styles.cornerFill} />
    </View>
  );
}

const makeStyles = (colors: Colors) => StyleSheet.create({
  floatingWrap: { position: 'absolute', left: 0, right: 0 },
  cornerFill: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: '100%',
    height: radius.lg,
    backgroundColor: colors.bgSecondary,
  },
  bar: {
    flexDirection: 'row',
    gap: spacing.xs,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.sm,
    backgroundColor: colors.bgSecondary,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.separator,
  },
  btn: {
    flex: 1,
    minHeight: 40,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.md,
    backgroundColor: colors.bgTertiary,
  },
  glyph: { fontSize: font.lg, color: colors.text },
  bold: { fontWeight: fontWeight.bold },
  italic: { fontStyle: 'italic' },
});
