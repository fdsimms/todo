import React, { useEffect, useRef, useState } from 'react';
import { Animated, StyleSheet, TouchableOpacity } from 'react-native';
import { animation } from '../theme';

interface Props {
  visible: boolean;
  onPress: () => void;
}

/**
 * Dimming layer shown behind an expanded ("spotlighted") task. Fades in/out
 * instead of popping, and stays mounted until the fade-out finishes.
 * Sits at zIndex 5; the screen elevates its task list above it (zIndex 10).
 */
export function SpotlightOverlay({ visible, onPress }: Props) {
  const opacity = useRef(new Animated.Value(0)).current;
  const [rendered, setRendered] = useState(visible);

  useEffect(() => {
    if (visible) setRendered(true);
    Animated.timing(opacity, {
      toValue: visible ? 1 : 0,
      duration: animation.duration.fast,
      useNativeDriver: true,
    }).start(({ finished }) => {
      if (finished && !visible) setRendered(false);
    });
  }, [visible]);

  if (!rendered) return null;

  return (
    <Animated.View
      style={[styles.overlay, { opacity }]}
      pointerEvents={visible ? 'auto' : 'none'}
    >
      <TouchableOpacity style={StyleSheet.absoluteFill} activeOpacity={1} onPress={onPress} />
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.5)',
    zIndex: 5,
  },
});
