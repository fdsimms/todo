import React, { useContext, useEffect, useRef } from 'react';
import { Animated, TouchableOpacity, StyleSheet } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { RowHoverContext, type SelectAction, type UndoAction, type WhenAction } from './SwipeableRow';
import { useSettingsStore } from '../store/useSettingsStore';
import { PointerView } from './PointerView';
import { useColors } from '../theme/ThemeContext';
import { animation, iconSize, radius, spacing } from '../theme';
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
  /**
   * Where the buttons are drawn. 'trailing' (the default) is the row's last
   * control, in line with the others. 'titleEnd' is for a row whose title is
   * squeezed by them: on a Mac they float over the end of the title and reserve
   * no room of their own, so put this inside the title's container and pair it
   * with a trailing copy that passes `overlayOnHover`. Off a Mac (no pointer to
   * wait for) it draws nothing and the trailing copy does the work.
   */
  placement?: 'trailing' | 'titleEnd';
  /**
   * On a Mac, draw nothing here: this row's `titleEnd` copy shows the buttons
   * instead. Off a Mac this copy is the only one and draws as usual.
   */
  overlayOnHover?: boolean;
  /**
   * Starts the row's drag the moment this is pressed, for a `titleEnd` copy on a
   * Mac. A drag begins on a 350ms still hold, and a mouse press that starts moving
   * sooner than that is a scroll, so a click-drag could never lift a row. Shortening
   * the hold would turn a slow click into a lifted row with the click lost, so the
   * handle is the way to grab one with a pointer. The hold still works as before.
   */
  dragHandle?: () => void;
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
 * it is over the row, the way a Mac list shows a row's controls. A trailing
 * copy keeps its space while hidden, so a title never re-wraps and the rows
 * below never move as the pointer passes down the list. A hidden button also
 * takes no touches, or a click on the empty end of a row whose hover was missed
 * (a reflow slid it under a still pointer) would land on an invisible one.
 *
 * Two buttons and the row's own controls leave a title 208pt in a 400pt list
 * pane, so the task row and the stack header draw them over the end of the
 * title instead (`placement="titleEnd"`): nothing is reserved, and nothing but
 * the title's last few characters is covered while the pointer is there.
 */
export function SwipeActionButtons({
  undoAction, whenAction, selectAction, enabled = true, placement = 'trailing', overlayOnHover = false, dragHandle,
}: Props) {
  const colors = useColors();
  const mirroringMode = useSettingsStore(s => s.mirroringMode);
  const hovered = useContext(RowHoverContext);
  const hidden = hovered === false;
  const fade = useHoverFade(hidden);
  if (!mirroringMode || !enabled) return null;
  const overlay = placement === 'titleEnd';
  const tracksHover = hovered !== null;
  // The two copies of a row's buttons split the cases between them, so exactly one is ever drawn.
  if (overlay ? !tracksHover : tracksHover && overlayOnHover) return null;

  const buttonStyle = overlay
    ? [styles.button, styles.overlayButton, { backgroundColor: colors.bgTertiary }]
    : hidden ? [styles.button, styles.hidden] : styles.button;
  // A hidden trailing button keeps its space but is not there to be clicked.
  const buttonEvents = !overlay && hidden ? 'none' : undefined;

  const buttons = (
    <>
      {overlay && dragHandle ? (
        <PointerView toolTip="Drag to reorder" pointerEvents={buttonEvents}>
          <TouchableOpacity
            // Pressed in, not pressed: the drag has to start with the button still down.
            onPressIn={dragHandle}
            hitSlop={8}
            style={buttonStyle}
            accessibilityRole="button"
            accessibilityLabel="Reorder"
            accessibilityHint="Press and drag to move this up or down the list."
          >
            <Ionicons name="reorder-two" size={iconSize.sm} color={colors.textTertiary} />
          </TouchableOpacity>
        </PointerView>
      ) : null}
      {undoAction ? (
        <PointerView toolTip={undoAction.accessibilityLabel} pointerEvents={buttonEvents}>
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
        <PointerView toolTip={whenAction.accessibilityLabel} pointerEvents={buttonEvents}>
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
        <PointerView toolTip={selectAction.accessibilityLabel} pointerEvents={buttonEvents}>
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

  if (!overlay) return buttons;
  return (
    <Animated.View
      style={[styles.overlay, { opacity: fade }]}
      pointerEvents={hidden ? 'none' : 'box-none'}
    >
      {buttons}
    </Animated.View>
  );
}

/** 1 while the pointer is over the row, 0 while it isn't, eased rather than snapped. */
function useHoverFade(hidden: boolean): Animated.Value {
  const value = useRef(new Animated.Value(hidden ? 0 : 1)).current;
  useEffect(() => {
    Animated.timing(value, {
      toValue: hidden ? 0 : 1,
      duration: animation.duration.fast,
      useNativeDriver: true,
    }).start();
  }, [hidden, value]);
  return value;
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
  // Over the end of the title, vertically centered, out of the layout entirely.
  overlay: {
    position: 'absolute',
    right: 0,
    top: 0,
    bottom: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  // Each is a chip of its own, opaque, so it reads over the title text it covers.
  overlayButton: {
    borderRadius: radius.full,
    padding: spacing.xsm,
  },
});
