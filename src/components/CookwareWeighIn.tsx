import React, { useMemo, useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useCookwareStore } from '../store/useCookwareStore';
import type { WeighIn } from '../hooks/useWeighIn';
import { PillGroup } from './PillGroup';
import { InlineAction } from './InlineAction';
import { HelpText } from './HelpText';
import { CookwareSheet } from './CookwareSheet';
import { useColors } from '../theme/ThemeContext';
import { spacing, font, type Colors } from '../theme';

interface Props {
  weighIn: WeighIn;
  /** What is typed in the weight field next to this, for the line under the pills. */
  scaleText: string;
  /** `card` inside a `bgSecondary` card, `page` straight onto the sheet. */
  surface?: 'page' | 'card';
}

/**
 * Pick the pots a dish was weighed in, and say what comes out of the subtraction.
 *
 * The weight field beside it stays a plain number field. With nothing picked it
 * means what it always did (the food alone); with something picked it is what
 * the scale read, and the line underneath is where the pot comes off. The
 * refusal for a reading lighter than the pot is shown here too, so the person
 * sees it before leaving the field rather than after nothing saved.
 *
 * Several can be picked at once because a pot and its lid are two entries.
 */
export function CookwareWeighIn({ weighIn, scaleText, surface = 'card' }: Props) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const cookware = useCookwareStore(s => s.cookware);
  const [sheetOpen, setSheetOpen] = useState(false);

  const result = scaleText.trim() ? weighIn.convert(scaleText) : null;
  const tare = weighIn.picked.reduce((sum, c) => sum + c.weightG, 0);

  return (
    <View>
      {cookware.length > 0 && (
        <>
          <PillGroup
            surface={surface}
            noun="pot"
            options={[
              {
                key: 'none',
                label: 'No pot',
                selected: weighIn.picked.length === 0,
                pinned: true,
                onPress: weighIn.clear,
              },
              ...cookware.map(c => ({
                key: c.id,
                label: c.name,
                suffix: `${c.weightG.toLocaleString('en-US')} g`,
                selected: weighIn.selected.includes(c.id),
                onPress: () => weighIn.toggle(c.id),
              })),
            ]}
          />
          <HelpText style={styles.hint}>
            With a pot picked, type what the scale reads. The pot's weight is taken off.
          </HelpText>
        </>
      )}
      <InlineAction
        label={cookware.length > 0 ? 'Cookware' : 'Weigh with a pot'}
        icon={cookware.length > 0 ? 'create-outline' : 'add'}
        variant={cookware.length > 0 ? 'neutral' : 'accent'}
        surface={surface}
        onPress={() => setSheetOpen(true)}
        style={styles.action}
      />
      {weighIn.picked.length > 0 && result && (
        <Text style={result.ok ? styles.result : styles.refusal}>
          {result.ok
            ? `${tare.toLocaleString('en-US')} g of cookware taken off. The dish is ${result.grams.toLocaleString('en-US')} g.`
            : result.reason}
        </Text>
      )}
      <CookwareSheet visible={sheetOpen} onClose={() => setSheetOpen(false)} />
    </View>
  );
}

const makeStyles = (colors: Colors) => StyleSheet.create({
  hint: { color: colors.textTertiary, fontSize: font.xs, marginTop: spacing.xsm },
  action: { alignSelf: 'flex-start', marginTop: spacing.sm },
  result: { color: colors.textSecondary, fontSize: font.sm, marginTop: spacing.sm },
  refusal: { color: colors.redText, fontSize: font.sm, marginTop: spacing.sm },
});
