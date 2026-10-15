import { LayoutAnimation, Platform, UIManager } from 'react-native';
import { reduceMotionEnabled } from './useReduceMotion';

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
 */
export function animateLayout() {
  // Reduce Motion keeps the fades and drops the slide: rows that appear or go
  // still fade, but the rows around them move to their new places at once
  // rather than travelling there (no `update` entry).
  if (reduceMotionEnabled()) {
    const fade = { type: LayoutAnimation.Types.easeInEaseOut, property: LayoutAnimation.Properties.opacity };
    LayoutAnimation.configureNext({ duration: 220, create: fade, delete: fade });
    return;
  }
  LayoutAnimation.configureNext(
    LayoutAnimation.create(220, LayoutAnimation.Types.easeInEaseOut, LayoutAnimation.Properties.opacity)
  );
}
