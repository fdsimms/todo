import React, { useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Ionicons from '@expo/vector-icons/Ionicons';
import { SheetModal } from './SheetModal';
import { SheetHeader } from './SheetHeader';
import { SheetHeaderButton } from './SheetHeaderButton';
import { SegmentedControl, type SegmentOption } from './SegmentedControl';
import { TextField } from './TextField';
import { HelpText } from './HelpText';
import { useRecipeStore } from '../store/useRecipeStore';
import { useKeyboardInsetScroll } from '../hooks/useKeyboardInsetScroll';
import { useColors } from '../theme/ThemeContext';
import { spacing, radius, font, fontWeight, iconSize, interaction, type Colors } from '../theme';
import { haptics } from '../utils/haptics';
import { confirmDiscard } from '../utils/confirmDiscard';
import { FOOD_KINDS, FOOD_KIND_LABELS } from '../utils/foodKinds';
import { RECIPE_BLANK_LABEL_MAX_LENGTH } from '../utils/recipeBlanks';
import { GROCERY_QUANTITY_MAX_LENGTH, type FoodKind } from '../types';
import { BUTTON_LABEL } from '../copy/shared';

interface Props {
  visible: boolean;
  recipeId: string;
  /** The blank being edited, or null to add one. */
  blankId: string | null;
  onClose: () => void;
}

type KindChoice = FoodKind | 'options';
type CountChoice = '1' | '2' | '3' | 'any';

const KIND_OPTIONS: SegmentOption<KindChoice>[] = [
  ...FOOD_KINDS.map(kind => ({ value: kind, label: FOOD_KIND_LABELS[kind] })),
  { value: 'options', label: 'Only my suggestions' },
];

const COUNT_OPTIONS: SegmentOption<CountChoice>[] = [
  { value: '1', label: 'One' },
  { value: '2', label: 'Up to 2' },
  { value: '3', label: 'Up to 3' },
  { value: 'any', label: 'Any' },
];

const countToMax = (count: CountChoice): number | null => (count === 'any' ? null : Number(count));
const maxToCount = (max: number | null): CountChoice =>
  max === null ? 'any' : max <= 1 ? '1' : max === 2 ? '2' : '3';

/** "feta, goat cheese" into names, dropping blanks. */
const splitOptions = (text: string): string[] => text.split(',').map(s => s.trim()).filter(Boolean);

/**
 * Adds or edits one of a recipe's blanks (`RecipeBlank`): the kind of food that
 * fills it, how many things may, the amount they share, and any suggestions
 * the recipe always offers.
 *
 * Staged and saved on Save, so it carries the `handleCancel` discard guard every
 * pageSheet holding typed state does.
 */
export function BlankEditorSheet({ visible, recipeId, blankId, onClose }: Props) {
  const insets = useSafeAreaInsets();
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const keyboardScroll = useKeyboardInsetScroll<ScrollView>({ ownsSheet: true });

  const blank = useRecipeStore(s => (blankId ? s.recipeById(recipeId)?.blanks?.find(b => b.id === blankId) : undefined));
  const addBlank = useRecipeStore(s => s.addBlank);
  const updateBlank = useRecipeStore(s => s.updateBlank);
  const removeBlank = useRecipeStore(s => s.removeBlank);

  const [kind, setKind] = useState<KindChoice>('vegetable');
  const [count, setCount] = useState<CountChoice>('any');
  const [quantity, setQuantity] = useState('');
  const [label, setLabel] = useState('');
  const [options, setOptions] = useState('');
  const opened = useRef({ kind: 'vegetable' as KindChoice, count: 'any' as CountChoice, quantity: '', label: '', options: '' });

  useEffect(() => {
    if (!visible) return;
    const seed = {
      kind: (blank ? blank.kind ?? 'options' : 'vegetable') as KindChoice,
      count: blank ? maxToCount(blank.max) : 'any' as CountChoice,
      quantity: blank?.quantity ?? '',
      // A label that is only the kind's own name reads back empty, so changing
      // the kind changes the heading with it.
      label: blank && (!blank.kind || blank.label !== FOOD_KIND_LABELS[blank.kind]) ? blank.label : '',
      options: blank?.options.join(', ') ?? '',
    };
    opened.current = seed;
    setKind(seed.kind);
    setCount(seed.count);
    setQuantity(seed.quantity);
    setLabel(seed.label);
    setOptions(seed.options);
    // Seeded on the open only: re-seeding on a store write would stomp what's being typed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, blankId]);

  const dirty = kind !== opened.current.kind
    || count !== opened.current.count
    || quantity !== opened.current.quantity
    || label !== opened.current.label
    || options !== opened.current.options;

  const handleCancel = () => {
    if (!dirty) { onClose(); return; }
    confirmDiscard(onClose);
  };

  const fieldKind = kind === 'options' ? null : kind;
  const optionNames = splitOptions(options);
  // A blank filled only from suggestions has nothing to offer without one, and
  // one with no kind has no heading to fall back to without a label.
  const canSave = fieldKind !== null || (optionNames.length > 0 && label.trim() !== '');

  const handleSave = () => {
    if (!canSave) return;
    const fields = { label, kind: fieldKind, max: countToMax(count), quantity, options: optionNames };
    if (blankId) updateBlank(recipeId, blankId, fields);
    else addBlank(recipeId, fields);
    haptics.success();
    onClose();
  };

  const handleDelete = () => {
    if (!blankId) return;
    haptics.warning();
    removeBlank(recipeId, blankId);
    onClose();
  };

  return (
    <SheetModal
      name="BlankEditorSheet"
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={handleCancel}
    >
      <View style={[styles.root, { paddingTop: spacing.md }]}>
        <SheetHeader
          title={blankId ? 'Edit blank' : 'Add a blank'}
          left={<SheetHeaderButton label={BUTTON_LABEL.cancel} role="cancel" onPress={handleCancel} />}
          right={<SheetHeaderButton label={BUTTON_LABEL.save} onPress={handleSave} disabled={!canSave} />}
        />
        <ScrollView
          ref={keyboardScroll.ref}
          style={styles.scroll}
          contentContainerStyle={[styles.body, { paddingBottom: insets.bottom + spacing.xl }]}
          keyboardShouldPersistTaps="handled"
          {...keyboardScroll.props}
        >
          {/* Said here rather than on the recipe page, where it used to head a
              section of its own: that page now shows only an "Add a blank"
              button, and this is where the button lands. */}
          {!blankId && (
            <HelpText style={[styles.hint, styles.intro]}>
              For a dish you make with whatever’s around, like a grain bowl. A blank names a
              kind of food, like a grain or any vegetables, and each time you plan the recipe
              you pick what fills it from your kitchen.
            </HelpText>
          )}
          <Text style={styles.fieldLabel}>Filled with</Text>
          <SegmentedControl options={KIND_OPTIONS} value={kind} onChange={setKind} columns={2} label="Filled with" />
          <HelpText style={styles.hint}>
            {kind === 'options'
              ? 'Offers only the suggestions below.'
              : 'Offers what’s in your kitchen of this kind, then what you usually buy.'}
          </HelpText>

          <Text style={[styles.fieldLabel, styles.fieldLabelSpaced]}>How many</Text>
          <SegmentedControl options={COUNT_OPTIONS} value={count} onChange={setCount} label="How many" />

          <Text style={[styles.fieldLabel, styles.fieldLabelSpaced]}>Amount</Text>
          <TextField
            style={styles.input}
            value={quantity}
            onChangeText={setQuantity}
            placeholder="e.g. 2 cups"
            placeholderTextColor={colors.textTertiary}
            maxLength={GROCERY_QUANTITY_MAX_LENGTH}
            returnKeyType="next"
            accessibilityLabel="Amount"
          />
          <HelpText style={styles.hint}>Split evenly across what you pick.</HelpText>

          <Text style={[styles.fieldLabel, styles.fieldLabelSpaced]}>Label</Text>
          <TextField
            style={styles.input}
            value={label}
            onChangeText={setLabel}
            placeholder={fieldKind ? FOOD_KIND_LABELS[fieldKind] : 'e.g. Cheese'}
            placeholderTextColor={colors.textTertiary}
            maxLength={RECIPE_BLANK_LABEL_MAX_LENGTH}
            returnKeyType="next"
            accessibilityLabel="Label"
          />

          <Text style={[styles.fieldLabel, styles.fieldLabelSpaced]}>Suggestions</Text>
          <TextField
            style={styles.input}
            value={options}
            onChangeText={setOptions}
            placeholder="e.g. feta, goat cheese"
            placeholderTextColor={colors.textTertiary}
            autoCapitalize="none"
            returnKeyType="done"
            onSubmitEditing={handleSave}
            accessibilityLabel="Suggestions, separated by commas"
          />
          <HelpText style={styles.hint}>Offered every time, whether or not they’re in your kitchen. Separate them with commas.</HelpText>

          {blankId && (
            <TouchableOpacity
              style={styles.deleteRow}
              onPress={handleDelete}
              activeOpacity={interaction.activeOpacity}
              accessibilityRole="button"
              accessibilityLabel={`Delete the ${blank?.label ?? ''} blank`}
            >
              <Ionicons name="trash-outline" size={iconSize.md} color={colors.red} />
              <Text style={styles.deleteText}>Delete blank</Text>
            </TouchableOpacity>
          )}
        </ScrollView>
      </View>
    </SheetModal>
  );
}

const makeStyles = (colors: Colors) => StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  scroll: { flex: 1 },
  body: { padding: spacing.md },
  fieldLabel: {
    color: colors.textSecondary, fontSize: font.xs, fontWeight: fontWeight.semibold,
    textTransform: 'uppercase', letterSpacing: 0.8,
    paddingHorizontal: spacing.xs, marginBottom: spacing.sm,
  },
  fieldLabelSpaced: { marginTop: spacing.lg },
  input: {
    backgroundColor: colors.bgSecondary,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.smd,
    color: colors.text,
    fontSize: font.md,
  },
  hint: {
    color: colors.textSecondary,
    fontSize: font.xs,
    paddingHorizontal: spacing.xs,
    marginTop: spacing.sm,
  },
  intro: { marginTop: 0, marginBottom: spacing.md },
  deleteRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.bgSecondary,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.smd,
    marginTop: spacing.xl,
  },
  deleteText: { color: colors.redText, fontSize: font.md },
});
