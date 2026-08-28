import React, { useMemo, useState } from 'react';
import { Platform, View, Text, TextInput, TouchableOpacity, StyleSheet } from 'react-native';
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
  checkboxRadius,
  type Colors,
} from '../theme';
import { useGroceryStore } from '../store/useGroceryStore';
import { useSettingsStore } from '../store/useSettingsStore';
import { GROCERY_NAME_MAX_LENGTH, type GroceryItem, type ItemProduct } from '../types';
import { SwipeableRow } from './SwipeableRow';
import { InlineAction } from './InlineAction';
import { NumberPadAccessory, NUMBER_PAD_ACCESSORY_ID } from './NumberPadAccessory';
import { convertQuantity } from '../utils/unitConvert';
import { describeProduct, RATING_LABELS } from '../utils/groceryProduct';
import { formatPrice, formatPriceInput, parsePriceInput, priceToInput } from '../utils/groceryPrice';
import { haptics } from '../utils/haptics';

// Matches GroceryItemSheet's own price field — "10000.00" is the longest a
// price this app allows (GROCERY_PRICE_MINOR_MAX) ever renders as.
const PRICE_INPUT_MAX_LENGTH = 8;

const CHECKBOX_SIZE = 24;
// Generous beyond the visual box, matching TaskItem's checkbox hitSlop —
// checking things off quickly while shopping must not get harder now that
// the checkbox is a smaller target than the whole row used to be.
const CHECKBOX_HIT_SLOP = { top: 12, bottom: 12, left: 12, right: 12 };

interface Props {
  item: GroceryItem;
  /**
   * The one of this item's products the row is asking for, if any — see
   * GroceryItem.preferredProductId. Undefined is the common "no opinion" case.
   */
  product?: ItemProduct;
  onToggle: (id: string) => void;
  onEdit: (id: string) => void;
  /** Long-press starts a drag when given (see GroceryScreen); tap still toggles. */
  drag?: () => void;
  /** True on the copy rendered inside the floating drag card. */
  isActive?: boolean;
  /** While true, a tap selects instead of toggling, and neither drag nor edit fires. */
  selectionMode?: boolean;
  selected?: boolean;
  onSelect?: (id: string) => void;
  /**
   * Swipe left to enter bulk selection with this row pre-selected — the same
   * entry point tasks use (#1378). No `whenAction`: rescheduling has no
   * meaning for a shopping-list line.
   */
  onSwipeSelect?: (id: string) => void;
  /**
   * Opens this item straight into its Substitutes field ("what can I use
   * instead?", #1578). A recipe ingredient row reaches the same field by
   * tapping the row at all, so it earns no glyph of its own — this row's tap
   * renames inline instead, which buys nothing, so the glyph is what makes
   * the field reachable without going through the ellipsis first.
   */
  onOpenSubstitutes?: (id: string) => void;
  /**
   * "or pears" — this row's live either/or siblings, computed by the screen
   * (only it has the whole list) and absent for an ordinary row. Its own line
   * rather than folded into the note: at the shelf it's the difference between
   * buying one of these and buying all of them.
   */
  alternatives?: string;
  /**
   * "For “Change the water filter”" — the task whose supply this row is kept
   * stocked for, computed by the screen (only it can reach the task list) and
   * absent for every ordinary row.
   *
   * Provenance, and it shares the recipe caption's slot and suppression rules
   * rather than taking a sixth line: they answer the same question, and a row
   * carrying both would be spending two lines on where it came from at a shelf
   * where neither is what you're there to read.
   */
  stockedFor?: string;
  /**
   * "Usually Trader Joe's" — what this row has to say about the store you're
   * standing in, computed by the screen (only it knows the trip) and absent
   * both when no trip is running and on the rows the store already covers.
   * See utils/activeTrip.ts for why silence is the common case.
   */
  storeMarker?: string;
  /**
   * The substitute named in `storeMarker`'s "· or margarine" clause, present
   * only when `storeMarker` is an `unavailable` marker carrying one (see
   * TripMarker.substitute). Its presence is what makes the caption itself
   * tappable — every other marker stays inert text.
   */
  swapSubstituteId?: string;
  /** Tap the "· or margarine" clause: swap this item for that substitute. */
  onSwapForSubstitute?: (itemId: string, subItemId: string) => void;
  /**
   * What this item costs at the active trip's store, computed by the screen
   * (only it knows the trip and the item→shop links) — same hand-down as
   * `storeMarker`, and for the same reason: this row is memoised, and reading
   * itemShops here would re-render every row on any store write. Present
   * (possibly `null`, meaning no price known yet) only while a trip is
   * running and this row is checked; absent otherwise, which is what hides
   * the chip below entirely.
   */
  tripPriceMinor?: number | null;
  /**
   * Whether `tripPriceMinor` was actually set during *this* trip, as opposed
   * to being carried over from an earlier one — see `pricedSince`. Decides
   * whether the chip reads as an already-recorded value or an unconfirmed
   * guess worth checking.
   */
  tripPriceRecorded?: boolean;
  /**
   * Commits a price typed into the trip chip. `null` clears whatever price
   * was there — the screen resolves that to `setItemPrice`/`clearItemShopPrice`
   * against the trip's shop, since only it knows which one that is.
   */
  onSetTripPrice?: (id: string, minor: number | null) => void;
}

/**
 * One line of the shopping list.
 *
 * Built for a hand holding a trolley: the whole row is the checkbox, the type
 * is a size up from a task row, and the box is 24pt rather than TaskItem's 20.
 * Long-press drags the row to another spot or another aisle; everything else is
 * behind the item sheet, reached by the trailing ellipsis, because a mis-swipe
 * in a supermarket aisle is a worse failure than an extra tap.
 *
 * Long-press used to open that sheet. It now drags, which is why the ellipsis
 * is not optional decoration — it is the only way in to editing, and the reason
 * moving the gesture cost nothing.
 *
 * Deliberately TouchableOpacity rather than PressableScale: this is a
 * full-width list row, and scaling one of those looks wrong (same rule
 * TaskItem follows). SwipeableRow now wraps it with only a select action
 * (#1378) — no `whenAction`, since there's nothing time-shaped to reschedule
 * on a shopping-list line, and the panel this component used to worry about
 * revealing as a no-op is simply never rendered when `whenAction` is omitted.
 */
export const GroceryRow = React.memo(function GroceryRow({
  item,
  product: preferredProduct,
  onToggle,
  onEdit,
  drag,
  isActive = false,
  selectionMode = false,
  selected = false,
  onSelect,
  onSwipeSelect,
  onOpenSubstitutes,
  alternatives,
  stockedFor,
  storeMarker,
  swapSubstituteId,
  onSwapForSubstitute,
  tripPriceMinor,
  tripPriceRecorded = false,
  onSetTripPrice,
}: Props) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const renameItem = useGroceryStore(s => s.renameItem);
  const unitSystem = useSettingsStore(s => s.unitSystem);
  const currencySymbol = useSettingsStore(s => s.currencySymbol);

  // The row is read-only text, so it shows the amount in the reader's units.
  // The item sheet's field deliberately doesn't — that one is editable, and an
  // editable field has to show what's stored.
  const shownQuantity = convertQuantity(item.quantity ?? '', unitSystem).text;

  // Tapping the name/quantity/star area used to toggle checked, same as the
  // rest of the row. Issue #1222: that's the only way in, so it now swaps the
  // name into an inline TextInput instead — the checkbox (its own zone below)
  // is what toggles checked now.
  const [renaming, setRenaming] = useState(false);
  const [draftName, setDraftName] = useState(item.name);

  // The trip price chip's own inline edit, same shape as renaming above:
  // tapping the chip swaps it for a TextInput, blurring or submitting
  // commits. Kept in this row rather than lifted to the screen because it's
  // purely a transient "am I mid-edit" flag with no bearing on any other row.
  const [pricingActive, setPricingActive] = useState(false);
  const [draftPrice, setDraftPrice] = useState('');

  const startPricing = () => {
    setDraftPrice(tripPriceMinor != null ? priceToInput(tripPriceMinor) : '');
    setPricingActive(true);
  };

  const commitPrice = () => {
    // Mirrors GroceryItemSheet's own commitPrice: blank clears an existing
    // price, an unparseable typo is left alone rather than treated as a
    // clear, and a price unchanged from what's already there writes nothing.
    if (!pricingActive) return;
    setPricingActive(false);
    const trimmed = draftPrice.trim();
    if (!trimmed) {
      if (tripPriceMinor != null) onSetTripPrice?.(item.id, null);
      return;
    }
    const parsed = parsePriceInput(trimmed);
    if (parsed !== null && parsed !== tripPriceMinor) onSetTripPrice?.(item.id, parsed);
  };

  // Brand and variant name one product, so they compose into one caption line
  // rather than taking one each — a fifth treatment on a row that can already
  // be four captions tall is past what's readable while walking. See
  // describeProduct for the wording rules.
  //
  // Resolved by the screen and handed down rather than looked up here: this
  // row is memoised, and reading the products array in it would re-render
  // every row on the list whenever any item's products changed.
  const product = describeProduct(preferredProduct);

  const label = [
    item.name,
    // Before the quantity, matching the caption order on screen — and read out
    // at all, since a row whose whole point is "this brand" would otherwise
    // announce identically to one with no preference set.
    product ? `, ${product}` : '',
    // Right behind the product it rates — see the icon on the same line below.
    preferredProduct?.rating ? `, ${RATING_LABELS[preferredProduct.rating].toLowerCase()}` : '',
    shownQuantity ? `, ${shownQuantity}` : '',
    item.checked ? ', in cart' : '',
  ].join('');

  const startRename = () => {
    if (selectionMode) {
      onSelect?.(item.id);
      return;
    }
    setDraftName(item.name);
    setRenaming(true);
  };

  const commitRename = () => {
    // onSubmitEditing fires onBlur right behind it (submitting blurs the
    // field), and unmounting the TextInput on the way out fires onBlur again
    // — guard so a single edit only ever writes once.
    if (!renaming) return;
    setRenaming(false);
    const trimmed = draftName.trim();
    // Empty or unchanged is a no-op, not a rename — nothing to write, and
    // reverting silently is friendlier than an error for "changed my mind".
    if (!trimmed || trimmed === item.name) return;
    // A collision reverts to the old name the same way a no-op does — there's
    // no room on the row for GroceryItemSheet's persistent nameError — but it
    // still needs to say something happened, or a real rename attempt looks
    // identical to changing your mind.
    if (!renameItem(item.id, trimmed)) haptics.error();
  };

  const rowBody = (
    <View
      style={[
        styles.row,
        selectionMode && selected && styles.rowSelected,
      ]}
    >
      <TouchableOpacity
        onPress={() => (selectionMode ? onSelect?.(item.id) : onToggle(item.id))}
        onLongPress={selectionMode ? undefined : drag ?? (() => onEdit(item.id))}
        delayLongPress={interaction.delayLongPress}
        hitSlop={CHECKBOX_HIT_SLOP}
        accessibilityRole="checkbox"
        accessibilityState={{ checked: selectionMode ? selected : item.checked }}
        accessibilityLabel={label}
        accessibilityHint={
          selectionMode
            ? selected ? 'Double tap to deselect' : 'Double tap to select'
            : drag ? 'Long press to move to another aisle' : 'Long press to edit'
        }
      >
        <View
          style={[
            styles.checkbox,
            selectionMode ? selected && styles.checkboxSelected : item.checked && styles.checkboxChecked,
          ]}
        >
          {(selectionMode ? selected : item.checked) && (
            <Ionicons name="checkmark" size={iconSize.sm} color={colors.onAccent} />
          )}
        </View>
      </TouchableOpacity>

      <TouchableOpacity
        style={styles.tapZone}
        activeOpacity={interaction.activeOpacity}
        onPress={startRename}
        onLongPress={selectionMode ? undefined : drag ?? (() => onEdit(item.id))}
        delayLongPress={interaction.delayLongPress}
        accessibilityRole={selectionMode ? 'checkbox' : 'button'}
        accessibilityState={selectionMode ? { checked: selected } : undefined}
        accessibilityLabel={selectionMode ? label : `Rename ${item.name}`}
        accessibilityHint={
          selectionMode
            ? selected ? 'Double tap to deselect' : 'Double tap to select'
            : 'Double tap to rename'
        }
      >
        <View style={styles.body}>
          {renaming ? (
            <TextInput
              style={styles.nameInput}
              value={draftName}
              onChangeText={setDraftName}
              onBlur={commitRename}
              onSubmitEditing={commitRename}
              autoFocus
              selectTextOnFocus
              maxLength={GROCERY_NAME_MAX_LENGTH}
              returnKeyType="done"
              accessibilityLabel="Item name"
            />
          ) : (
            <Text
              style={[styles.name, item.checked && styles.nameChecked]}
              numberOfLines={1}
            >
              {item.name}
            </Text>
          )}
          {/* First and never suppressed, because it is the one caption that
              changes which box leaves the shelf. Deliberately its own line
              rather than trailing the name: the name is numberOfLines={1} and
              flexes against the quantity pill, so on anything longer than
              "cottage cheese" an inline brand is the first thing truncated
              away — losing exactly the word the row was captioned for. The
              variant rides on this same line for the same reason it can't
              afford its own: a branded, varianted, noted row with a store
              marker would be six lines tall. */}
          {!!product && (
            <View style={styles.brandRow}>
              {/* The rating rides on the same line as the box it rates,
                  rather than a caption of its own — a row is already up to
                  four lines tall, and this is a mark on the product's name,
                  not a new fact. "Loved" and "avoid" both get one: an avoid
                  box stays on the list on purpose (see productsForItem), so
                  the whole point is seeing it here, right before you'd pick
                  the same one up again. */}
              {preferredProduct?.rating === 'loved' && (
                <Ionicons name="thumbs-up" size={iconSize.xs} color={colors.orange} />
              )}
              {preferredProduct?.rating === 'avoid' && (
                <Ionicons name="thumbs-down" size={iconSize.xs} color={colors.red} />
              )}
              <Text style={styles.brand} numberOfLines={1}>
                {product}
              </Text>
            </View>
          )}
          {!!item.note && (
            <Text style={styles.note} numberOfLines={1}>
              {item.note}
            </Text>
          )}
          {/* A note the user wrote themselves outranks this — it's their own
              word on the row, and the two together would be one caption too
              many. The recipe stays reachable by opening the row itself,
              which is where the source recipe is now shown as a link.

              The store marker outranks it too, and only it: where this came
              from is provenance, which is the least useful thing to know at a
              shelf, while "not at Safeway" is the one line that can send you
              somewhere else. A note is never suppressed — "the blue cap one"
              is shelf information, which is exactly what you're here for. */}
          {!item.note && !storeMarker && !!item.sourceRecipeTitle && (
            <Text style={styles.note} numberOfLines={1}>
              For “{item.sourceRecipeTitle}”
            </Text>
          )}
          {/* Same slot, same two suppressions, and behind the recipe stamp when
              a row somehow carries both: that stamp is about *this* add, where
              a supply is a standing arrangement that will still be true next
              week. Without this line a row put on the list by a supply is the
              only automatic add in the app that arrives with no account of
              itself, and its cause is on a different screen. */}
          {!item.note && !storeMarker && !item.sourceRecipeTitle && !!stockedFor && (
            <Text style={styles.note} numberOfLines={1}>
              {stockedFor}
            </Text>
          )}
          {/* Tappable only when the marker is carrying a substitute — every
              other marker (withoutBrand/only/usually, or unavailable with
              nothing to swap to) is inert text, same as before. Not while
              selecting: a tap there has to select the row like the rest of
              it does, not swap an item out from under the selection. */}
          {!!storeMarker && !!swapSubstituteId && !selectionMode ? (
            <TouchableOpacity
              onPress={() => onSwapForSubstitute?.(item.id, swapSubstituteId)}
              hitSlop={{ top: 6, bottom: 6, left: 0, right: 40 }}
              accessibilityRole="button"
              accessibilityLabel={`${storeMarker}. Double tap to put it on the list instead.`}
            >
              <Text style={styles.storeMarker} numberOfLines={1}>{storeMarker}</Text>
            </TouchableOpacity>
          ) : (
            !!storeMarker && (
              <Text style={styles.storeMarker} numberOfLines={1}>{storeMarker}</Text>
            )
          )}
          {!!alternatives && (
            <Text style={styles.alternatives} numberOfLines={1}>{alternatives}</Text>
          )}
        </View>

        {!!shownQuantity && (
          <View style={[styles.qtyPill, item.checked && styles.qtyPillChecked]}>
            <Text style={[styles.qtyText, item.checked && styles.qtyTextChecked]} numberOfLines={1}>
              {shownQuantity}
            </Text>
          </View>
        )}

        {/* Present only while a trip is running and this row is checked — see
            onSetTripPrice's doc comment. Hidden while selecting, same as the
            trailing icons below: a tap here has to select the row, not open
            an edit. Three states, same shape as the inline rename above:
            nothing recorded yet (an InlineAction, "add a thing" to this row),
            recorded (a plain pill, tap to correct it), and mid-edit (a
            TextInput swapped in for either). */}
        {!!onSetTripPrice && !selectionMode && (
          pricingActive ? (
            <View style={styles.priceField}>
              <Text style={styles.priceSymbol}>{currencySymbol}</Text>
              <TextInput
                style={styles.priceInput}
                value={draftPrice}
                onChangeText={text => setDraftPrice(formatPriceInput(text))}
                onBlur={commitPrice}
                onSubmitEditing={commitPrice}
                autoFocus
                keyboardType="number-pad"
                returnKeyType="done"
                inputAccessoryViewID={Platform.OS === 'ios' ? NUMBER_PAD_ACCESSORY_ID : undefined}
                placeholder="0.00"
                placeholderTextColor={colors.textTertiary}
                maxLength={PRICE_INPUT_MAX_LENGTH}
                accessibilityLabel={`Price for ${item.name}`}
              />
              {/* Mounted by the row rather than by the grocery screen, because
                  the field it belongs to is the row's own: pricingActive is
                  this row's transient mid-edit flag, and only one row is ever
                  in it (committing on blur is what ends the last one). The
                  screen would have to be told which row is editing to do the
                  same job. Several mounted copies are safe anyway — see
                  NumberPadAccessory. */}
              <NumberPadAccessory />
            </View>
          ) : tripPriceRecorded && tripPriceMinor != null ? (
            <TouchableOpacity
              onPress={startPricing}
              hitSlop={{ top: 10, bottom: 10, left: 6, right: 6 }}
              accessibilityRole="button"
              accessibilityLabel={`Price ${formatPrice(tripPriceMinor, currencySymbol)}. Double tap to change it.`}
            >
              <View style={styles.pricedPill}>
                <Text style={styles.pricedPillText} numberOfLines={1}>
                  {formatPrice(tripPriceMinor, currencySymbol)}
                </Text>
              </View>
            </TouchableOpacity>
          ) : (
            <InlineAction
              icon="pricetag-outline"
              label="Price"
              variant="neutral"
              onPress={startPricing}
              accessibilityLabel={`Add a price for ${item.name}`}
            />
          )
        )}
      </TouchableOpacity>

      {/* Tertiary grey, like the ellipsis beside it, and left of it: the
          ellipsis opens the whole item sheet, this one asks the single
          question — what can I use instead — in a sheet of its own. It used to
          open that same item sheet at its Substitutes field, which is a long
          editor in answer to a one-line question. */}
      {!selectionMode && !!onOpenSubstitutes && (
        <TouchableOpacity
          onPress={() => onOpenSubstitutes(item.id)}
          activeOpacity={interaction.activeOpacity}
          hitSlop={{ top: 12, bottom: 12, left: 8, right: 8 }}
          accessibilityRole="button"
          accessibilityLabel={`What can I use instead of ${item.name}?`}
        >
          <Ionicons name="swap-horizontal-outline" size={iconSize.sm} color={colors.textTertiary} />
        </TouchableOpacity>
      )}

      {/* Long-press still opens the same sheet, but nothing on screen says so
          — and quantity and a wrong aisle are things people genuinely fix. A
          quiet trailing target is what makes that reachable without teaching
          a gesture. Hidden while selecting: editing isn't on offer there. */}
      {!selectionMode && (
        <TouchableOpacity
          onPress={() => onEdit(item.id)}
          activeOpacity={interaction.activeOpacity}
          hitSlop={{ top: 12, bottom: 12, left: 8, right: 8 }}
          accessibilityRole="button"
          accessibilityLabel={`Edit ${item.name}`}
        >
          <Ionicons name="ellipsis-horizontal" size={iconSize.sm} color={colors.textTertiary} />
        </TouchableOpacity>
      )}
    </View>
  );

  return (
    <View
      style={[
        styles.itemWrapper,
        item.checked && styles.itemWrapperChecked,
        isActive && styles.itemWrapperActive,
      ]}
    >
      {selectionMode ? rowBody : (
        <SwipeableRow
          enabled={!isActive}
          selectAction={onSwipeSelect ? {
            onSelect: () => onSwipeSelect(item.id),
            accessibilityLabel: `Select ${item.name}`,
          } : undefined}
        >
          {rowBody}
        </SwipeableRow>
      )}
    </View>
  );
});

function makeStyles(colors: Colors) {
  return StyleSheet.create({
    // The card: margin, radius and resting background. Split from `row`
    // (below) the same way TaskItem splits itemWrapper from its row — a
    // SwipeableRow's child must render flush, with no radius or margin of its
    // own, or the swipe panel it reveals shows through the gaps around a
    // rounded, inset child instead of filling the card. No separate clip
    // layer is needed here the way TaskItem needs one: this row carries no
    // shadow, so putting overflow:hidden directly on this same wrapper (below)
    // costs nothing.
    itemWrapper: {
      backgroundColor: colors.bgSecondary,
      marginHorizontal: spacing.md,
      marginVertical: 2,
      borderRadius: radius.md,
      overflow: 'hidden',
    },
    itemWrapperActive: {
      // The lifted card, one surface brighter — the same "picked up" treatment
      // a dragged aisle gets in GroceryAislesSheet.
      backgroundColor: colors.bgTertiary,
    },
    itemWrapperChecked: {
      // The card keeps its full surface and only its *contents* mute. An
      // opacity on the whole row reads fine in dark (#1C1C1E over #000) but
      // dissolves in light, where a white card at 55% just fades into the
      // #F2F2F7 page and the row stops looking like a row.
      backgroundColor: colors.bgSunken,
    },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingVertical: 14,
      paddingHorizontal: spacing.md,
      gap: spacing.md,
      minHeight: 52,
    },
    // Takes precedence over the checked background — a selected row reads as
    // selected even inside the cart section. Applied on the inner row (not
    // itemWrapper) since it has to win over itemWrapperChecked in the same
    // array position SwipeableRow's child renders at.
    rowSelected: {
      backgroundColor: colors.accent + '1A',
    },
    checkbox: {
      width: CHECKBOX_SIZE,
      height: CHECKBOX_SIZE,
      borderRadius: checkboxRadius(CHECKBOX_SIZE),
      borderWidth: border.md,
      borderColor: colors.separator,
      alignItems: 'center',
      justifyContent: 'center',
    },
    checkboxChecked: {
      backgroundColor: colors.green,
      borderColor: colors.green,
      opacity: 0.7,
    },
    checkboxSelected: {
      backgroundColor: colors.accent,
      borderColor: colors.accent,
    },
    tapZone: {
      flex: 1,
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.md,
    },
    body: {
      flex: 1,
    },
    name: {
      fontSize: font.lg,
      fontWeight: fontWeight.medium,
      color: colors.text,
    },
    nameChecked: {
      textDecorationLine: 'line-through',
      color: colors.textSecondary,
    },
    nameInput: {
      fontSize: font.lg,
      fontWeight: fontWeight.medium,
      color: colors.text,
      padding: 0,
      // Matches the Text row's box so swapping in the input doesn't nudge
      // the row's height — see the "never lineHeight on TextInput" rule.
      height: font.lg + 6,
    },
    // The fourth caption treatment, and the loudest of them — semibold on
    // textSecondary, where `alternatives` is medium on the same colour and both
    // greys below are tertiary. The ranking is by how much the line changes
    // what you pick up: the brand and variant together decide which tub, an
    // either/or decides which of two items, the store marker sends you
    // elsewhere, a note qualifies.
    //
    // Semibold at font.sm is not new here — it's what qtyText already uses on
    // this row, so this reads as the row's existing emphasis weight rather than
    // a fifth thing. No accent tint: a coloured caption on every branded row
    // would make a list of preferences look like a list of warnings.
    brandRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.xs,
      marginTop: 1,
    },
    brand: {
      fontSize: font.sm,
      fontWeight: fontWeight.semibold,
      color: colors.textSecondary,
      flexShrink: 1,
    },
    // Upright and a step brighter than the note above it, same treatment the
    // recipe screen gives an either/or ingredient — this is a fact about what
    // to buy, not a remark about the row.
    alternatives: {
      fontSize: font.sm,
      fontWeight: fontWeight.medium,
      color: colors.textSecondary,
      marginTop: 1,
    },
    // Deliberately its own third treatment, between `note` and `alternatives`
    // — it borrows the weight of one and the colour of the other. A row can
    // carry all three at once (a noted either/or item on record elsewhere),
    // and at identical styling the captions run together into one block you
    // can't read at a glance while walking: weight separates it from the note,
    // tone from the alternatives.
    //
    // No colour of its own beyond that. "Not at Safeway" and "Usually Trader
    // Joe's" are told apart by their words, and a warning tint on a row you're
    // walking past would make the quiet version of this feature the loud one.
    storeMarker: {
      fontSize: font.sm,
      fontWeight: fontWeight.medium,
      color: colors.textTertiary,
      marginTop: 1,
    },
    note: {
      fontSize: font.sm,
      color: colors.textTertiary,
      marginTop: 2,
    },
    qtyPill: {
      backgroundColor: colors.bgTertiary,
      borderRadius: radius.sm,
      paddingHorizontal: spacing.sm,
      paddingVertical: 3,
      maxWidth: 96,
    },
    qtyPillChecked: {
      backgroundColor: 'transparent',
    },
    qtyText: {
      fontSize: font.sm,
      fontWeight: fontWeight.semibold,
      color: colors.textSecondary,
    },
    qtyTextChecked: {
      textDecorationLine: 'line-through',
      color: colors.textTertiary,
    },
    // The recorded state of the trip price chip — same geometry as qtyPill so
    // the two read as siblings, tinted with the accent the same way a set
    // value would be (this is the one thing on the row that a trip actually
    // asked the user to do, unlike the quantity beside it).
    pricedPill: {
      backgroundColor: colors.accentSubtle,
      borderRadius: radius.sm,
      paddingHorizontal: spacing.sm,
      paddingVertical: 3,
    },
    pricedPillText: {
      fontSize: font.sm,
      fontWeight: fontWeight.semibold,
      color: colors.accentText,
    },
    // The chip's own mid-edit state — small and inline rather than the item
    // sheet's full-width field, since this is a number typed in passing while
    // holding a trolley, not a form. No lineHeight (see the app-wide rule on
    // TextInput) — height instead, matching nameInput's own fix for the same
    // reason.
    priceField: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: colors.bgTertiary,
      borderRadius: radius.sm,
      paddingHorizontal: spacing.sm,
      paddingVertical: 3,
    },
    priceSymbol: {
      fontSize: font.sm,
      fontWeight: fontWeight.semibold,
      color: colors.textSecondary,
    },
    priceInput: {
      fontSize: font.sm,
      fontWeight: fontWeight.semibold,
      color: colors.text,
      padding: 0,
      height: font.sm + 6,
      minWidth: 44,
    },
  });
}
