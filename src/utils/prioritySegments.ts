import { PRIORITY_LABELS, PRIORITY_COLORS, type Priority } from '../types';

/**
 * The priority picker's options, shared by the three places that ask for one
 * (the task editor, quick add, the template item quick add) and by the Settings
 * default, so the five words and the five colours can't drift apart.
 *
 * Every segment carries its colour, not just the chosen one. That's the whole
 * decision behind putting priority in a track at all (#1497): the colour here
 * is *information* — it's the dot the task row draws — and the pill treatment it
 * replaced showed it only on the option you'd already picked, which meant the
 * one thing the colours are for, ranking them at a glance, was never visible.
 * None has no dot, because "no priority" has no colour; it's the one option
 * whose absence of a swatch is the answer.
 */
export const PRIORITY_SEGMENTS: { value: Priority; label: string; dot?: string }[] =
  PRIORITY_LABELS.map((label, value) => ({
    value: value as Priority,
    label,
    dot: value > 0 ? PRIORITY_COLORS[value] : undefined,
  }));
