import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, TextInput, StyleSheet, Alert } from 'react-native';
import { SheetModal } from './SheetModal';
import { SheetHeader } from './SheetHeader';
import { SheetHeaderButton } from './SheetHeaderButton';
import { useColors } from '../theme/ThemeContext';
import { spacing, radius, font, fontWeight, type Colors } from '../theme';
import { parseGuestNames } from '../utils/rsvp';
import { RSVP_OPTIONS, parseDeliverableOptions } from '../utils/deliverables';
import { haptics } from '../utils/haptics';

interface Props {
  visible: boolean;
  onClose: () => void;
  /** Called with the names and the options each is asked, then the sheet closes. */
  onAdd: (names: string[], options: string[]) => void;
}

/**
 * "Track replies": paste a guest list, get one task per guest asking Yes / No
 * / Maybe when it's ticked off. The project page counts the answers (see
 * `projectAnswerTallies`). The options are editable, since "Chicken, Fish,
 * Vegetarian" for a dinner is the same shape.
 */
export function AddGuestsSheet({ visible, onClose, onAdd }: Props) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const defaultOptions = RSVP_OPTIONS.join(', ');
  const [names, setNames] = useState('');
  const [options, setOptions] = useState(defaultOptions);

  useEffect(() => {
    if (visible) { setNames(''); setOptions(defaultOptions); }
  }, [visible]);

  const parsedNames = parseGuestNames(names);
  const parsedOptions = parseDeliverableOptions(options);
  const canAdd = parsedNames.length > 0 && parsedOptions.length >= 2;

  const add = () => {
    if (!canAdd) return;
    haptics.success();
    onAdd(parsedNames, parsedOptions);
    onClose();
  };

  // The typed names are staged until Add, so a swipe-down asks first (the
  // pageSheet rule in CLAUDE.md).
  const handleCancel = () => {
    if (!names.trim() && options === defaultOptions) { onClose(); return; }
    Alert.alert(
      'Discard changes?',
      'You have unsaved changes. Are you sure you want to discard them?',
      [
        { text: 'Keep editing', style: 'cancel' },
        { text: 'Discard', style: 'destructive', onPress: onClose },
      ],
    );
  };

  return (
    <SheetModal
      name="AddGuestsSheet"
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={handleCancel}
    >
      <View style={styles.root}>
        <SheetHeader
          title="Track replies"
          left={<SheetHeaderButton label="Cancel" role="cancel" onPress={handleCancel} minWidth={64} />}
          right={
            <SheetHeaderButton
              label={parsedNames.length > 1 ? `Add ${parsedNames.length}` : 'Add'}
              onPress={add}
              disabled={!canAdd}
              minWidth={64}
            />
          }
        />
        <View style={styles.body}>
          <Text style={styles.label}>Names</Text>
          <TextInput
            style={[styles.input, styles.names]}
            value={names}
            onChangeText={setNames}
            placeholder="One per line"
            placeholderTextColor={colors.textTertiary}
            multiline
            autoFocus
            accessibilityLabel="Names, one per line"
          />
          <Text style={styles.label}>Ask each one</Text>
          <TextInput
            style={styles.input}
            value={options}
            onChangeText={setOptions}
            placeholder="e.g. Yes, No, Maybe"
            placeholderTextColor={colors.textTertiary}
            returnKeyType="done"
            accessibilityLabel="The answers to pick from, separated by commas"
          />
          <Text style={styles.hint}>
            Adds a task for each name. Checking one off asks for their answer, and the project page counts them.
          </Text>
        </View>
      </View>
    </SheetModal>
  );
}

const makeStyles = (colors: Colors) => StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  body: { padding: spacing.md, gap: spacing.sm },
  label: {
    color: colors.textSecondary,
    fontSize: font.xs,
    fontWeight: fontWeight.semibold,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    marginTop: spacing.sm,
  },
  input: {
    backgroundColor: colors.bgSecondary,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.smd,
    color: colors.text,
    fontSize: font.md,
    minHeight: 48,
  },
  names: { minHeight: 160, textAlignVertical: 'top' },
  hint: { color: colors.textSecondary, fontSize: font.xs, marginTop: spacing.xs },
});
