import React, { useMemo } from 'react';
import { StyleSheet, Text, TouchableOpacity, type StyleProp, type TextStyle } from 'react-native';
import { useColors } from '../theme/ThemeContext';
import { font, fontWeight, interaction, type Colors } from '../theme';
import { haptics } from '../utils/haptics';

interface Props {
  label: string;
  onPress: () => void;
  /**
   * `confirm` is the action that commits the sheet (Save / Done / Add) and is
   * set in semibold; `cancel` is the way out and keeps regular weight. Both are
   * accent-coloured — weight is what ranks them, the way iOS ranks nav-bar
   * buttons.
   */
  role?: 'confirm' | 'cancel';
  disabled?: boolean;
  accessibilityLabel?: string;
  /**
   * Reserves a matching width on the light side of the header so the title
   * stays optically centered when the two buttons have different labels.
   */
  minWidth?: number;
  style?: StyleProp<TextStyle>;
}

/**
 * The bare accent-text button in a sheet header — Cancel, Save, Done, Add.
 *
 * This is one of the two places bare accent text survives (the other is the
 * current-value summary in `EditorRow` / `CollapsibleField`); everywhere else
 * an action gets a shape, see `InlineAction`. It exists as a component because
 * the same button had been written out in twelve files, in three sizes, and
 * two of them had drifted to a grey Cancel while the other ten were accent.
 */
export function SheetHeaderButton({
  label,
  onPress,
  role = 'confirm',
  disabled = false,
  accessibilityLabel,
  minWidth,
  style,
}: Props) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  // A disabled button still takes the press, to say no: a Save that does
  // nothing when tapped reads as the app not noticing. It never calls onPress,
  // and it doesn't dim on press, since nothing happened.
  return (
    <TouchableOpacity
      onPress={disabled ? refuse : onPress}
      hitSlop={8}
      activeOpacity={disabled ? 1 : interaction.activeOpacity}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ disabled }}
    >
      <Text
        style={[
          styles.label,
          role === 'confirm' && styles.confirm,
          minWidth !== undefined && { minWidth, textAlign: role === 'confirm' ? 'right' : 'left' },
          disabled && styles.disabled,
          style,
        ]}
      >
        {label}
      </Text>
    </TouchableOpacity>
  );
}

function refuse() {
  haptics.error();
}

const makeStyles = (colors: Colors) => StyleSheet.create({
  label: { color: colors.accentText, fontSize: font.md },
  confirm: { fontWeight: fontWeight.semibold },
  disabled: { opacity: 0.4 },
});
