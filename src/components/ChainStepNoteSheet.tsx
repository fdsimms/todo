import React, { useEffect, useMemo, useState } from 'react';
import { Keyboard, StyleSheet, Text, View } from 'react-native';
import { CardSheet, useCardSheet } from './CardSheet';
import type { ChainItem } from '../types';
import { useColors } from '../theme/ThemeContext';
import { spacing, radius, font, fontWeight, type Colors } from '../theme';
import { haptics } from '../utils/haptics';
import { SheetHeaderButton } from './SheetHeaderButton';
import { TextField } from './TextField';
import { BUTTON_LABEL } from '../copy/shared';

interface Props {
  visible: boolean;
  /** The step being edited; its title is the sheet's subject. */
  step: Pick<ChainItem, 'id' | 'title' | 'notes'> | null;
  /** Applies the step's new note. `onClose` follows it. */
  onSave: (patch: Pick<ChainItem, 'notes'>) => void;
  onClose: () => void;
}

/**
 * A note for one chain step (see `ChainItem.notes`). A sheet rather than a
 * field on the row, for the reason `ChainStepLinkSheet` gives: the row lives
 * in a `SortableList`, and a control that grows in place changes the row's
 * height mid-drag. Shared by the task editor and the template item editor.
 */
export function ChainStepNoteSheet({ visible, step, onSave, onClose }: Props) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const card = useCardSheet();
  const [text, setText] = useState('');

  useEffect(() => {
    if (!visible) return;
    setText(step?.notes ?? '');
  }, [visible, step?.id]);

  const dismiss = (after: () => void) => {
    Keyboard.dismiss();
    card.close(after);
  };

  const save = () => {
    haptics.success();
    const trimmed = text.trim();
    dismiss(() => { onSave({ notes: trimmed || null }); onClose(); });
  };

  return (
    <CardSheet
      name="ChainStepNoteSheet"
      visible={visible}
      controller={card}
      onRequestClose={() => dismiss(onClose)}
    >
      <View style={styles.card}>
        <View style={styles.headerRow}>
          <SheetHeaderButton label="Clear" role="cancel" onPress={() => setText('')} minWidth={56} />
          <Text style={styles.heading} numberOfLines={2}>{step?.title ?? 'Step'}</Text>
          <SheetHeaderButton label={BUTTON_LABEL.done} onPress={save} minWidth={56} style={styles.headerRight} />
        </View>
        <Text style={styles.label}>Note</Text>
        <View style={styles.body}>
          <TextField
            style={styles.input}
            value={text}
            onChangeText={setText}
            placeholder="e.g. Bring cash"
            placeholderTextColor={colors.textTertiary}
            multiline
            autoFocus
            textAlignVertical="top"
            accessibilityLabel="Note for this step"
          />
        </View>
      </View>
    </CardSheet>
  );
}

const makeStyles = (colors: Colors) => StyleSheet.create({
  card: { paddingBottom: spacing.md },
  headerRow: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    paddingHorizontal: spacing.md, paddingTop: spacing.md,
  },
  heading: {
    flex: 1, textAlign: 'center', color: colors.text,
    fontSize: font.lg, fontWeight: fontWeight.semibold,
  },
  headerRight: { textAlign: 'right' },
  label: {
    color: colors.textSecondary, fontSize: font.xs, fontWeight: fontWeight.semibold,
    letterSpacing: 0.8, textTransform: 'uppercase',
    paddingHorizontal: spacing.md, paddingTop: spacing.md, paddingBottom: spacing.sm,
  },
  body: { paddingHorizontal: spacing.md },
  input: {
    backgroundColor: colors.bgTertiary, borderRadius: radius.sm,
    paddingHorizontal: spacing.smd, paddingVertical: spacing.sm,
    minHeight: 96, color: colors.text, fontSize: font.md,
  },
});
