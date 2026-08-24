import React from 'react';
import {
  Modal,
  View,
  ScrollView,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useKeyboardInsetScroll } from '../hooks/useKeyboardInsetScroll';

interface Props {
  visible: boolean;
  onRequestClose: () => void;
  // Fires once the Modal's own present animation finishes — the reliable
  // signal for imperatively focusing a field that stays mounted across
  // visibility toggles (autoFocus only fires on mount, not on becoming
  // visible again), instead of guessing how long the animation takes.
  onShow?: () => void;
  // Kept per-file rather than folded into this component — root/scroll/
  // scrollContent (and the header row's own style) genuinely differ between
  // editors (e.g. scrollContent's bottom padding), so each caller passes its
  // own styles object through.
  rootStyle: StyleProp<ViewStyle>;
  headerStyle: StyleProp<ViewStyle>;
  scrollStyle: StyleProp<ViewStyle>;
  scrollContentStyle: StyleProp<ViewStyle>;
  header: React.ReactNode;
  children: React.ReactNode;
  // Content rendered after the ScrollView, outside the scrollable area —
  // TaskEditor and ProjectEditor hang picker sheets here.
  footer?: React.ReactNode;
  // Stood down while a row inside is mid-drag (SortableList's
  // onDragStateChange) — a JS responder nested inside a ScrollView doesn't
  // stop it from claiming the touch, so the scroll has to disable itself.
  // Defaults to true; only the editors with a draggable row list pass this.
  scrollEnabled?: boolean;
}

/**
 * The Modal + header row + ScrollView shell every editor sheet (TaskEditor,
 * TaskGroupEditor, ProjectEditor, TemplateEditor, TemplateItemEditor) opens
 * with — see issue #758 for the byte-identical lines this replaces.
 *
 * ## Why this is `fullScreen` and not the page sheet it used to be (#1182)
 *
 * A page sheet is presented by a `UISheetPresentationController`, which owns
 * the pull-down dismissal pan — on its *container* view, an ancestor of the
 * modal's content. Every RN `Modal` gets its own touch handler attached to the
 * modal view controller's root view (`RCTFabricModalHostViewController`), and
 * that handler **destroys its own in-flight touches** the moment it has to
 * arbitrate with a recognizer from outside that view
 * (`RCTSurfaceTouchHandler`'s `canBePreventedByGestureRecognizer` → `![other.view
 * isDescendantOfView:self.view]` → `_cancelTouches`). RN does it deliberately,
 * for native recognizers "like iOS 13 modals that can be pulled down".
 *
 * So every JS drag inside an editor died: the row lifted, followed the finger
 * for a moment, then snapped back on `onPanResponderTerminate`. Both directions,
 * because UIKit asks about simultaneous recognition while both recognizers are
 * still merely *tracking* — the sheet's pan need never begin, and on an upward
 * drag nothing visibly moved at all.
 *
 * **`scrollEnabled` can't save it, and don't go back to trying.** Fabric's
 * `RCTScrollViewComponentView._shouldDisableScrollInteraction` walks the scroll
 * view's *ancestors*, so a JS responder inside it never makes it stand down —
 * switching the scroll off is genuinely required (see `SortableList`), but an
 * iOS sheet defers its dismissal pan to the sheet's scroll view, so switching it
 * off is also what frees that pan to arbitrate immediately. Scroll on, the
 * scroll cancels the touch; scroll off, the sheet does. Inside a page sheet the
 * drag loses both ways, which is why three audits of the wiring found nothing.
 *
 * What that costs: swipe-down-to-close (every editor already has Done in its
 * header, and closing that way skipped the save), and the inset card look. What
 * it buys is that every drag in every editor works at all.
 */
export function EditorSheet({
  visible,
  onRequestClose,
  onShow,
  rootStyle,
  headerStyle,
  scrollStyle,
  scrollContentStyle,
  header,
  children,
  footer,
  scrollEnabled = true,
}: Props) {
  const insets = useSafeAreaInsets();
  // Gives the ScrollView itself a correct bottom inset for the focused field
  // (`automaticallyAdjustKeyboardInsets`) instead of a `KeyboardAvoidingView`
  // padding the whole sheet — the same pattern every other keyboard-heavy
  // list/sheet in the app already uses (`ReorderableList`, `GroceryItemSheet`,
  // …; see the hook's own doc comment). `KeyboardAvoidingView`'s `padding`
  // behavior used to sit here and fought this ScrollView's own native
  // keyboard handling: both react to the same keyboard-show event, and the
  // combination could over-scroll the sheet — a small field near the top
  // scrolling far past where it needed to, occasionally all the way to the
  // bottom of the content. One mechanism owning the adjustment fixes that.
  const keyboardScroll = useKeyboardInsetScroll<ScrollView>();

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="fullScreen"
      onRequestClose={onRequestClose}
      onShow={onShow}
    >
      <View style={rootStyle}>
        {/*
          The page sheet used to start below the status bar for us. Held on a
          wrapper rather than folded into headerStyle because each editor passes
          its own header padding, and this has to be added to whatever that is
          rather than replace it. No background of its own — it sits on the
          root's, which is what the header sat on before.
        */}
        <View style={{ paddingTop: insets.top }}>
          <View style={headerStyle}>{header}</View>
        </View>

        <ScrollView
          ref={keyboardScroll.ref}
          style={scrollStyle}
          scrollEnabled={scrollEnabled}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={scrollContentStyle}
          {...keyboardScroll.props}
        >
          {children}
        </ScrollView>

        {footer}
      </View>
    </Modal>
  );
}
