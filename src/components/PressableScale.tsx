import React, { useRef } from 'react';
import {
  Animated,
  Pressable,
  type GestureResponderEvent,
  type PressableProps,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { animation, interaction } from '../theme';
import { haptics } from '../utils/haptics';
import { useReduceMotion } from '../utils/useReduceMotion';

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

interface Props extends Omit<PressableProps, 'style'> {
  style?: StyleProp<ViewStyle>;
  /** Scale applied while pressed. Defaults to interaction.pressScale. */
  pressScale?: number;
  /** Fire a selection haptic on press. */
  haptic?: boolean;
  children?: React.ReactNode;
}

/**
 * Standard press feedback for buttons, chips and icon buttons: a quick
 * native-driven scale-down with a slight opacity dip, springing back on
 * release. Full-width list rows should keep TouchableOpacity with
 * interaction.activeOpacity instead — scaling a full row looks wrong.
 */
export function PressableScale({
  style,
  pressScale = interaction.pressScale,
  haptic = false,
  onPressIn,
  onPressOut,
  onPress,
  children,
  ...rest
}: Props) {
  const reduceMotion = useReduceMotion();
  const scale = useRef(new Animated.Value(1)).current;
  const opacity = useRef(new Animated.Value(1)).current;

  const handlePressIn = (e: GestureResponderEvent) => {
    Animated.parallel([
      // Reduce Motion: hold the scale steady (skip the movement) but keep the
      // opacity dip, so pressing still gives feedback without the pop.
      Animated.spring(scale, {
        toValue: reduceMotion ? 1 : pressScale,
        ...animation.spring.snappy,
        useNativeDriver: true,
      }),
      Animated.timing(opacity, {
        toValue: 0.85,
        duration: animation.duration.fast,
        useNativeDriver: true,
      }),
    ]).start();
    onPressIn?.(e);
  };

  const handlePressOut = (e: GestureResponderEvent) => {
    Animated.parallel([
      Animated.spring(scale, {
        toValue: 1,
        ...animation.spring.smooth,
        useNativeDriver: true,
      }),
      Animated.timing(opacity, {
        toValue: 1,
        duration: animation.duration.fast,
        useNativeDriver: true,
      }),
    ]).start();
    onPressOut?.(e);
  };

  const handlePress = (e: GestureResponderEvent) => {
    if (haptic) haptics.tap();
    onPress?.(e);
  };

  return (
    <AnimatedPressable
      accessibilityRole="button"
      style={[style, { transform: [{ scale }], opacity }]}
      onPressIn={handlePressIn}
      onPressOut={handlePressOut}
      onPress={handlePress}
      {...rest}
    >
      {children}
    </AnimatedPressable>
  );
}
