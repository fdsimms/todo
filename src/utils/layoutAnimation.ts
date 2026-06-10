import { LayoutAnimation, Platform, UIManager } from 'react-native';

if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

/**
 * Animate the next layout change (list insert/remove, expand/collapse,
 * empty-state swap). Call immediately before the state update.
 *
 * IMPORTANT: never call this on a drag-reorder commit path (ReorderableList
 * onReorder, DraggableFlatList onDragEnd) — those drive their own row
 * animations and a LayoutAnimation in the same commit fights them.
 */
export function animateLayout() {
  LayoutAnimation.configureNext(
    LayoutAnimation.create(220, LayoutAnimation.Types.easeInEaseOut, LayoutAnimation.Properties.opacity)
  );
}
