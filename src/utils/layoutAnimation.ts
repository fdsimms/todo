import { LayoutAnimation, Platform, UIManager } from 'react-native';

if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

/**
 * Animate the next layout change (list insert/remove, expand/collapse,
 * empty-state swap). Call immediately before the state update.
 *
 * IMPORTANT: never call this on a drag-reorder commit path (ReorderableList
 * onReorder, SortableList onReorder) — those drive their own row
 * animations and a LayoutAnimation in the same commit fights them.
 *
 * `duration` is for a tap whose result should read as immediate (pinning): the
 * new row fades in from 0, so the default 220ms is felt as lag after the tap.
 */
export function animateLayout(duration = 220) {
  LayoutAnimation.configureNext(
    LayoutAnimation.create(duration, LayoutAnimation.Types.easeInEaseOut, LayoutAnimation.Properties.opacity)
  );
}
