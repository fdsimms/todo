import React, { useEffect, useRef, useState } from 'react';
import {
  View,
  ScrollView,
  type LayoutChangeEvent,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { SheetModal } from './SheetModal';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { KeyboardScrollIntoViewContext, useKeyboardInsetScroll } from '../hooks/useKeyboardInsetScroll';
import type { DragScroller } from '../utils/fabDrop';
import type { ScrollMetrics } from '../utils/editorJump';
import { reduceMotionEnabled } from '../utils/useReduceMotion';

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
  /**
   * The height of a bar the `footer` floats above the keyboard while a field
   * is focused (`JournalFormatBar`), so the scroll view keeps the caret clear
   * of it as well as of the keyboard. See `accessoryHeight` on
   * `useKeyboardInsetScroll`.
   */
  keyboardAccessoryHeight?: number;
  /**
   * Filled with a `DragScroller` for the sheet's own ScrollView, so a dragged
   * add button (FabDropZoneProvider's `scroller`) can scroll a long form while
   * it is aimed at a row. Omit and the scroll view tracks nothing extra.
   */
  dragScrollRef?: React.MutableRefObject<DragScroller | null>;
  /**
   * Wraps the ScrollView, for a provider that has to measure the scrolling
   * viewport rather than the content inside it (FabDropZoneProvider).
   */
  wrapScroll?: (scroll: React.ReactElement) => React.ReactNode;
  /**
   * Rendered between the header and the scroll, so it stays put while the form
   * scrolls under it (the editors' jump bar).
   */
  subheader?: React.ReactNode;
  /**
   * Told the scroll's offset and sizes whenever any of them changes, for
   * something tracking where the form is (`EditorJumpTracker`).
   */
  onScrollMetrics?: (metrics: ScrollMetrics) => void;
  /** Filled with a function that scrolls the sheet to an offset, animated unless Reduce Motion is on. */
  scrollToRef?: React.MutableRefObject<((y: number) => void) | null>;
  /**
   * Drawn where it is placed, with no Modal, as the second pane beside a list
   * (`TwoPane`) instead of a sheet over it. Nothing renders while `visible` is
   * false, and `onShow` fires when it becomes visible, since there is no
   * present animation to wait for. It is then a screen-level form like any
   * other, so a drag inside it has none of the page-sheet trouble above.
   */
  inline?: boolean;
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
  keyboardAccessoryHeight = 0,
  dragScrollRef,
  wrapScroll,
  subheader,
  onScrollMetrics,
  scrollToRef,
  inline = false,
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
  const keyboardScroll = useKeyboardInsetScroll<ScrollView>({ ownsSheet: !inline, accessoryHeight: keyboardAccessoryHeight });

  // What a DragScroller needs, kept off React state: it is read a frame at a
  // time while a drag is in flight. The offset is written back synchronously by
  // scrollToOffset, because the scroll event confirming it lands a frame later.
  const metrics = useRef({ offset: 0, content: 0, viewport: 0 });
  // The add-button drag's scroll lock, held here so flipping it re-renders the
  // sheet and not the editor that owns it (see DragScroller.setScrollLocked).
  const [fabLocked, setFabLocked] = useState(false);
  useEffect(() => {
    if (!dragScrollRef) return;
    dragScrollRef.current = {
      getOffset: () => metrics.current.offset,
      getMaxOffset: () => Math.max(0, metrics.current.content - metrics.current.viewport),
      scrollToOffset: (y: number) => {
        metrics.current.offset = y;
        keyboardScroll.ref.current?.scrollTo({ y, animated: false });
      },
      setScrollLocked: setFabLocked,
    };
    return () => { dragScrollRef.current = null; };
  }, [dragScrollRef, keyboardScroll.ref]);
  useEffect(() => {
    if (!scrollToRef) return;
    scrollToRef.current = (y: number) => {
      keyboardScroll.ref.current?.scrollTo({ y, animated: !reduceMotionEnabled() });
    };
    return () => { scrollToRef.current = null; };
  }, [scrollToRef, keyboardScroll.ref]);
  const report = () => onScrollMetrics?.({ ...metrics.current });
  const trackScroll = dragScrollRef || onScrollMetrics
    ? {
        scrollEventThrottle: 16,
        onScroll: (e: NativeSyntheticEvent<NativeScrollEvent>) => {
          keyboardScroll.noteScroll(e);
          const { contentOffset, contentSize, layoutMeasurement } = e.nativeEvent;
          metrics.current = {
            offset: contentOffset.y,
            content: contentSize.height,
            viewport: layoutMeasurement.height,
          };
          report();
        },
        onContentSizeChange: (_w: number, h: number) => { metrics.current.content = h; report(); },
        onLayout: (e: LayoutChangeEvent) => { metrics.current.viewport = e.nativeEvent.layout.height; report(); },
      }
    : null;

  const scroll = (
    <ScrollView
      ref={keyboardScroll.ref}
      style={scrollStyle}
      scrollEnabled={scrollEnabled && !fabLocked}
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={scrollContentStyle}
      {...keyboardScroll.props}
      {...trackScroll}
    >
      <KeyboardScrollIntoViewContext.Provider value={keyboardScroll.focusInput}>
        {children}
      </KeyboardScrollIntoViewContext.Provider>
    </ScrollView>
  );

  // Inline, the pane has no present animation to wait for, so the form's "now
  // showing" is the moment it becomes visible.
  const onShowRef = useRef(onShow);
  onShowRef.current = onShow;
  useEffect(() => {
    if (inline && visible) onShowRef.current?.();
  }, [inline, visible]);

  const body = (
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
        {subheader}

        {wrapScroll ? wrapScroll(scroll) : scroll}

        {footer}
      </View>
  );

  if (inline) return visible ? body : null;
  return (
    <SheetModal
      visible={visible}
      animationType="slide"
      presentationStyle="fullScreen"
      onRequestClose={onRequestClose}
      onShow={onShow}
    >
      {body}
    </SheetModal>
  );
}
