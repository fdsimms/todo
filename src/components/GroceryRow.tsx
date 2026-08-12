import React, { useMemo, useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet } from 'react-native';
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
import { GROCERY_NAME_MAX_LENGTH, type GroceryItem } from '../types';

const CHECKBOX_SIZE = 24;
// Generous beyond the visual box, matching TaskItem's checkbox hitSlop —
// checking things off quickly while shopping must not get harder now that
// the checkbox is a smaller target than the whole row used to be.
const CHECKBOX_HIT_SLOP = { top: 12, bottom: 12, left: 12, right: 12 };

interface Props {
  item: GroceryItem;
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
   * Opens the recipe this item came from. Passed only when
   * `item.sourceRecipeId` still resolves to a live recipe — the pointer is
   * resolve-or-shrug like every other cross-row one here, and a button that
   * navigates nowhere is worse than no button. Absent, the row just names the
   * recipe in its caption as before.
   */
  onOpenRecipe?: (recipeId: string) => void;
  /**
   * "or pears" — this row's live either/or siblings, computed by the screen
   * (only it has the whole list) and absent for an ordinary row. Its own line
   * rather than folded into the note: at the shelf it's the difference between
   * buying one of these and buying all of them.
   */
  alternatives?: string;
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
 * TaskItem follows). And deliberately no SwipeableRow — its contract is
 * swipe-left = bulk select and swipe-right = "when", neither of which exists
 * here, so it would reveal panels that no-op.
 */
export const GroceryRow = React.memo(function GroceryRow({
  item,
  onToggle,
  onEdit,
  drag,
  isActive = false,
  selectionMode = false,
  selected = false,
  onSelect,
  onOpenRecipe,
  alternatives,
}: Props) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const renameItem = useGroceryStore(s => s.renameItem);

  // Tapping the name/quantity/star area used to toggle checked, same as the
  // rest of the row. Issue #1222: that's the only way in, so it now swaps the
  // name into an inline TextInput instead — the checkbox (its own zone below)
  // is what toggles checked now.
  const [renaming, setRenaming] = useState(false);
  const [draftName, setDraftName] = useState(item.name);

  const label = [
    item.name,
    item.quantity ? `, ${item.quantity}` : '',
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
    renameItem(item.id, trimmed);
  };

  return (
    <View
      style={[
        styles.row,
        item.checked && styles.rowChecked,
        isActive && styles.rowActive,
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
          {!!item.note && (
            <Text style={styles.note} numberOfLines={1}>
              {item.note}
            </Text>
          )}
          {/* A note the user wrote themselves outranks this — it's their own
              word on the row, and the two together would be one caption too
              many. The recipe stays reachable either way: the button below is
              what opens it, and it doesn't depend on this line rendering. */}
          {!item.note && !!item.sourceRecipeTitle && (
            <Text style={styles.note} numberOfLines={1}>
              recipe: {item.sourceRecipeTitle}
            </Text>
          )}
          {!!alternatives && (
            <Text style={styles.alternatives} numberOfLines={1}>{alternatives}</Text>
          )}
        </View>

        {item.favorite && !item.checked && (
          <Ionicons name="star" size={iconSize.xs} color={colors.warning} style={styles.star} />
        )}

        {!!item.quantity && (
          <View style={[styles.qtyPill, item.checked && styles.qtyPillChecked]}>
            <Text style={[styles.qtyText, item.checked && styles.qtyTextChecked]} numberOfLines={1}>
              {item.quantity}
            </Text>
          </View>
        )}
      </TouchableOpacity>

      {/* The way back to what put this on the list. A trailing glyph rather
          than a tappable caption, because the caption is inside the rename tap
          zone and gives way to the user's own note the moment they write one —
          this has to be reachable in both cases. Accent, unlike the tertiary
          ellipsis beside it: one edits this row, the other leaves for another
          screen. */}
      {!selectionMode && !!item.sourceRecipeId && !!onOpenRecipe && (
        <TouchableOpacity
          onPress={() => onOpenRecipe(item.sourceRecipeId!)}
          activeOpacity={interaction.activeOpacity}
          hitSlop={{ top: 12, bottom: 12, left: 8, right: 8 }}
          accessibilityRole="button"
          accessibilityLabel={
            item.sourceRecipeTitle
              ? `Open the recipe ${item.sourceRecipeTitle}`
              : 'Open the recipe this came from'
          }
        >
          <Ionicons name="restaurant-outline" size={iconSize.sm} color={colors.accent} />
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
});

function makeStyles(colors: Colors) {
  return StyleSheet.create({
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: colors.bgSecondary,
      marginHorizontal: spacing.md,
      marginVertical: 2,
      borderRadius: radius.md,
      paddingVertical: 14,
      paddingHorizontal: spacing.md,
      gap: spacing.md,
      minHeight: 52,
    },
    rowActive: {
      // The lifted card, one surface brighter — the same "picked up" treatment
      // a dragged aisle gets in GroceryAislesSheet.
      backgroundColor: colors.bgTertiary,
    },
    rowChecked: {
      // The card keeps its full surface and only its *contents* mute. An
      // opacity on the whole row reads fine in dark (#1C1C1E over #000) but
      // dissolves in light, where a white card at 55% just fades into the
      // #F2F2F7 page and the row stops looking like a row.
      backgroundColor: colors.bgSunken,
    },
    // Takes precedence over rowChecked in the style array — a selected row
    // reads as selected even inside the cart section.
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
    // Upright and a step brighter than the note above it, same treatment the
    // recipe screen gives an either/or ingredient — this is a fact about what
    // to buy, not a remark about the row.
    alternatives: {
      fontSize: font.sm,
      fontWeight: fontWeight.medium,
      color: colors.textSecondary,
      marginTop: 1,
    },
    note: {
      fontSize: font.sm,
      color: colors.textTertiary,
      marginTop: 2,
    },
    star: {
      marginRight: -spacing.xs,
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
  });
}
