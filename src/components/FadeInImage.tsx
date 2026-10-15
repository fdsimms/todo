import React, { useEffect, useRef } from 'react';
import { Animated, Easing, type ImageLoadEventData, type ImageProps, type NativeSyntheticEvent } from 'react-native';
import { useReduceMotion } from '../utils/useReduceMotion';

/** How long a photo takes to fade in once it has loaded. */
const FADE_MS = 200;
/**
 * A load this quick came from the cache and would have drawn at once anyway;
 * fading it in would only make an image that was already there blink.
 */
const CACHED_LOAD_MS = 60;

/**
 * `Image` that fades a photo in over whatever is behind it once it has
 * loaded, instead of drawing it on the frame it finishes decoding. Built for
 * recipe photos, where a grid of them filled in with a flicker.
 *
 * A photo that loads near-instantly (the cache) and every photo under Reduce
 * Motion appear at once. A new `source` starts over.
 */
export function FadeInImage({ onLoad, style, ...rest }: ImageProps) {
  const reduceMotion = useReduceMotion();
  const opacity = useRef(new Animated.Value(0)).current;
  const startedAt = useRef(Date.now());
  const uri = typeof rest.source === 'object' && rest.source !== null && !Array.isArray(rest.source)
    ? rest.source.uri
    : undefined;

  useEffect(() => {
    opacity.setValue(0);
    startedAt.current = Date.now();
  }, [uri, opacity]);

  const handleLoad = (e: NativeSyntheticEvent<ImageLoadEventData>) => {
    onLoad?.(e);
    if (reduceMotion || Date.now() - startedAt.current < CACHED_LOAD_MS) {
      opacity.setValue(1);
      return;
    }
    Animated.timing(opacity, {
      toValue: 1,
      duration: FADE_MS,
      easing: Easing.out(Easing.quad),
      useNativeDriver: true,
    }).start();
  };

  return <Animated.Image {...rest} onLoad={handleLoad} style={[style, { opacity }]} />;
}
