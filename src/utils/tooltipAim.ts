/**
 * Where a quick-add tooltip sits under the phrase it describes: the bubble
 * centred under the highlighted text and clamped to the row, and the caret on
 * top of it aimed back at the phrase.
 *
 * Shared by the task and event quick adds (`QuickAddModal`, `QuickEventSheet`)
 * so the two tooltips can't drift apart. The widths are measured off invisible
 * mirrors of the input text: `prefixW` is the text before the phrase,
 * `matchW` the text through its end.
 *
 * A multi-candidate row (the "@name" pick-one pills) has gaps between its
 * pills, and the raw aim point can land in one, floating the caret over
 * nothing. With `candidateLayouts` the caret snaps to the nearest pill instead.
 */
export const TOOLTIP_CARET_W = 12;

export function aimTooltip(m: {
  prefixW: number | null;
  matchW: number | null;
  inputW: number;
  bubbleW: number;
  rowW: number;
  candidateLayouts?: readonly ({ x: number; width: number } | undefined)[];
}): { bubbleLeft: number; caretLeft: number } {
  // Mirror widths land a frame after the phrase appears; until then the
  // tooltip is still fading in, so the resting spot doesn't matter.
  if (m.prefixW == null || m.matchW == null) return { bubbleLeft: 0, caretLeft: 14 };
  const center = Math.min((m.prefixW + m.matchW) / 2, Math.max(m.inputW - 8, 0));
  const bubbleLeft = Math.min(Math.max(center - m.bubbleW / 2, 0), Math.max(m.rowW - m.bubbleW, 0));
  const rawAim = center - bubbleLeft;
  let aim = rawAim;
  let nearestDist = Infinity;
  for (const layout of m.candidateLayouts ?? []) {
    if (!layout) continue;
    const dist = Math.abs(layout.x + layout.width / 2 - rawAim);
    if (dist < nearestDist) {
      nearestDist = dist;
      aim = layout.x + layout.width / 2;
    }
  }
  const caretLeft = Math.min(
    Math.max(aim - TOOLTIP_CARET_W / 2, 10),
    Math.max(m.bubbleW - TOOLTIP_CARET_W - 10, 10),
  );
  return { bubbleLeft, caretLeft };
}
