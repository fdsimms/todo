import React, { useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';
import { CardSheet, useCardSheet } from './CardSheet';
import { SheetHeaderButton } from './SheetHeaderButton';
import { TextField } from './TextField';
import { useColors } from '../theme/ThemeContext';
import { font, fontWeight, radius, spacing, type Colors } from '../theme';
import { describeProduct } from '../utils/groceryProduct';
import { haptics } from '../utils/haptics';
import { BUTTON_LABEL } from '../copy/shared';

/**
 * What a label photo is about: the food, and the product of it the label is
 * printed on. The brand and variant are what make it one box rather than the
 * generic food, so the figures read off the label are filed under that product.
 */
export interface LabelSubject {
  name: string;
  brand: string | null;
  variant: string | null;
}

/** A subject with only a name, for a caller that has no brand or variant to offer. */
export function labelSubjectNamed(name: string): LabelSubject {
  return { name, brand: null, variant: null };
}

interface Props {
  visible: boolean;
  /** Prefills Food, typically whatever was typed in the search field. */
  initialName: string;
  /** Called once the card has left, with the trimmed answer. */
  onNext: (subject: LabelSubject) => void;
  onClose: () => void;
}

/**
 * "About this label": asked before the camera opens, so the nutrition facts
 * land on the right product instead of a food whose name has the brand mashed
 * into it ("Red Plate Foods Whoopie Cookies").
 *
 * A small card rather than a page sheet: three fields and one decision, and a
 * scrim tap costs only retyping them, so there is no unsaved-changes guard.
 * Nothing is written here; the catalog row and its product are made by
 * `ScanToLogFlow` only once the photographed panel is saved, so backing out of
 * the camera leaves nothing behind.
 */
export function LabelSubjectSheet({ visible, initialName, onNext, onClose }: Props) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const card = useCardSheet();

  const [name, setName] = useState('');
  const [brand, setBrand] = useState('');
  const [variant, setVariant] = useState('');
  const brandRef = useRef<TextInput>(null);
  const variantRef = useRef<TextInput>(null);

  // The sheet stays mounted across opens, so reseed on each one.
  useEffect(() => {
    if (!visible) return;
    setName(initialName);
    setBrand('');
    setVariant('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  const trimmedName = name.trim();
  const product = describeProduct({ brand: brand.trim() || null, variant: variant.trim() || null });

  const dismiss = (after: () => void) => card.close(after);
  const next = () => {
    if (!trimmedName) return;
    haptics.tap();
    const subject: LabelSubject = {
      name: trimmedName,
      brand: brand.trim() || null,
      variant: variant.trim() || null,
    };
    dismiss(() => { onClose(); onNext(subject); });
  };

  return (
    <CardSheet
      name="LabelSubjectSheet"
      visible={visible}
      controller={card}
      onRequestClose={() => dismiss(onClose)}
    >
      <View style={styles.card}>
        <View style={styles.headerRow}>
          <SheetHeaderButton label={BUTTON_LABEL.cancel} role="cancel" onPress={() => dismiss(onClose)} minWidth={56} />
          <Text style={styles.heading}>About this label</Text>
          <SheetHeaderButton
            label="Next"
            onPress={next}
            disabled={!trimmedName}
            minWidth={56}
            style={styles.headerRight}
          />
        </View>
        <Text style={styles.hint}>
          The label photo comes next. Its nutrition facts are saved for this exact product.
        </Text>

        <View style={styles.body}>
          <Text style={styles.label}>Food</Text>
          <TextField
            style={styles.input}
            value={name}
            onChangeText={setName}
            placeholder="e.g. Whoopie cookies"
            placeholderTextColor={colors.textTertiary}
            autoCapitalize="sentences"
            returnKeyType="next"
            onSubmitEditing={() => brandRef.current?.focus()}
            accessibilityLabel="Food"
          />
          <Text style={styles.label}>Brand (optional)</Text>
          <TextField
            ref={brandRef}
            style={styles.input}
            value={brand}
            onChangeText={setBrand}
            placeholder="e.g. Red Plate Foods"
            placeholderTextColor={colors.textTertiary}
            autoCapitalize="words"
            returnKeyType="next"
            onSubmitEditing={() => variantRef.current?.focus()}
            accessibilityLabel="Brand, optional"
          />
          <Text style={styles.label}>Variant (optional)</Text>
          <TextField
            ref={variantRef}
            style={styles.input}
            value={variant}
            onChangeText={setVariant}
            placeholder="e.g. chocolate, low fat"
            placeholderTextColor={colors.textTertiary}
            returnKeyType="done"
            onSubmitEditing={next}
            accessibilityLabel="Variant, optional"
          />
          {!!trimmedName && (
            <View style={styles.preview}>
              <Text style={styles.previewLabel}>Saved as</Text>
              <Text style={styles.previewText}>{product ? `${trimmedName} · ${product}` : trimmedName}</Text>
            </View>
          )}
        </View>
      </View>
    </CardSheet>
  );
}

const makeStyles = (colors: Colors) => StyleSheet.create({
  card: { paddingBottom: spacing.md },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
  },
  heading: {
    flex: 1,
    textAlign: 'center',
    color: colors.text,
    fontSize: font.lg,
    fontWeight: fontWeight.semibold,
  },
  headerRight: { textAlign: 'right' },
  hint: {
    color: colors.textSecondary,
    fontSize: font.xs,
    lineHeight: 16,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.smd,
  },
  body: { paddingHorizontal: spacing.md },
  label: {
    color: colors.textSecondary,
    fontSize: font.xs,
    fontWeight: fontWeight.semibold,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    paddingTop: spacing.md,
    paddingBottom: spacing.xsm,
  },
  input: {
    color: colors.text,
    fontSize: font.md,
    backgroundColor: colors.bgTertiary,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.smd,
    // Height rather than lineHeight, see the TextInput note in CLAUDE.md.
    minHeight: 44,
  },
  preview: {
    marginTop: spacing.md,
    padding: spacing.smd,
    borderRadius: radius.sm,
    backgroundColor: colors.bgSunken,
    gap: spacing.xxs,
  },
  previewLabel: {
    color: colors.textSecondary,
    fontSize: font.xxs,
    fontWeight: fontWeight.semibold,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
  previewText: { color: colors.text, fontSize: font.sm },
});
