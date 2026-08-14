import React, { useMemo, useRef, useState, useCallback, forwardRef, useImperativeHandle } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
} from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useColors } from '../theme/ThemeContext';
import {
  spacing,
  font,
  fontWeight,
  radius,
  border,
  iconSize,
  interaction,
  type Colors,
} from '../theme';
import { useGroceryStore } from '../store/useGroceryStore';
import { rankGrocerySuggestions } from '../utils/grocerySuggest';
import { resolveGroceryTokens, splitAlternativeNames } from '../utils/groceryParse';
import { haptics } from '../utils/haptics';
import { animateLayout } from '../utils/layoutAnimation';
import {
  GROCERY_NAME_MAX_LENGTH,
  GROCERY_BRAND_MAX_LENGTH,
  GROCERY_VARIANT_MAX_LENGTH,
  type GroceryItem,
} from '../types';
import { describeProduct } from '../utils/groceryProduct';
import { generateId } from '../utils/id';

interface Props {
  /**
   * Fired after anything is added, with the rows it put on the list in the
   * order they were typed — the sheet counts them, and the screen places them
   * when the sheet was opened by dropping the add button somewhere.
   */
  onAdded?: (items: GroceryItem[]) => void;
}

/**
 * The field's own height, fixed rather than sized by its content: the results
 * block below is positioned off it, and the whole point of that block being out
 * of flow is that neither piece moves as you type.
 */
const FIELD_HEIGHT = 48 + border.sm * 2;

/**
 * The attribute toolbar (Brand/Variant) and its inline edit panel, sized the
 * same explicit way FIELD_HEIGHT is — `results` is positioned off the sum of
 * all three, and unlike the field these two are tap-driven rather than
 * typing-driven, so they live in flow above `results` instead of inside its
 * out-of-flow block. TOOLBAR_HEIGHT matches the chip row's own minHeight;
 * ATTRIBUTE_PANEL_HEIGHT is given to the panel row directly rather than left
 * to its content, for the same reason FIELD_HEIGHT is.
 */
const TOOLBAR_HEIGHT = interaction.pillHeight;
const ATTRIBUTE_PANEL_HEIGHT = 40;

/** Lets the sheet focus the field once its entrance animation has settled. */
export interface GroceryAddFieldHandle {
  focus: () => void;
  /** Commits whatever's currently typed, same as pressing return — so closing the sheet doesn't silently drop it. */
  commitPending: () => void;
}

/**
 * The "what do you need" field, shown inside `GroceryAddSheet` behind the FAB.
 *
 * A grocery list is entered in bursts of ten, which is why this is a field and
 * not a name sheet that closes on every add: submit adds and *keeps focus*
 * (blurOnSubmit={false}), so ten items is ten keystrokes-and-return inside one
 * presentation rather than ten. That's the behaviour the pinned-at-the-top
 * version existed to protect, and it survives the move to the FAB intact — the
 * sheet stays open until you dismiss it.
 *
 * Behaviour is otherwise the chain-step input from QuickAddModal, verbatim.
 */
export const GroceryAddField = forwardRef<GroceryAddFieldHandle, Props>(function GroceryAddField(
  { onAdded },
  ref
) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const inputRef = useRef<TextInput>(null);

  const items = useGroceryStore(s => s.items);
  const addByName = useGroceryStore(s => s.addByName);
  const addManyFromText = useGroceryStore(s => s.addManyFromText);
  const setLastAction = useGroceryStore(s => s.setLastAction);
  const removeFromListMany = useGroceryStore(s => s.removeFromListMany);

  const [text, setText] = useState('');
  const [focused, setFocused] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  // Named by the exact parsed text they dismissed, not a plain on/off flag —
  // see resolveGroceryTokens for why that's what makes a rejection survive
  // continued typing without needing an effect to reconcile it.
  const [rejectedQuantity, setRejectedQuantity] = useState<string | null>(null);
  const [rejectedPrep, setRejectedPrep] = useState<string | null>(null);
  const [rejectedPurpose, setRejectedPurpose] = useState<string | null>(null);

  // Optional, set explicitly rather than parsed — see newItemRow's own note on
  // why nothing pulls a brand out of typed text. Mirrors QuickAddModal's
  // attribute toolbar: a chip per field, one inline panel open at a time.
  const [brand, setBrand] = useState('');
  const [variant, setVariant] = useState('');
  const [activePanel, setActivePanel] = useState<'brand' | 'variant' | null>(null);

  const resetAttributes = useCallback(() => {
    setBrand('');
    setVariant('');
    setActivePanel(null);
  }, []);

  const togglePanel = useCallback((panel: 'brand' | 'variant') => {
    haptics.tap();
    animateLayout();
    setActivePanel(prev => (prev === panel ? null : panel));
  }, []);

  const suggestions = useMemo(
    () => (focused ? rankGrocerySuggestions(text, items, new Date()) : []),
    [focused, text, items]
  );

  // What committing `text` right now would actually save — the whole point is
  // showing this *before* the tap, not after, so the split is a visible
  // decision rather than something the parser did behind your back.
  const tokens = useMemo(() => {
    const trimmed = text.trim();
    if (!trimmed) return null;
    return resolveGroceryTokens(trimmed, {
      quantity: rejectedQuantity,
      prep: rejectedPrep,
      purpose: rejectedPurpose,
    });
  }, [text, rejectedQuantity, rejectedPrep, rejectedPurpose]);

  // "pepper or thyme" wants to be two rows on the list, not one catalog entry
  // nothing can ever match — see splitAlternativeNames. They go on as an
  // either/or (GroceryItem.choiceGroup), so ticking one at the shelf takes the
  // other off: "apples or pears, decide at the shop" is exactly what someone
  // typing this line means, and adding both plain left the loser sitting there
  // looking outstanding. Offered, never applied on its own, for the same reason
  // the recipe sheet holds off — the split is verbatim.
  const alternatives = useMemo(
    () => (tokens ? splitAlternativeNames(tokens.name) : null),
    [tokens]
  );

  const acceptAlternatives = useCallback(() => {
    if (!alternatives) return;
    animateLayout();
    // An opaque id, not the typed line — see GroceryItem.choiceGroup for why
    // this half of the feature doesn't want a label.
    const group = generateId();
    const addedItems = alternatives.map(part =>
      addByName(
        part,
        {
          name: part,
          quantity: tokens?.quantityAccepted ? tokens.quantity : null,
          // "limes or lemons for margs" is one purpose over two rows.
          note: tokens?.note ?? null,
          choiceGroup: group,
        },
        undefined,
        { registerUndo: false },
      )
    );
    haptics.success();
    setText('');
    setStatus(null);
    setRejectedQuantity(null);
    setRejectedPrep(null);
    setRejectedPurpose(null);
    resetAttributes();
    // One combined undo, same reason addManyFromText combines its per-line
    // ones — otherwise only the last of the two rows would be undoable.
    const addedIds = addedItems.map(i => i.id);
    setLastAction({
      label: `${addedItems.length} either/or items added`,
      undo: () => removeFromListMany(addedIds),
    });
    onAdded?.(addedItems);
  }, [alternatives, addByName, tokens, setLastAction, removeFromListMany, onAdded, resetAttributes]);

  const commit = useCallback(
    (
      raw: string,
      override?: {
        name: string;
        quantity: string | null;
        note?: string | null;
        brand?: string | null;
        variant?: string | null;
      }
    ) => {
      const trimmed = raw.trim();
      if (!trimmed) return;
      animateLayout();
      const item = addByName(trimmed, override);
      haptics.tap();
      setText('');
      setStatus(null);
      setRejectedQuantity(null);
      setRejectedPrep(null);
      setRejectedPurpose(null);
      resetAttributes();
      onAdded?.([item]);
    },
    [addByName, onAdded, resetAttributes]
  );

  const submit = useCallback(() => {
    if (!tokens) return;
    commit(text, {
      name: tokens.name,
      quantity: tokens.quantity,
      note: tokens.note,
      // Only the field this add actually typed a value into — an empty chip
      // must not overwrite an existing item's brand/variant on re-add, same
      // rule addByName already applies to quantity and note.
      brand: brand.trim() || null,
      variant: variant.trim() || null,
    });
  }, [tokens, text, commit, brand, variant]);

  useImperativeHandle(ref, () => ({
    focus: () => inputRef.current?.focus(),
    commitPending: submit,
  }), [submit]);

  /**
   * Multi-line paste, without making this a multiline input.
   *
   * `multiline` would break onSubmitEditing — the return key would insert a
   * newline instead of adding the item, which is the whole interaction. So a
   * paste is detected here instead: anything arriving with a newline in it is
   * a block, not typing, and goes straight through splitGroceryLines.
   */
  const handleChange = useCallback(
    (next: string) => {
      if (!next.includes('\n')) {
        setText(next);
        if (status) setStatus(null);
        return;
      }

      animateLayout();
      // A pasted block is many rows, each parsed on its own — there's no one
      // item left for a Brand/Variant chip typed a moment ago to apply to, so
      // it doesn't silently carry over onto whatever's typed next either.
      resetAttributes();
      const { added, alreadyOnList } = addManyFromText(next);
      const total = added.length + alreadyOnList.length;
      if (total === 0) {
        setText('');
        return;
      }

      haptics.success();
      setText('');
      // Only the part the caller can't already see. The sheet header counts
      // what was added; what it can't say is that some of the paste was
      // already on the list, which is why those lines didn't become rows.
      setStatus(
        alreadyOnList.length > 0
          ? `${alreadyOnList.length} already on the list`
          : null
      );
      onAdded?.(added);
    },
    [addManyFromText, onAdded, status, resetAttributes]
  );

  // Everything the field can grow — the parsed-token chips, the either/or
  // offer, the paste status, the matches — or nothing at all.
  const hasTokenChips =
    !!tokens && (tokens.quantityAccepted || tokens.prepAccepted || tokens.purposeAccepted);
  const hasResults = hasTokenChips || !!alternatives || !!status || suggestions.length > 0;

  // `results` is pinned off the bottom of everything static above it — see
  // FIELD_HEIGHT's own note. The toolbar is always there; the panel only adds
  // to this when a chip is open.
  const resultsTop =
    FIELD_HEIGHT + spacing.sm + TOOLBAR_HEIGHT + spacing.sm +
    (activePanel ? ATTRIBUTE_PANEL_HEIGHT + spacing.sm : 0);

  return (
    <View style={styles.wrap}>
      <View style={[styles.field, focused && styles.fieldFocused]}>
        <Ionicons name="add" size={iconSize.md} color={colors.textTertiary} />
        <TextInput
          ref={inputRef}
          style={styles.input}
          value={text}
          onChangeText={handleChange}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          placeholder="Add an item"
          placeholderTextColor={colors.textTertiary}
          returnKeyType="done"
          onSubmitEditing={submit}
          // The whole point: focus survives the submit, so ten items is ten
          // keystrokes-and-return rather than ten taps into a sheet.
          blurOnSubmit={false}
          // iOS inline prediction draws over the field and fights the
          // suggestion list underneath it.
          autoCorrect={false}
          autoCapitalize="none"
          maxLength={GROCERY_NAME_MAX_LENGTH}
          accessibilityLabel="Add a grocery item"
        />
        {!!text && (
          <TouchableOpacity
            onPress={() => {
              setText('');
              setRejectedQuantity(null);
              setRejectedPrep(null);
              setRejectedPurpose(null);
              resetAttributes();
            }}
            activeOpacity={interaction.activeOpacity}
            accessibilityRole="button"
            accessibilityLabel="Clear input"
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Ionicons name="close-circle" size={iconSize.md} color={colors.textTertiary} />
          </TouchableOpacity>
        )}
      </View>

      {/* Optional, in flow like the field above it rather than out of flow
          like `results` below — these are tap-driven, not typing-driven, so
          nothing here reflows on every keystroke the way `results` would if
          it lived out here. Mirrors QuickAddModal's attribute toolbar: a chip
          per field, current value shown once set, one inline panel open at a
          time. */}
      <View style={styles.toolbar}>
        <TouchableOpacity
          style={[
            styles.toolChip,
            activePanel === 'brand' && styles.toolChipActive,
            !!brand && styles.toolChipSet,
          ]}
          onPress={() => togglePanel('brand')}
          activeOpacity={interaction.activeOpacity}
          accessibilityRole="button"
          accessibilityLabel={`Brand${brand ? `: ${brand}` : ''}`}
        >
          <Ionicons
            name="pricetag-outline"
            size={iconSize.sm}
            color={brand ? colors.accent : colors.textSecondary}
          />
          <Text
            style={[styles.toolChipText, !!brand && styles.toolChipTextSet]}
            numberOfLines={1}
          >
            {brand || 'Brand'}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[
            styles.toolChip,
            activePanel === 'variant' && styles.toolChipActive,
            !!variant && styles.toolChipSet,
          ]}
          onPress={() => togglePanel('variant')}
          activeOpacity={interaction.activeOpacity}
          accessibilityRole="button"
          accessibilityLabel={`Variant${variant ? `: ${variant}` : ''}`}
        >
          <Ionicons
            name="layers-outline"
            size={iconSize.sm}
            color={variant ? colors.accent : colors.textSecondary}
          />
          <Text
            style={[styles.toolChipText, !!variant && styles.toolChipTextSet]}
            numberOfLines={1}
          >
            {variant || 'Variant'}
          </Text>
        </TouchableOpacity>
      </View>

      {activePanel !== null && (
        <View style={styles.attributePanel}>
          <Ionicons
            name={activePanel === 'brand' ? 'pricetag-outline' : 'layers-outline'}
            size={16}
            color={colors.textSecondary}
          />
          <TextInput
            style={styles.attributeInput}
            value={activePanel === 'brand' ? brand : variant}
            onChangeText={activePanel === 'brand' ? setBrand : setVariant}
            placeholder={activePanel === 'brand' ? 'Any brand' : 'e.g. low fat, 4%, crunchy'}
            placeholderTextColor={colors.textTertiary}
            autoCorrect={false}
            autoCapitalize="words"
            returnKeyType="done"
            onSubmitEditing={() => setActivePanel(null)}
            maxLength={activePanel === 'brand' ? GROCERY_BRAND_MAX_LENGTH : GROCERY_VARIANT_MAX_LENGTH}
            accessibilityLabel={activePanel === 'brand' ? 'Brand' : 'Variant'}
            autoFocus
          />
          {!!(activePanel === 'brand' ? brand : variant) && (
            <TouchableOpacity
              onPress={() => (activePanel === 'brand' ? setBrand('') : setVariant(''))}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel={`Clear ${activePanel}`}
            >
              <Ionicons name="close-circle" size={18} color={colors.textTertiary} />
            </TouchableOpacity>
          )}
        </View>
      )}

      {/* Out of flow, and that's the fix rather than a layout preference. The
          sheet holding this field centres its card, so anything that grows
          *under* the field pushes the field itself up — half the growth goes
          each way. Typing "s" put three matches on screen and moved the field
          out from under the cursor mid-word; a token chip appearing at the
          fourth character did it again by a smaller amount. Absolute here, the
          field is nailed to the top of the card and everything the typing
          reveals opens downwards over the backdrop. It carries its own surface
          because it is no longer inside the card's rounded rect. */}
      {hasResults && (
      <View style={[styles.results, { top: resultsTop }]}>
      {/* Live preview of the split commit would produce, so it's a visible
          decision rather than something the parser did silently. Each token
          it pulled out of the text gets its own chip; tapping × keeps that
          exact piece in the name instead — see resolveGroceryTokens. */}
      {hasTokenChips && (
        <View style={styles.tokenRow}>
          <View style={styles.tokenChips}>
            {tokens.quantityAccepted && (
              <View style={styles.tokenChip}>
                <Text style={styles.tokenChipText}>{tokens.quantity}</Text>
                <TouchableOpacity
                  onPress={() => { haptics.tap(); setRejectedQuantity(tokens.quantity); }}
                  hitSlop={8}
                  accessibilityRole="button"
                  accessibilityLabel={`Keep "${tokens.quantity}" in the name instead of the quantity`}
                >
                  <Ionicons name="close" size={11} color={colors.textTertiary} />
                </TouchableOpacity>
              </View>
            )}
            {tokens.prepAccepted && (
              <View style={styles.tokenChip}>
                <Text style={styles.tokenChipText}>{tokens.prep}</Text>
                <TouchableOpacity
                  onPress={() => { haptics.tap(); setRejectedPrep(tokens.prep); }}
                  hitSlop={8}
                  accessibilityRole="button"
                  accessibilityLabel={`Keep "${tokens.prep}" in the name instead of splitting it out`}
                >
                  <Ionicons name="close" size={11} color={colors.textTertiary} />
                </TouchableOpacity>
              </View>
            )}
            {tokens.purposeAccepted && (
              <View style={styles.tokenChip}>
                <Text style={styles.tokenChipText}>for {tokens.purpose}</Text>
                <TouchableOpacity
                  onPress={() => { haptics.tap(); setRejectedPurpose(tokens.purpose); }}
                  hitSlop={8}
                  accessibilityRole="button"
                  accessibilityLabel={`Keep "for ${tokens.purpose}" in the name instead of making it a note`}
                >
                  <Ionicons name="close" size={11} color={colors.textTertiary} />
                </TouchableOpacity>
              </View>
            )}
          </View>
          <Text style={styles.tokenPreview} numberOfLines={1}>
            Adding “{tokens.name}”
          </Text>
        </View>
      )}

      {/* "pepper or thyme" wants to be two rows, not one catalog entry nothing
          can ever match — see splitAlternativeNames. Offered rather than
          applied on its own, since the split is verbatim. */}
      {!!alternatives && (
        <TouchableOpacity
          style={styles.altSuggestion}
          activeOpacity={interaction.activeOpacity}
          onPress={acceptAlternatives}
          accessibilityRole="button"
          accessibilityLabel={
            `Add as an either/or: ${alternatives.join(' or ')}. ` +
            'Both go on the list and checking one off takes the others off.'
          }
        >
          <Text style={styles.altSuggestionText}>
            Add as either/or — {alternatives.join(' or ')}?
          </Text>
          <Text style={styles.altSuggestionHint}>
            Tick one at the store and the rest come off.
          </Text>
        </TouchableOpacity>
      )}

      {!!status && <Text style={styles.status}>{status}</Text>}

      {suggestions.length > 0 && (
        <View style={styles.matches}>
          <ScrollView keyboardShouldPersistTaps="handled" style={styles.matchesScroll}>
            {suggestions.map(({ item, onList }) => {
              // Which one to reach for, on the row that offers it. The catalog
              // has carried a brand and a variant for a while and this — the
              // one screen where you pick an item by name — was still showing
              // the bare name, so "Oatly oat milk" and plain oat milk looked
              // like the same row until it was already on the list.
              const product = describeProduct(item);
              return (
                <TouchableOpacity
                  key={item.id}
                  style={styles.suggestion}
                  activeOpacity={interaction.activeOpacity}
                  onPress={() => commit(item.name)}
                  accessibilityRole="button"
                  accessibilityLabel={
                    [`Add ${item.name}`, product, item.aisle, onList ? 'already on the list' : null]
                      .filter(Boolean).join(', ')
                  }
                >
                  <View style={styles.suggestionBody}>
                    <Text style={styles.suggestionName} numberOfLines={1}>{item.name}</Text>
                    {!!product && (
                      <Text style={styles.suggestionProduct} numberOfLines={1}>{product}</Text>
                    )}
                  </View>
                  <Text style={styles.suggestionAisle} numberOfLines={1}>{item.aisle}</Text>
                  {onList && (
                    <View style={styles.onListPill}>
                      <Text style={styles.onListText}>On list</Text>
                    </View>
                  )}
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        </View>
      )}
      </View>
      )}
    </View>
  );
});

function makeStyles(colors: Colors) {
  return StyleSheet.create({
    wrap: {
      // No gap: the field, toolbar and attribute panel space themselves with
      // their own margins, and `results` hangs off all three at a computed
      // offset rather than sitting in flow after them.
      position: 'relative',
    },
    // Pinned under everything static above it rather than stacked after it —
    // see the note at the call site. `top` is passed in per-render as
    // `resultsTop`, since it now also depends on whether the attribute panel
    // is open; the constants it's built from stay in step with what's
    // actually rendered above for the same reason FIELD_HEIGHT does.
    results: {
      position: 'absolute',
      left: 0,
      right: 0,
      gap: spacing.xs,
      backgroundColor: colors.bgSecondary,
      borderRadius: radius.md,
      padding: spacing.sm,
    },
    toolbar: {
      flexDirection: 'row',
      gap: spacing.xs,
      marginTop: spacing.sm,
    },
    toolChip: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      paddingHorizontal: spacing.md,
      minHeight: interaction.pillHeight,
      borderRadius: radius.full,
      backgroundColor: colors.bgTertiary,
    },
    toolChipActive: {
      backgroundColor: colors.bgQuaternary,
    },
    toolChipSet: {
      backgroundColor: colors.accentSubtle,
    },
    toolChipText: {
      color: colors.textSecondary,
      fontSize: font.sm,
      fontWeight: fontWeight.medium,
      maxWidth: 130,
    },
    toolChipTextSet: {
      color: colors.accent,
    },
    attributePanel: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
      height: ATTRIBUTE_PANEL_HEIGHT,
      marginTop: spacing.sm,
      paddingHorizontal: spacing.xs,
    },
    attributeInput: {
      flex: 1,
      color: colors.text,
      fontSize: font.sm,
      borderBottomWidth: border.sm,
      borderBottomColor: colors.accent,
      paddingVertical: 4,
    },
    field: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
      height: FIELD_HEIGHT,
      // Tertiary, not secondary: the sheet card behind it is already secondary,
      // and a field the same colour as its card is a field you can't see.
      backgroundColor: colors.bgTertiary,
      borderRadius: radius.md,
      borderWidth: border.sm,
      borderColor: 'transparent',
      paddingHorizontal: spacing.md,
    },
    fieldFocused: {
      borderColor: colors.accent,
    },
    input: {
      flex: 1,
      fontSize: font.lg,
      color: colors.text,
      // Never lineHeight on a TextInput: RN maps it onto the iOS paragraph
      // style with no baseline compensation, so the glyphs sit low in the box
      // while the caret stays centred. A fixed height is the way to pin the
      // row height instead.
      height: 48,
      padding: 0,
    },
    altSuggestion: {
      backgroundColor: colors.accentSubtle,
      borderRadius: radius.md,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
      marginLeft: spacing.xs,
    },
    altSuggestionText: {
      fontSize: font.sm,
      fontWeight: fontWeight.medium,
      color: colors.accent,
    },
    // What the offer actually does, in one line. Without it "either/or" is a
    // word the user has to take on trust before tapping something that writes
    // two rows.
    altSuggestionHint: {
      fontSize: font.xs,
      color: colors.textTertiary,
      marginTop: 2,
    },
    status: {
      fontSize: font.sm,
      color: colors.textSecondary,
      marginLeft: spacing.xs,
    },
    tokenRow: {
      flexDirection: 'row',
      alignItems: 'center',
      flexWrap: 'wrap',
      gap: spacing.xs,
      marginLeft: spacing.xs,
    },
    tokenChips: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: spacing.xs,
    },
    tokenChip: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
      backgroundColor: colors.accentSubtle,
      borderRadius: radius.full,
      paddingLeft: spacing.sm,
      paddingRight: 6,
      paddingVertical: 3,
    },
    tokenChipText: {
      fontSize: font.xs,
      fontWeight: fontWeight.medium,
      color: colors.accent,
    },
    tokenPreview: {
      flex: 1,
      fontSize: font.xs,
      color: colors.textTertiary,
    },
    matches: {
      backgroundColor: colors.bgTertiary,
      borderRadius: radius.md,
      overflow: 'hidden',
    },
    matchesScroll: {
      // Four rows before it scrolls. Sized against the smallest screen the app
      // runs on rather than the roomiest: the block hangs off a card 64pt from
      // the top and opens downward, so on an SE with the keyboard up this is
      // what keeps the last match above it. Five matches is the cap
      // rankGrocerySuggestions applies anyway, so the fifth is one short scroll.
      maxHeight: 176,
    },
    suggestion: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
      paddingVertical: 12,
      paddingHorizontal: spacing.md,
      borderBottomWidth: border.thin,
      borderBottomColor: colors.separator,
    },
    suggestionBody: {
      flex: 1,
      gap: 1,
    },
    suggestionName: {
      fontSize: font.md,
      fontWeight: fontWeight.medium,
      color: colors.text,
    },
    // The same clause GroceryRow puts under a name on the list, in the same
    // words — describeProduct owns the wording so the two can't drift.
    suggestionProduct: {
      fontSize: font.xs,
      color: colors.textSecondary,
    },
    suggestionAisle: {
      fontSize: font.xs,
      color: colors.textTertiary,
    },
    onListPill: {
      backgroundColor: colors.accentSubtle,
      borderRadius: radius.full,
      paddingHorizontal: spacing.sm,
      paddingVertical: 2,
    },
    onListText: {
      fontSize: font.xs,
      fontWeight: fontWeight.semibold,
      color: colors.accent,
    },
  });
}
