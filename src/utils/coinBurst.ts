/**
 * The shape of the coin burst on the Rewards screen (`CoinBurst`): where each
 * piece is a fraction of the way through its flight. Pure and deterministic, so
 * the component only maps a progress number onto it and the arithmetic is
 * pinned by a test. No `Math.random`: two bursts look alike, which reads as one
 * effect rather than noise, and a render can't change what it drew.
 */

export interface BurstPiece {
  /** Launch direction in radians, fanned upward (negative y is up). */
  angle: number;
  /** How far it travels horizontally and up before gravity takes over, in points. */
  distance: number;
  /** Full turns over the flight, negative for a spin the other way. */
  turns: number;
  /** 0..1 size variation, so the pieces aren't one repeated stamp. */
  size: number;
  /** A coin, or a small bit of confetti beside it. */
  kind: 'coin' | 'spark';
}

/** Points the whole burst falls over its flight. */
export const BURST_GRAVITY = 220;

const FAN_START = (-170 * Math.PI) / 180;
const FAN_END = (-10 * Math.PI) / 180;

/**
 * `count` pieces fanned across the upper half-circle. Distance and size come
 * off fixed fractions of the index, which spreads them without repeating a
 * pattern a viewer would pick out at this count.
 */
export function burstPieces(count: number, reach = 150): BurstPiece[] {
  const pieces: BurstPiece[] = [];
  for (let i = 0; i < count; i++) {
    const across = count === 1 ? 0.5 : i / (count - 1);
    pieces.push({
      angle: FAN_START + (FAN_END - FAN_START) * across,
      distance: reach * (0.55 + ((i * 0.37) % 1) * 0.45),
      turns: (i % 2 === 0 ? 1 : -1) * (1 + ((i * 0.23) % 1)),
      size: (i * 0.61) % 1,
      kind: i % 3 === 2 ? 'spark' : 'coin',
    });
  }
  return pieces;
}

/** Where a piece is `t` (0..1) of the way through its flight, relative to the launch point. */
export function burstOffset(piece: BurstPiece, t: number): { x: number; y: number } {
  const clamped = Math.min(1, Math.max(0, t));
  return {
    x: Math.cos(piece.angle) * piece.distance * clamped,
    y: Math.sin(piece.angle) * piece.distance * clamped + BURST_GRAVITY * clamped * clamped,
  };
}

/** Fully drawn for the first part of the flight, then fading out over the rest. */
export function burstOpacity(t: number): number {
  if (t <= 0 || t >= 1) return 0;
  const FADE_FROM = 0.65;
  return t < FADE_FROM ? 1 : (1 - t) / (1 - FADE_FROM);
}
