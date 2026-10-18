import React, { useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useCookwareStore } from '../store/useCookwareStore';
import type { WeighIn } from '../hooks/useWeighIn';
import { groupCookwareByType, type CookwareNoun } from '../utils/cookware';
import { haptics } from '../utils/haptics';
import { CardSheet, type CardAnchor } from './CardSheet';
import { CookwareSheet } from './CookwareSheet';
import { useColors } from '../theme/ThemeContext';
import { font, fontWeight, iconSize, interaction, radius, spacing, type Colors } from '../theme';

interface Props {
  weighIn: WeighIn;
  /** What is typed in the weight field next to this, for the line under the row. */
  scaleText: string;
  /** `card` inside a `bgSecondary` card, `page` straight onto the sheet. */
  surface?: 'page' | 'card';
  /** What a refusal calls the pieces: a pot under a dish's weight, a plate under a meal's. */
  noun?: CookwareNoun;
}

const grams = (g: number) => `${g.toLocaleString('en-US')} g`;

/**
 * Pick the cookware a food was weighed in, and say what comes out of the subtraction.
 *
 * The weight field beside it stays a plain number field. With nothing picked it
 * means what it always did (the food alone); with something picked it is what
 * the scale read, and the line underneath is where the cookware comes off. The
 * refusal for a reading lighter than the cookware is shown here too, so the
 * person sees it before leaving the field rather than after nothing saved.
 *
 * **One row that opens a menu, not a pill per piece.** A kitchen holds a dozen
 * pieces or more, and a wrapping grid of them pushed the fields the sheet exists
 * for off the screen. The menu lists them under their type (`groupCookwareByType`)
 * and scrolls. It stays open while picking, because several can be picked at once
 * (a pot and its lid are two entries); "None" clears and closes.
 */
export function CookwareWeighIn({ weighIn, scaleText, surface = 'card', noun = 'pot' }: Props) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors, surface), [colors, surface]);
  const cookware = useCookwareStore(s => s.cookware);
  const groups = useMemo(() => groupCookwareByType(cookware), [cookware]);
  const [menuOpen, setMenuOpen] = useState(false);
  const [anchor, setAnchor] = useState<CardAnchor | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);

  const result = scaleText.trim() ? weighIn.convert(scaleText) : null;
  const tare = weighIn.picked.reduce((sum, c) => sum + c.weightG, 0);

  const rowLabel =
    weighIn.picked.length === 0 ? 'Subtract cookware weight'
    : weighIn.picked.length === 1 ? `${weighIn.picked[0].name} · ${grams(weighIn.picked[0].weightG)}`
    : `${weighIn.picked.length} pieces · ${grams(tare)}`;

  return (
    <View>
      <TouchableOpacity
        style={styles.field}
        activeOpacity={interaction.activeOpacity}
        onPress={e => {
          haptics.tap();
          setAnchor({ x: e.nativeEvent.pageX, y: e.nativeEvent.pageY });
          setMenuOpen(true);
        }}
        accessibilityRole="button"
        accessibilityLabel={`Cookware: ${rowLabel}. Change cookware`}
      >
        <Text style={[styles.fieldText, weighIn.picked.length === 0 && styles.fieldTextEmpty]} numberOfLines={1}>
          {rowLabel}
        </Text>
        <Ionicons name="chevron-down" size={iconSize.sm} color={colors.textSecondary} />
      </TouchableOpacity>
      {weighIn.picked.length > 0 && result && (
        <Text style={result.ok ? styles.result : styles.refusal}>
          {result.ok
            ? `${grams(tare)} of cookware taken off. The ${noun === 'pot' ? 'dish' : 'food'} is ${grams(result.grams)}.`
            : result.reason}
        </Text>
      )}
      <CardSheet
        name="CookwareWeighIn menu"
        visible={menuOpen}
        onClose={() => setMenuOpen(false)}
        anchor={anchor}
        popoverWidth={260}
        scrimLabel="Close cookware menu"
      >
        {close => (
          <ScrollView bounces={false} showsVerticalScrollIndicator={false}>
            <View style={styles.menu}>
              <TouchableOpacity
                style={styles.row}
                activeOpacity={interaction.activeOpacity}
                onPress={() => { haptics.tap(); close(weighIn.clear); }}
                accessibilityRole="button"
                accessibilityState={{ selected: weighIn.picked.length === 0 }}
                accessibilityLabel="No cookware"
              >
                <Text style={[styles.rowText, weighIn.picked.length === 0 && styles.rowTextOn]}>None</Text>
                {weighIn.picked.length === 0 && <Ionicons name="checkmark" size={iconSize.sm} color={colors.accentText} />}
              </TouchableOpacity>
              {groups.map(group => (
                <React.Fragment key={group.type}>
                  <Text style={styles.header}>{group.type.toUpperCase()}</Text>
                  {group.items.map(c => {
                    const on = weighIn.selected.includes(c.id);
                    return (
                      <TouchableOpacity
                        key={c.id}
                        style={styles.row}
                        activeOpacity={interaction.activeOpacity}
                        onPress={() => { haptics.tap(); weighIn.toggle(c.id); }}
                        accessibilityRole="button"
                        accessibilityState={{ selected: on }}
                        accessibilityLabel={`${c.name}, ${grams(c.weightG)}`}
                      >
                        <Text style={[styles.rowText, on && styles.rowTextOn]} numberOfLines={1}>{c.name}</Text>
                        {on
                          ? <Ionicons name="checkmark" size={iconSize.sm} color={colors.accentText} />
                          : <Text style={styles.rowWeight}>{grams(c.weightG)}</Text>}
                      </TouchableOpacity>
                    );
                  })}
                </React.Fragment>
              ))}
              <Text style={styles.header}>{cookware.length > 0 ? 'OTHER' : 'NONE SAVED YET'}</Text>
              <TouchableOpacity
                style={styles.row}
                activeOpacity={interaction.activeOpacity}
                onPress={() => { haptics.tap(); close(() => setSheetOpen(true)); }}
                accessibilityRole="button"
                accessibilityLabel={cookware.length > 0 ? 'Edit cookware' : 'Add cookware'}
              >
                <Text style={styles.rowText}>{cookware.length > 0 ? 'Edit cookware' : 'Add cookware'}</Text>
              </TouchableOpacity>
            </View>
          </ScrollView>
        )}
      </CardSheet>
      <CookwareSheet visible={sheetOpen} onClose={() => setSheetOpen(false)} />
    </View>
  );
}

const makeStyles = (colors: Colors, surface: 'page' | 'card') => StyleSheet.create({
  field: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.smd,
    borderRadius: radius.md,
    backgroundColor: surface === 'page' ? colors.bgSecondary : colors.bgTertiary,
  },
  fieldText: { color: colors.text, fontSize: font.md, flexShrink: 1 },
  fieldTextEmpty: { color: colors.textSecondary },
  result: { color: colors.textSecondary, fontSize: font.sm, marginTop: spacing.sm },
  refusal: { color: colors.redText, fontSize: font.sm, marginTop: spacing.sm },
  menu: { paddingVertical: spacing.xs },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.smd,
  },
  rowText: { color: colors.text, fontSize: font.md, flexShrink: 1 },
  rowTextOn: { color: colors.accentText, fontWeight: fontWeight.semibold },
  rowWeight: { color: colors.textSecondary, fontSize: font.sm },
  header: {
    color: colors.textSecondary,
    fontSize: font.xs,
    fontWeight: fontWeight.semibold,
    letterSpacing: 0.8,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.smd,
    paddingBottom: spacing.xs,
  },
});
