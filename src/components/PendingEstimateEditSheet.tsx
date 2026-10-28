import React, { useEffect, useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { CardSheet, useCardSheet } from './CardSheet';
import { SheetHeader } from './SheetHeader';
import { SheetHeaderButton } from './SheetHeaderButton';
import { TextField } from './TextField';
import { usePendingEstimateStore } from '../store/usePendingEstimateStore';
import { useColors } from '../theme/ThemeContext';
import { font, radius, spacing, type Colors } from '../theme';
import { haptics } from '../utils/haptics';
import type { PendingEstimate } from '../utils/estimateQueue';
import { BUTTON_LABEL } from '../copy/shared';

interface Props {
  /** The waiting or failed meal being corrected, or null while closed. */
  row: PendingEstimate | null;
  onClose: () => void;
}

/**
 * The words of a queued meal that has not been estimated yet, so a typo can be
 * fixed before the model reads it. See `rename` in `usePendingEstimateStore`.
 */
export function PendingEstimateEditSheet({ row, onClose }: Props) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const card = useCardSheet();
  const dismiss = () => card.close(onClose);
  const [text, setText] = useState('');
  const [refusal, setRefusal] = useState<string | null>(null);
  const id = row?.id ?? null;
  const description = row?.description ?? '';

  useEffect(() => {
    if (id) { setText(description); setRefusal(null); }
    // Reseed only when a different meal opens, not when the store re-sorts the same one.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const clean = text.trim();

  const save = () => {
    if (!row || !clean) return;
    if (clean === row.description) { dismiss(); return; }
    const result = usePendingEstimateStore.getState().rename(row.id, clean);
    if (result === 'duplicate') {
      haptics.warning();
      setRefusal('That meal is already waiting for the same time.');
      return;
    }
    if (result !== 'saved') {
      haptics.warning();
      setRefusal('This meal can no longer be edited.');
      return;
    }
    haptics.success();
    dismiss();
  };

  return (
    <CardSheet name="PendingEstimateEditSheet" visible={row !== null} controller={card} onRequestClose={dismiss}>
      <View style={styles.root}>
        <SheetHeader
          title="Edit meal"
          left={<SheetHeaderButton label={BUTTON_LABEL.cancel} role="cancel" onPress={dismiss} />}
          right={<SheetHeaderButton label={BUTTON_LABEL.save} disabled={!clean} onPress={save} />}
        />
        <View style={styles.body}>
          <TextField
            style={styles.input}
            value={text}
            onChangeText={t => { setText(t); setRefusal(null); }}
            placeholder="Describe the meal"
            placeholderTextColor={colors.textTertiary}
            multiline
            autoFocus
            blurOnSubmit
            returnKeyType="done"
            onSubmitEditing={save}
            accessibilityLabel="Meal description"
          />
          {refusal ? <Text style={styles.refusal}>{refusal}</Text> : null}
        </View>
      </View>
    </CardSheet>
  );
}

function makeStyles(colors: Colors) {
  return StyleSheet.create({
    root: { flexShrink: 1 },
    body: { padding: spacing.md },
    input: {
      color: colors.text, fontSize: font.md, backgroundColor: colors.bgTertiary,
      borderRadius: radius.md, paddingHorizontal: spacing.md, paddingTop: spacing.smd,
      paddingBottom: spacing.smd, minHeight: 88, textAlignVertical: 'top',
    },
    refusal: { color: colors.redText, fontSize: font.sm, marginTop: spacing.sm },
  });
}
