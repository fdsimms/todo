import React, { useMemo, useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useColors } from '../theme/ThemeContext';
import { spacing, radius, font, fontWeight, iconSize, interaction, type Colors } from '../theme';
import { InlineAction } from './InlineAction';
import { haptics } from '../utils/haptics';
import { animateLayout } from '../utils/layoutAnimation';
import {
  resolvePillOverflow,
  resolvePillSubmit,
  DEFAULT_PILL_LIMIT,
  type OverflowPill,
} from '../utils/pillOverflow';

export interface PillGroupOption extends OverflowPill {
  /**
   * Rendered after the label and deliberately *not* matched by the filter — a
   * purchase count ("· 3") is decoration on the name, and letting someone find
   * Costco by typing "3" would be nonsense.
   */
  suffix?: string;
  /**
   * A pill carrying a stated *negative* — "this store doesn't have it". Tinted
   * red and struck through rather than filled like a selected pill, because it
   * isn't one: `selected` means this option is the value, and a ruled-out
   * option is the opposite of chosen. The two states are mutually exclusive by
   * construction (the grocery item sheet's store picker cycles between them),
   * and `negative` wins if a caller ever sets both.
   */
  negative?: boolean;
  accessibilityLabel?: string;
  onPress: () => void;
}

/**
 * Which surface the grid sits on. `page` is straight onto `colors.bg`, where
 * the tint the pills would otherwise take (`bgTertiary`) is nearly invisible;
 * `card` is inside a `bgSecondary` card, where it isn't.
 */
type Surface = 'page' | 'card';

interface Props {
  options: PillGroupOption[];
  /**
   * Lower-case singular noun for the thing being picked — "aisle", "store".
   * Every label the component writes is built from it, so callers never spell
   * "New store" / "Find or add a store…" / "4 more stores" themselves and the
   * three can't drift apart.
   */
  noun: string;
  /**
   * Overrides the `${noun}s` the "N more…" label defaults to, for the one
   * noun in the app whose plural isn't its singular plus "s" — "person"
   * becomes "people", not "persons".
   */
  pluralNoun?: string;
  /**
   * Adds one. Return a message to reject the name and keep the field open;
   * return nothing to accept it. Omit entirely for a grid you can only pick
   * from — the create affordance disappears with it.
   */
  onCreate?: (name: string) => string | null | void;
  createMaxLength?: number;
  limit?: number;
  surface?: Surface;
  /** Overrides "Find or add a {noun}…" when the noun doesn't take "a". */
  filterPlaceholder?: string;
}

/**
 * A wrapping grid of pills that stays a glance however many options there are.
 *
 * The grocery item sheet is what this was written for: sixteen aisles and an
 * unbounded list of stores, both rendered in full, which pushed the fields the
 * sheet actually exists to edit off the first screen. Past `limit` the grid
 * caps itself behind one "N more" and grows a field that both filters the set
 * and adds to it — see `pillOverflow.ts`, which holds the rule and its tests.
 *
 * The two create affordances are one control in two states, not two designs:
 * a small set has no field, so it gets the "+ New {noun}" button that opens an
 * inline input; a set past the cap already has a field, so the button becomes
 * the `Create "…"` that field's text implies. Either way there is exactly one
 * way to add, visible without scrolling, at any size of list.
 *
 * "N more" is deliberately one-way. The grid lives inside a `CollapsibleField`
 * whose close unmounts it, so the section header is already the way back — a
 * second "show less" would be a control that undoes a control.
 */
export function PillGroup({
  options,
  noun,
  pluralNoun,
  onCreate,
  createMaxLength = 32,
  limit = DEFAULT_PILL_LIMIT,
  surface = 'card',
  filterPlaceholder,
}: Props) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors, surface), [colors, surface]);

  const [query, setQuery] = useState('');
  const [showAll, setShowAll] = useState(false);
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | null>(null);

  const overflow = useMemo(
    // A negative pill is exempt from the cap for the same reason a selected one
    // is: it's something the user said about this row, and burying "not at
    // Safeway" behind "4 more" hides the fact and its only undo. Mapped here
    // rather than pushed into `pillOverflow`, so callers keep using `pinned`
    // for the one thing it means — the option that stands for no choice.
    () =>
      resolvePillOverflow(
        options.map(o => (o.negative ? { ...o, pinned: true } : o)),
        { query, limit, showAll },
      ),
    [options, query, limit, showAll],
  );
  const { visible, hiddenCount, filterable, exact, noMatches } = overflow;

  // A filterable grid types into the filter; a small one types into the inline
  // input the "+ New" button opens. One draft either way, so the submit and
  // error paths below don't have to care which mode they're in.
  const text = filterable ? query : draft;
  const setText = (t: string) => {
    if (error) setError(null);
    (filterable ? setQuery : setDraft)(t);
  };

  const trimmed = text.trim();
  const canCreate = !!onCreate && !!trimmed && !exact;

  const handleCreate = () => {
    if (!onCreate || !trimmed) return;
    const rejection = onCreate(trimmed);
    if (rejection) {
      setError(rejection);
      haptics.error();
      return;
    }
    animateLayout();
    setQuery('');
    setDraft('');
    setAdding(false);
  };

  const handleSubmit = () => {
    const decision = resolvePillSubmit(overflow, { text, canCreate: !!onCreate });
    if (decision.action === 'pick') decision.option.onPress();
    else if (decision.action === 'create') handleCreate();
  };

  const revealAll = () => {
    haptics.tap();
    animateLayout();
    setShowAll(true);
  };

  const field = (placeholder: string, extra: object, autoFocus = false, onBlur?: () => void) => (
    <TextInput
      style={[styles.field, extra, !!error && styles.fieldError]}
      value={text}
      onChangeText={setText}
      placeholder={placeholder}
      placeholderTextColor={colors.textTertiary}
      returnKeyType="done"
      onSubmitEditing={handleSubmit}
      onBlur={onBlur}
      autoFocus={autoFocus}
      autoCorrect={false}
      maxLength={createMaxLength}
      accessibilityLabel={placeholder}
    />
  );

  return (
    <View>
      {filterable && (
        <View style={styles.searchWrap}>
          <Ionicons
            name="search"
            size={iconSize.sm}
            color={colors.textTertiary}
            style={styles.searchIcon}
          />
          {field(
            filterPlaceholder ?? (onCreate ? `Find or add a ${noun}…` : `Find a ${noun}…`),
            styles.searchField,
          )}
        </View>
      )}

      {/* The field carries its own bottom gap, so the grid only adds a top one
          when there's no field above it to sit under. */}
      <View style={[styles.pills, !filterable && styles.pillsSpaced]}>
        {visible.map(option => (
          <TouchableOpacity
            key={option.key}
            style={[
              styles.pill,
              option.selected && !option.negative && styles.pillActive,
              option.negative && styles.pillNegative,
            ]}
            activeOpacity={interaction.activeOpacity}
            onPress={option.onPress}
            accessibilityRole="button"
            accessibilityState={{ selected: !!option.selected && !option.negative }}
            accessibilityLabel={option.accessibilityLabel ?? option.label}
          >
            <Text
              style={[
                styles.pillText,
                option.selected && !option.negative && styles.pillTextActive,
                option.negative && styles.pillTextNegative,
              ]}
            >
              {option.label}
              {option.suffix}
            </Text>
          </TouchableOpacity>
        ))}

        {hiddenCount > 0 && (
          <TouchableOpacity
            style={[styles.pill, styles.morePill]}
            activeOpacity={interaction.activeOpacity}
            onPress={revealAll}
            accessibilityRole="button"
            accessibilityState={{ expanded: false }}
            accessibilityLabel={`Show ${hiddenCount} more ${pluralNoun ?? `${noun}s`}`}
          >
            <Text style={[styles.pillText, styles.moreText]}>{hiddenCount} more</Text>
            <Ionicons name="chevron-down" size={12} color={colors.textSecondary} />
          </TouchableOpacity>
        )}

        {/* One control, two states. With a filter field on screen the text to
            add is already typed, so the button commits it; without one it opens
            the input that collects it. Never both, and never neither — the
            "New store" affordance has to be reachable before any store exists,
            not only once the grid has something to tap. */}
        {canCreate && filterable && (
          <InlineAction
            label={`Create “${trimmed}”`}
            icon="add"
            haptic
            onPress={handleCreate}
            accessibilityLabel={`Create the ${noun} ${trimmed}`}
          />
        )}
        {!!onCreate && !filterable && !adding && (
          // Neutral, not accent: accent is what marks a *selected* pill in this
          // grid, so a tinted add button reads as one more option — the same
          // reason the add button beside tag chips is neutral.
          <InlineAction
            label={`New ${noun}`}
            icon="add"
            variant="neutral"
            haptic
            onPress={() => {
              animateLayout();
              setAdding(true);
            }}
            accessibilityLabel={`Add a new ${noun}`}
            style={styles.addButton}
          />
        )}
      </View>

      {!!onCreate && !filterable && adding && (
        <View style={styles.addWrap}>
          {/* An empty field is someone who changed their mind, so tapping away
              closes it rather than leaving a dead row behind. */}
          {field(`${noun[0].toUpperCase()}${noun.slice(1)} name`, styles.addField, true, () => {
            if (!trimmed) {
              animateLayout();
              setAdding(false);
            }
          })}
          <InlineAction
            label="Add"
            icon="add"
            variant="neutral"
            onPress={handleCreate}
            disabled={!trimmed}
            style={styles.addButton}
          />
        </View>
      )}

      {noMatches && !canCreate && (
        <Text style={styles.empty}>No {noun} matches “{trimmed}”.</Text>
      )}
      {!!error && <Text style={styles.error}>{error}</Text>}
    </View>
  );
}

const makeStyles = (colors: Colors, surface: Surface) => {
  // The pills take the surface one step up from whatever they sit on, so the
  // grid reads as a set of controls rather than as text on the background.
  const pillBg = surface === 'page' ? colors.bgSecondary : colors.bgTertiary;

  return StyleSheet.create({
    searchWrap: { justifyContent: 'center', marginBottom: spacing.sm },
    searchIcon: { position: 'absolute', left: spacing.sm + 2, zIndex: 1 },
    field: {
      backgroundColor: pillBg,
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: 'transparent',
      paddingHorizontal: spacing.sm + 2,
      fontSize: font.md,
      color: colors.text,
      // A height rather than a lineHeight: RN maps lineHeight straight onto the
      // iOS paragraph style with no baseline compensation, so the glyphs sit
      // low in the box while the caret stays centred.
      height: 40,
    },
    // Clears the magnifier: its left inset, its own width, and a gap.
    searchField: { paddingLeft: spacing.sm + 2 + iconSize.sm + spacing.sm },
    addField: { flex: 1 },
    fieldError: { borderColor: colors.red },
    pills: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: spacing.sm },
    pillsSpaced: { marginTop: spacing.sm },
    pill: {
      backgroundColor: pillBg,
      borderRadius: radius.full,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
    },
    pillActive: { backgroundColor: colors.accentFill },
    // Tinted rather than filled: a filled red pill in a grid where filled means
    // "picked" reads as an emphatic selection, which is the wrong half of the
    // meaning. The strike-through on the label is what carries "ruled out".
    pillNegative: { backgroundColor: colors.red + '1A' },
    pillText: { fontSize: font.sm, color: colors.text },
    pillTextActive: { color: colors.onAccent, fontWeight: fontWeight.semibold },
    pillTextNegative: { color: colors.red, textDecorationLine: 'line-through' },
    morePill: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
    // Weighted, so the disclosure doesn't read as one more option in the grid
    // it sits at the end of.
    moreText: { fontWeight: fontWeight.semibold },
    addWrap: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: spacing.sm },
    addButton: { backgroundColor: pillBg },
    empty: { fontSize: font.sm, color: colors.textTertiary, marginTop: spacing.sm },
    error: { fontSize: font.sm, color: colors.red, marginTop: spacing.sm },
  });
};
