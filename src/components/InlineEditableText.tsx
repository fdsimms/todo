import React, { useMemo, useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  type StyleProp, type TextStyle,
} from 'react-native';
import { useColors } from '../theme/ThemeContext';
import { spacing, radius, border, interaction, type Colors } from '../theme';
import { useRegisterPendingEdit, type PendingEdits } from '../hooks/usePendingEdits';

interface Props {
  edits: PendingEdits;
  /** Unique within the sheet — "step:3", "prep:0:title". See `PendingEdits`. */
  editKey: string;
  value: string;
  onCommit: (next: string) => void;
  /**
   * Whether committing an emptied field means anything. False (the default)
   * reverts a blank rather than saving it, which is right for a field whose
   * row can't exist without it — a step with no text, an ingredient with no
   * name. True is for a field whose blank is a real value, like an
   * ingredient's quantity ("empty when the recipe didn't say").
   */
  allowEmpty?: boolean;
  textStyle?: StyleProp<TextStyle>;
  placeholder?: string;
  accessibilityLabel: string;
  maxLength?: number;
  /** A step is a paragraph; a name is a line. Only affects the input. */
  multiline?: boolean;
  numberOfLines?: number;
}

/**
 * Tap-to-edit text, generalised out of `ExtractedIngredientRow` (#1618) so the
 * whole import review list can be corrected in place rather than only its
 * ingredient names and amounts. Same behaviour it always had: tapping the text
 * turns it into a field, blur or return commits, and an emptied field reverts
 * unless the caller says a blank means something.
 *
 * It registers its own pending draft with the sheet's `PendingEdits` registry,
 * so an edit still being typed when Add is tapped lands rather than being
 * dropped — read that hook's note for why the resolver returns a value instead
 * of committing.
 *
 * **The input never inherits `lineHeight`.** RN maps it onto iOS's paragraph
 * style with no compensating baseline offset, so the glyphs sit low in the box
 * while the caret stays centred. The caller's `textStyle` is meant to be the
 * same style the surrounding read-only text uses, and a step's does carry a
 * `lineHeight` — so this strips it and keeps the height it implied as a
 * `minHeight` instead, which is what stops the row resizing as it flips into
 * edit mode.
 */
export function InlineEditableText({
  edits, editKey, value, onCommit, allowEmpty = false, textStyle,
  placeholder, accessibilityLabel, maxLength, multiline = false, numberOfLines,
}: Props) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');

  // Mirrors commit()'s validation exactly, so what the registry reports
  // pending is precisely what a commit would have written.
  const resolvePending = (): string | null => {
    if (!editing) return null;
    const trimmed = draft.trim();
    if (!allowEmpty && !trimmed) return null;
    return trimmed === value ? null : trimmed;
  };
  useRegisterPendingEdit(edits, editKey, resolvePending);

  const commit = () => {
    // onSubmitEditing fires onBlur behind it, and unmounting the field fires
    // onBlur again — guard so one edit writes once.
    if (!editing) return;
    setEditing(false);
    const trimmed = draft.trim();
    if (!allowEmpty && !trimmed) return;
    if (trimmed === value) return;
    onCommit(trimmed);
  };

  const inputStyle = useMemo(() => {
    const flat = StyleSheet.flatten(textStyle) ?? {};
    const { lineHeight, ...rest } = flat;
    return [rest, lineHeight ? { minHeight: lineHeight } : null];
  }, [textStyle]);

  if (editing) {
    return (
      <TextInput
        style={[styles.input, inputStyle]}
        value={draft}
        onChangeText={setDraft}
        onBlur={commit}
        onSubmitEditing={commit}
        autoFocus
        selectTextOnFocus
        maxLength={maxLength}
        multiline={multiline}
        // A multiline field keeps the return key as a newline; a single-line
        // one uses it to finish, which is the only way off a field whose row
        // sits under the keyboard.
        blurOnSubmit={!multiline}
        returnKeyType={multiline ? undefined : 'done'}
        accessibilityLabel={accessibilityLabel}
      />
    );
  }

  return (
    <TouchableOpacity
      activeOpacity={interaction.activeOpacity}
      onPress={() => { setDraft(value); setEditing(true); }}
      accessibilityRole="button"
      accessibilityLabel={`Edit ${accessibilityLabel}`}
    >
      <View style={styles.readWrap}>
        <Text style={[textStyle, !value && styles.placeholder]} numberOfLines={numberOfLines}>
          {value || placeholder || ''}
        </Text>
      </View>
    </TouchableOpacity>
  );
}

function makeStyles(colors: Colors) {
  return StyleSheet.create({
    // The dashed underline is the only cue this text is tappable, since it
    // otherwise renders identically to the read-only labels around it. Only
    // paddingTop carries the 1pt readWrap used to split across top/bottom —
    // the bottom pt is now the border itself, so the total stays 2pt either
    // side of edit mode (see the comment on `input` below).
    readWrap: {
      paddingTop: 1,
      borderBottomWidth: border.sm,
      borderBottomColor: colors.separator,
      borderStyle: 'dashed',
    },
    // Padded and tinted so an open field reads as a field. The vertical
    // padding is matched by readWrap's 1pt plus the border, so flipping into
    // edit mode doesn't shift the line it's on.
    input: {
      backgroundColor: colors.bgSecondary,
      borderRadius: radius.sm,
      borderWidth: 1,
      borderColor: colors.accent,
      paddingHorizontal: spacing.xs,
      paddingVertical: 0,
      margin: 0,
    },
    placeholder: { color: colors.textTertiary },
  });
}
