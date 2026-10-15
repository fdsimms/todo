/**
 * The arithmetic behind `AnimatedNumber`: which characters of a changing
 * number move, and which way.
 *
 * A number is laid out in columns aligned on the right, the way digits line up
 * in a column of figures, so going from 99 to 100 shifts nothing that didn't
 * change: the 9s become 0s and a 1 arrives on the left. Only a column whose
 * character actually changed rolls, which is what makes a count read as a
 * count rather than as the whole number being swapped out.
 */
export interface RollColumn {
  /** The character before, or '' where the old text was shorter. */
  from: string;
  /** The character after, or '' where the new text is shorter. */
  to: string;
  changed: boolean;
}

export function rollColumns(from: string, to: string): RollColumn[] {
  const a = Array.from(from);
  const b = Array.from(to);
  const length = Math.max(a.length, b.length);
  const columns: RollColumn[] = [];
  for (let i = 0; i < length; i++) {
    const before = a[a.length - length + i] ?? '';
    const after = b[b.length - length + i] ?? '';
    columns.push({ from: before, to: after, changed: before !== after });
  }
  return columns;
}

/**
 * Which way the changed digits travel: up (new ones arriving from below) when
 * the number grew, down when it shrank, and no roll when it didn't change or
 * either side isn't a number.
 */
export function rollDirection(from: number | null | undefined, to: number | null | undefined): 1 | -1 | 0 {
  if (from == null || to == null || !Number.isFinite(from) || !Number.isFinite(to)) return 0;
  if (to > from) return 1;
  if (to < from) return -1;
  return 0;
}
