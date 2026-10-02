import React, { useRef, useState } from 'react';
import { View, StyleSheet, type StyleProp, type ViewStyle } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useColors } from '../theme/ThemeContext';
import { spacing, font, radius, iconSize } from '../theme';
import { useScrollFieldIntoView } from '../hooks/useKeyboardInsetScroll';
import { TITLE_MAX_LENGTH } from '../types';
import { TextField } from './TextField';

/**
 * A one-line field that names a new thing where it's about to appear: a
 * section at the foot of a project, a stack at the end of the Stacks list.
 * The name is the only thing most new stacks need, so it's asked for in place
 * rather than in `TaskGroupEditor`, which stays one tap away on the finished
 * row for everything else.
 *
 * Return or tapping away with a name typed submits it; either with nothing
 * typed cancels. It fires one or the other exactly once, so a blur arriving
 * after Return (the field unmounting as the row appears) can't create a second.
 */
export function InlineNameField({
  placeholder,
  icon = 'layers-outline',
  onSubmit,
  onCancel,
  accessibilityLabel,
  style,
}: {
  placeholder: string;
  icon?: React.ComponentProps<typeof Ionicons>['name'];
  onSubmit: (name: string) => void;
  onCancel: () => void;
  accessibilityLabel: string;
  style?: StyleProp<ViewStyle>;
}) {
  const colors = useColors();
  const [text, setText] = useState('');
  const textRef = useRef('');
  const doneRef = useRef(false);
  const scrollIntoView = useScrollFieldIntoView();

  const finish = () => {
    if (doneRef.current) return;
    doneRef.current = true;
    const name = textRef.current.trim();
    if (name) onSubmit(name);
    else onCancel();
  };

  return (
    <View style={[styles.row, { backgroundColor: colors.bgSecondary }, style]}>
      <Ionicons name={icon} size={iconSize.sm} color={colors.textSecondary} />
      <TextField
        style={[styles.input, { color: colors.text }]}
        value={text}
        onChangeText={next => { textRef.current = next; setText(next); }}
        autoFocus
        onFocus={scrollIntoView}
        placeholder={placeholder}
        placeholderTextColor={colors.textTertiary}
        maxLength={TITLE_MAX_LENGTH}
        returnKeyType="done"
        // Held focused through Return so a field the caller opens next (a
        // section's first line) takes the keyboard over without it dropping
        // and coming back up. This one unmounts either way.
        blurOnSubmit={false}
        onSubmitEditing={finish}
        onBlur={finish}
        accessibilityLabel={accessibilityLabel}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginHorizontal: spacing.md,
    marginVertical: spacing.xxs,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
  },
  // Height rather than lineHeight, per the TextInput note in CLAUDE.md.
  input: { flex: 1, fontSize: font.md, height: 44 },
});
