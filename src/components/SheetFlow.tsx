import React, { useEffect, useMemo, useRef } from 'react';
import { View } from 'react-native';
import { SheetModal } from './SheetModal';
import { SheetFlowContext, type SheetFlowState } from './FlowStage';
import { useColors } from '../theme/ThemeContext';

interface Props {
  /** Whether any stage of the flow is wanted. The host stays up from the first to the last. */
  visible: boolean;
  /** For `SheetModal`'s clash report in development. */
  name?: string;
  /**
   * The flow's stages: pageSheet `SheetModal`s, usually inside the components
   * that own them. Anything else (a card, a picker) is an ordinary sheet and
   * presents from this one.
   */
  children: React.ReactNode;
}

/**
 * One page sheet that several sheets take turns in.
 *
 * **Why it exists.** Handing from one `pageSheet` to the next is a dismissal
 * and then a presentation: the first slides down, the second slides up, and a
 * sheet cannot be raised over a sibling or cut out from under a nested one (see
 * "Two sibling Modals" in `ui-sheets-and-lists.md`). That reads as the screen
 * being reshuffled mid-task, which for scan, then amount, then log is the whole
 * interaction.
 *
 * **How it works.** The host owns the only real `Modal`. A pageSheet
 * `SheetModal` rendered inside it does not make a `Modal` of its own: it draws
 * as a layer in the host (`FlowStage`), and a hand-off is a crossfade between
 * two layers while the sheet stays where it is. The sheets themselves are
 * unchanged and still work on their own anywhere else; they keep their own
 * `visible`, `onRequestClose` and unsaved-changes guard.
 *
 * What the caller owes:
 * - `visible` is true whenever any stage is wanted, including in the commit one
 *   hands to the next, so the host does not close in between.
 * - Stages mount with the host and unmount after it dismisses, like any
 *   `Modal`'s children, so a stage keeps nothing across a full close.
 * - A swipe-down is routed to whichever stage is up, so its guard still runs.
 */
export function SheetFlow({ visible, name, children }: Props) {
  const colors = useColors();
  const flow = useMemo<SheetFlowState>(() => ({
    stages: { current: new Map() },
    hostVisible: { current: visible },
    hostWasVisible: { current: false },
    live: { current: new Set() },
    onRise: { current: new Set() },
    nextLayer: { current: 0 },
  }), []);  // eslint-disable-line react-hooks/exhaustive-deps

  // Read by the stages' effects in this commit, so assigned in render; the
  // previous value is stamped by this component's own effect, which runs after
  // theirs.
  flow.hostVisible.current = visible;
  useEffect(() => { flow.hostWasVisible.current = visible; });

  const flowRef = useRef(flow);
  const handleRequestClose = () => {
    let active: (() => void) | null = null;
    for (const stage of flowRef.current.stages.current.values()) {
      if (stage.visible) active = stage.onRequestClose;
    }
    active?.();
  };

  return (
    <SheetModal
      name={name}
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={handleRequestClose}
    >
      <View style={{ flex: 1, backgroundColor: colors.bg }}>
        <SheetFlowContext.Provider value={flow}>
          {children}
        </SheetFlowContext.Provider>
      </View>
    </SheetModal>
  );
}
