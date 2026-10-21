/**
 * The scale behind a count chart's guide lines: the top of the chart and the
 * counts a line is drawn at, from the busiest bar in the window.
 *
 * Up to three counts every value gets a line. Past that the lines step by a
 * third of the busiest bar, rounded up, so the chart never has more than four
 * (including zero) and the top line can sit above the busiest bar as headroom.
 */
export function countStripScale(busiest: number): { top: number; levels: number[] } {
  const max = Math.max(1, Math.floor(busiest));
  const step = max <= 3 ? 1 : Math.ceil(max / 3);
  const top = step * Math.ceil(max / step);
  const levels: number[] = [];
  for (let level = 0; level <= top; level += step) levels.push(level);
  return { top, levels };
}
