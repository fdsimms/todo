import React, { useEffect, useMemo, useState } from 'react';
import { Alert, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { CardSheet, useCardSheet } from './CardSheet';
import { SegmentedControl } from './SegmentedControl';
import { SheetHeaderButton } from './SheetHeaderButton';
import { TextField } from './TextField';
import { Toggle } from './Toggle';
import { HelpText } from './HelpText';
import { useColors } from '../theme/ThemeContext';
import { spacing, radius, font, fontWeight, interaction, type Colors } from '../theme';
import { haptics } from '../utils/haptics';
import { animateLayout } from '../utils/layoutAnimation';
import { BUTTON_LABEL } from '../copy/shared';
import { canShare, discardBackupFile, sharePdfFile, writePdfFile } from '../utils/backupFile';
import {
  ingredientCardHtml,
  ingredientFileName,
  ingredientPageHtml,
  type IngredientPrintInput,
} from '../utils/ingredientPrintout';

type Kind = 'page' | 'card';

interface Props {
  visible: boolean;
  /** Everything the pages print except the choices made here. */
  recipe: Omit<IngredientPrintInput, 'madeBy' | 'showAllergens'>;
  onClose: () => void;
}

/**
 * Turns a recipe's ingredients into a PDF to print or send, for taking a dish
 * to a potluck: a full page with amounts, or a small card with names only to
 * set beside it. The pages themselves are `ingredientPrintout.ts`; this is
 * only the choices and the share.
 */
export function PrintIngredientsSheet({ visible, recipe, onClose }: Props) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const card = useCardSheet();

  const [kind, setKind] = useState<Kind>('page');
  const [madeBy, setMadeBy] = useState('');
  const [allergens, setAllergens] = useState(true);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!visible) return;
    setKind('page');
    setMadeBy('');
    setAllergens(true);
  }, [visible]);

  const dismiss = (after: () => void) => card.close(after);

  const share = async () => {
    if (busy) return;
    haptics.tap();
    setBusy(true);
    let uri: string | null = null;
    try {
      if (!(await canShare())) {
        Alert.alert('Can’t share from this device', 'This device cannot open a share sheet.');
        return;
      }
      const input: IngredientPrintInput = { ...recipe, madeBy, showAllergens: allergens };
      const html = kind === 'card' ? ingredientCardHtml(input) : ingredientPageHtml(input);
      uri = await writePdfFile(html, ingredientFileName(recipe.name, kind));
      await sharePdfFile(uri, 'Print or share the ingredients');
      dismiss(onClose);
    } catch {
      Alert.alert('Couldn’t make the page', 'The ingredient page couldn’t be created. Try again.');
    } finally {
      if (uri) discardBackupFile(uri);
      setBusy(false);
    }
  };

  return (
    <CardSheet
      name="PrintIngredientsSheet"
      visible={visible}
      controller={card}
      onRequestClose={() => dismiss(onClose)}
    >
      <View style={styles.card}>
        <View style={styles.headerRow}>
          <SheetHeaderButton label={BUTTON_LABEL.cancel} role="cancel" onPress={() => dismiss(onClose)} minWidth={56} />
          <Text style={styles.heading} numberOfLines={2}>Print ingredients</Text>
          <SheetHeaderButton label="Share" onPress={share} minWidth={56} style={styles.headerRight} />
        </View>

        <View style={styles.body}>
          <SegmentedControl<Kind>
            options={[
              { value: 'page', label: 'Full page' },
              { value: 'card', label: 'Table card' },
            ]}
            value={kind}
            onChange={next => { animateLayout(); setKind(next); }}
          />
          <HelpText style={styles.hint}>
            {kind === 'page'
              ? 'The ingredients with their amounts, grouped as in the recipe.'
              : 'Ingredient names only, on a small card to set next to the dish.'}
          </HelpText>

          {kind === 'card' && (
            <TextField
              style={styles.input}
              value={madeBy}
              onChangeText={setMadeBy}
              placeholder="Made by (optional)"
              placeholderTextColor={colors.textTertiary}
              autoCapitalize="words"
              returnKeyType="done"
              accessibilityLabel="Made by"
            />
          )}

          <TouchableOpacity
            style={styles.optionRow}
            onPress={() => { haptics.tap(); setAllergens(v => !v); }}
            activeOpacity={interaction.activeOpacity}
            accessibilityRole="switch"
            accessibilityLabel="List common allergens"
            accessibilityState={{ checked: allergens }}
          >
            <View style={styles.optionContent}>
              <Text style={styles.optionLabel}>List common allergens</Text>
              <HelpText style={styles.optionHint}>
                Guessed from the ingredient names, so it can miss things. The page says so.
              </HelpText>
            </View>
            <Toggle value={allergens} onColor={colors.orange} />
          </TouchableOpacity>
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
  body: { paddingHorizontal: spacing.md, paddingTop: spacing.md, gap: spacing.sm },
  hint: { color: colors.textSecondary, fontSize: font.sm },
  input: {
    backgroundColor: colors.bgTertiary,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    height: 44,
    color: colors.text,
    fontSize: font.md,
    marginTop: spacing.xs,
  },
  optionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginTop: spacing.xs,
    padding: spacing.md,
    backgroundColor: colors.bgTertiary,
    borderRadius: radius.md,
  },
  optionContent: { flex: 1, gap: spacing.xxs },
  optionLabel: { color: colors.text, fontSize: font.md },
  optionHint: { color: colors.textSecondary, fontSize: font.sm, lineHeight: 18 },
});
