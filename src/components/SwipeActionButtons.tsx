import React, { useContext } from 'react';
import { TouchableOpacity, StyleSheet } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { RowHoverContext, type SelectAction, type UndoAction, type WhenAction } from './SwipeableRow';
import { useSettingsStore } from '../store/useSettingsStore';
import { PointerView } from './PointerView';
import { useColors } from '../theme/ThemeContext';
import { iconSize, spacing } from '../theme';
import { haptics } from '../utils/haptics';

interface Props {
  /** The row's swipe-right "when" action. Omit where the row has none, or where another button already does it. */
  whenAction?: WhenAction;
  /** A finished record's swipe-left undo, shown in place of `selectAction`. */
  undoAction?: UndoAction;
  /** The row's swipe-left action: enter bulk editing with this row selected. */
  selectAction?: SelectAction;
  /**
   * False hides the buttons, for the same states that turn the row's swipe off
   * (selection mode, a drag): pass the row's `SwipeableRow` `enabled`.
   */
  enabled?: boolean;
}

/**
 * A row's swipe actions as plain buttons, for iPhone Mirroring
 * (`mirroringMode`). From a Mac a swipe is a click-drag nobody would think to
 * try, and the select swipe is the only way into bulk editing from most rows.
 *
 * **Pass it the same action objects the row's `SwipeableRow` gets**, built
 * once, so a button can't offer something the swipe wouldn't. It renders
 * nothing while the mode is off or `enabled` is false, so a call site needs no
 * gate of its own. Put it last in the row's trailing controls: the select
 * button sits where `SelectionDot` appears once selection starts.
 *
 * Buttons rather than a "…" menu, deliberately: half the rows that use it
 * already have a "…" of their own (edit, or a row menu), and a second one
 * beside it would be two identical glyphs doing different things. Each icon
 * is the one its swipe panel shows, except select: the panel's
 * ellipsis-in-a-circle sits too close to those "…" buttons, so it's the empty
 * radio ring the row turns into once it's selectable, drawn smaller and
 * dimmer than `SelectionDot` so a list doesn't look mid-selection at rest.
 *
 * **On a Mac they wait for the pointer** (`RowHoverContext`): drawn only while
 * it is over the row, the way a Mac list shows a row's controls. They keep
 * their space while hidden, so a title never re-wraps and the rows below never
 * move as the pointer passes down the list.
 */
export function SwipeActionButtons({ undoAction, whenAction, selectAction, enabled = true }: Props) {
  const colors = useColors();
  const mirroringMode = useSettingsStore(s => s.mirroringMode);
  const hovered = useContext(RowHoverContext);
  if (!mirroringMode || !enabled) return null;
  const buttonStyle = hovered === false ? [styles.button, styles.hidden] : styles.button;

  return (
    <>
      {undoAction ? (
        <PointerView toolTip={undoAction.accessibilityLabel}>
          <TouchableOpacity
            onPress={() => { haptics.tap(); undoAction.onUndo(); }}
            hitSlop={8}
            style={buttonStyle}
            accessibilityRole="button"
            accessibilityLabel={undoAction.accessibilityLabel}
          >
            <Ionicons name="arrow-undo-outline" size={iconSize.sm} color={colors.textSecondary} />
          </TouchableOpacity>
        </PointerView>
      ) : whenAction ? (
        <PointerView toolTip={whenAction.accessibilityLabel}>
          <TouchableOpacity
            onPress={() => { haptics.tap(); whenAction.onAction(); }}
            hitSlop={8}
            style={buttonStyle}
            accessibilityRole="button"
            accessibilityLabel={whenAction.accessibilityLabel}
          >
            <Ionicons name={outlineOf(whenAction.icon ?? 'time')} size={iconSize.sm} color={colors.textSecondary} />
          </TouchableOpacity>
        </PointerView>
      ) : null}
      {selectAction && (
        <PointerView toolTip={selectAction.accessibilityLabel}>
          <TouchableOpacity
            // No tap of its own: onSelect enters selection mode, which fires a
            // heavy impact (useRowSelection), and the two landed together.
            onPress={selectAction.onSelect}
            hitSlop={8}
            style={buttonStyle}
            accessibilityRole="button"
            accessibilityLabel={selectAction.accessibilityLabel}
          >
            <Ionicons name="radio-button-off" size={iconSize.sm} color={colors.textTertiary} />
          </TouchableOpacity>
        </PointerView>
      )}
    </>
  );
}

/**
 * The outline variant of a panel's filled glyph ("time" → "time-outline"):
 * the panels draw on a coloured fill, these buttons on the row itself, where
 * the row's other trailing icons are all outlines.
 */
function outlineOf(name: keyof typeof Ionicons.glyphMap): keyof typeof Ionicons.glyphMap {
  if (name.endsWith('-outline')) return name;
  const outline = `${name}-outline`;
  return outline in Ionicons.glyphMap ? (outline as keyof typeof Ionicons.glyphMap) : name;
}

const styles = StyleSheet.create({
  button: {
    padding: spacing.xs,
  },
  hidden: {
    opacity: 0,
  },
});
