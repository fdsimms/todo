import React, { useCallback } from 'react';
import { FlatList, type FlatListProps, type NativeScrollEvent, type NativeSyntheticEvent } from 'react-native';
import { useKeyboardInsetScroll } from '../hooks/useKeyboardInsetScroll';

/**
 * A `FlatList` that owns its keyboard-inset handling (`useKeyboardInsetScroll`),
 * for a screen that shows the list only some of the time.
 *
 * The hook reads the screen's focus, and React Navigation hands focus down
 * through context, so whatever component calls the hook renders again each
 * time a card is pushed over the screen and again when it is popped. Called by
 * the screen for a list it wasn't even showing (Today's Inbox and Unscheduled
 * lists, while Today itself was up), that was the whole screen rendering in
 * the first frames of both transitions. Called here, it is this list, and
 * only while it is mounted.
 *
 * Takes every `FlatList` prop. The hook's own props go on after them, as they
 * did when the screen spread them, and `onScroll` reaches both the caller and
 * the hook. `listRef` is the caller's ref to the list, for scrolling it.
 */
export function KeyboardInsetFlatList<T>({
  listRef,
  keyboardRefreshing,
  onScroll,
  ...props
}: FlatListProps<T> & {
  listRef: React.MutableRefObject<FlatList<T> | null>;
  /** The hook's `refreshing`: whether the list's pull-to-refresh is mid-pull. */
  keyboardRefreshing?: boolean;
}) {
  const keyboardScroll = useKeyboardInsetScroll<FlatList<T>>({ refreshing: keyboardRefreshing });
  const { ref: hookRef, noteScroll } = keyboardScroll;
  const setRef = useCallback((list: FlatList<T> | null) => {
    hookRef.current = list;
    listRef.current = list;
  }, [hookRef, listRef]);
  const handleScroll = useCallback((e: NativeSyntheticEvent<NativeScrollEvent>) => {
    onScroll?.(e);
    noteScroll(e);
  }, [onScroll, noteScroll]);
  return (
    <FlatList
      {...props}
      {...keyboardScroll.props}
      ref={setRef}
      onScroll={handleScroll}
    />
  );
}
