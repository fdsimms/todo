import React, { useEffect, useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import Reanimated, { Easing, useAnimatedStyle, useSharedValue, withTiming, type SharedValue } from 'react-native-reanimated';
import { useColors } from '../theme/ThemeContext';
import { CoinIcon } from './CoinIcon';
import { burstOffset, burstOpacity, burstPieces, type BurstPiece } from '../utils/coinBurst';
import { useReduceMotion } from '../utils/useReduceMotion';

const FLIGHT_MS = 1100;
const COUNT = 14;
const BIG_COUNT = 24;
const COIN_SIZE = 22;
const SPARK_SIZE = 8;

interface Props {
  /** Raise this number to fire a burst. 0 is "never fired", so mounting draws nothing. */
  burstKey: number;
  /** A larger burst, for reaching a goal rather than claiming one reward. */
  big?: boolean;
}

/**
 * Coins thrown up and falling back, for the two moments the Rewards screen
 * celebrates: claiming a reward and reaching the goal you were saving for.
 *
 * An overlay that takes no touches and draws nothing between bursts. The path
 * is `utils/coinBurst.ts` (pure, so it is tested); this only maps one shared
 * progress value onto it. With Reduce Motion on it never draws at all: the
 * haptic and the text change carry the moment for those users.
 */
export function CoinBurst({ burstKey, big = false }: Props) {
  const reduceMotion = useReduceMotion();
  const progress = useSharedValue(0);
  const pieces = useMemo(() => burstPieces(big ? BIG_COUNT : COUNT, big ? 190 : 150), [big]);

  useEffect(() => {
    if (burstKey === 0 || reduceMotion) return;
    progress.value = 0;
    progress.value = withTiming(1, { duration: FLIGHT_MS, easing: Easing.linear });
  }, [burstKey, reduceMotion, progress]);

  return (
    <View style={styles.origin} pointerEvents="none">
      {pieces.map((piece, i) => <BurstPieceView key={i} piece={piece} progress={progress} />)}
    </View>
  );
}

function BurstPieceView({ piece, progress }: { piece: BurstPiece; progress: SharedValue<number> }) {
  const colors = useColors();
  const base = piece.kind === 'coin' ? COIN_SIZE : SPARK_SIZE;
  const size = base * (0.8 + piece.size * 0.4);
  const style = useAnimatedStyle(() => {
    const t = progress.value;
    const { x, y } = burstOffset(piece, t);
    return {
      opacity: burstOpacity(t),
      transform: [
        { translateX: x - size / 2 },
        { translateY: y - size / 2 },
        { rotate: `${piece.turns * t * 360}deg` },
      ],
    };
  });
  // The confetti takes the app's own colours so it reads in both themes.
  const sparkColor = [colors.accent, colors.green, colors.orange, colors.purple][Math.floor(piece.size * 4) % 4];
  return (
    <Reanimated.View style={[styles.piece, style]}>
      {piece.kind === 'coin'
        ? <CoinIcon size={size} color={colors.warning} filled />
        : <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: sparkColor }} />}
    </Reanimated.View>
  );
}

const styles = StyleSheet.create({
  // A zero-size anchor: every piece is placed relative to this one point.
  origin: { position: 'absolute', left: 0, right: 0, alignItems: 'center' },
  piece: { position: 'absolute', top: 0 },
});
