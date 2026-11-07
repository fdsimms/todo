import React, { createContext, useEffect, useId, useRef, useState } from 'react';
import { Animated, StyleSheet } from 'react-native';
import { useColors } from '../theme/ThemeContext';
import { animation } from '../theme';

/**
 * The state a `SheetFlow` shares with the stages inside it. All refs: the
 * stages read them from effects, and none of it should re-render anything.
 */
export interface SheetFlowState {
  /** Every stage, by id, with what the host needs to route a swipe-down. Insertion order is mount order. */
  stages: React.MutableRefObject<Map<string, { visible: boolean; onRequestClose: () => void }>>;
  /** Whether the host is presented in the commit being rendered. */
  hostVisible: React.MutableRefObject<boolean>;
  /** Whether the host was presented before that commit. Written by the host's effect, which runs after the stages' own. */
  hostWasVisible: React.MutableRefObject<boolean>;
  /** Stages whose layer is still on screen, visible or fading. */
  live: React.MutableRefObject<Set<string>>;
  /** Called with the id of a stage that has just appeared. */
  onRise: React.MutableRefObject<Set<(id: string) => void>>;
  /** Hands each appearing stage a higher layer than the one it replaces. */
  nextLayer: React.MutableRefObject<number>;
}

/** Present while rendering inside a `SheetFlow`'s host and not inside one of its stages. */
export const SheetFlowContext = createContext<SheetFlowState | null>(null);

/** How long a closing stage keeps its content while the host slides down. A slide is ~350ms. */
const HOST_DISMISS_MS = 500;

interface Props {
  flow: SheetFlowState;
  visible: boolean;
  onRequestClose: () => void;
  children: React.ReactNode;
}

/**
 * One page of a `SheetFlow`: what a pageSheet `SheetModal` renders as when it
 * sits inside one, in place of a `Modal` of its own.
 *
 * The first stage up arrives with the host's slide. A later one fades in over
 * the one it replaces, and that one stays put underneath until the fade is
 * done: two layers both partly transparent would show the window behind them
 * for a moment, which reads as a flash.
 *
 * Content is mounted only while the stage is up or going, as a `Modal` does,
 * so a hidden scanner is not holding the camera.
 */
export function FlowStage({ flow, visible, onRequestClose, children }: Props) {
  const id = useId();
  const colors = useColors();
  const opacity = useRef(new Animated.Value(visible ? 1 : 0)).current;
  const [rendered, setRendered] = useState(visible);
  const [layer, setLayer] = useState(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const wasVisible = useRef(false);
  // Fell with the host going down too, rather than being replaced by another stage.
  const closing = useRef(false);

  flow.stages.current.set(id, { visible, onRequestClose });

  const retire = () => {
    if (timer.current) { clearTimeout(timer.current); timer.current = null; }
    opacity.setValue(0);
    flow.live.current.delete(id);
    setRendered(false);
  };

  useEffect(() => {
    if (visible === wasVisible.current) return;
    wasVisible.current = visible;
    if (timer.current) { clearTimeout(timer.current); timer.current = null; }
    closing.current = false;
    if (visible) {
      const handoff = flow.hostWasVisible.current
        && [...flow.live.current].some(other => other !== id);
      flow.live.current.add(id);
      flow.nextLayer.current += 1;
      setLayer(flow.nextLayer.current);
      setRendered(true);
      opacity.stopAnimation();
      if (handoff) {
        opacity.setValue(0);
        Animated.timing(opacity, {
          toValue: 1,
          duration: animation.duration.normal,
          useNativeDriver: true,
        }).start();
      } else {
        opacity.setValue(1);
      }
      flow.onRise.current.forEach(fn => fn(id));
    } else {
      // Staying put either way: under the stage that replaces it, or under the
      // host's own slide down. Only the moment its content goes differs.
      closing.current = !flow.hostVisible.current;
      const wait = closing.current ? HOST_DISMISS_MS : animation.duration.normal + 50;
      timer.current = setTimeout(retire, wait);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  // A stage still showing under a host that was going down has nothing left to
  // show once another appears (the host closed and reopened inside the wait).
  // One being replaced stays, as the layer the new one fades in over.
  useEffect(() => {
    const listener = (riser: string) => {
      if (riser !== id && closing.current) retire();
    };
    flow.onRise.current.add(listener);
    return () => { flow.onRise.current.delete(listener); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
    flow.stages.current.delete(id);
    flow.live.current.delete(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!visible && !rendered) return null;
  return (
    <Animated.View
      pointerEvents={visible ? 'auto' : 'none'}
      style={[StyleSheet.absoluteFill, { opacity, zIndex: layer, backgroundColor: colors.bg }]}
    >
      {/* A sheet raised from inside a stage is an ordinary one, not another stage. */}
      <SheetFlowContext.Provider value={null}>
        {children}
      </SheetFlowContext.Provider>
    </Animated.View>
  );
}
