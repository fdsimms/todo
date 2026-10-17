import { useCallback, useMemo, useState } from 'react';
import { useCookwareStore } from '../store/useCookwareStore';
import { netWeight, parseWeightText, type CookwareNoun, type NetWeight } from '../utils/cookware';

/**
 * The state behind "weighed with the pot on": which cookware is picked, and
 * what a typed scale reading comes to once it is taken off. See
 * `src/utils/cookware.ts`, and `CookwareWeighIn` for the controls.
 *
 * A picked id whose cookware has since been deleted contributes nothing rather
 * than throwing, so a sheet left open across a sync that removed one still
 * reads sensibly.
 */
export function useWeighIn(noun: CookwareNoun = 'pot') {
  const cookware = useCookwareStore(s => s.cookware);
  const [selected, setSelected] = useState<string[]>([]);

  const picked = useMemo(
    () => selected.map(id => cookware.find(c => c.id === id)).filter((c): c is NonNullable<typeof c> => !!c),
    [selected, cookware],
  );

  /** The food's weight for a typed reading, or null while it isn't a number. */
  const convert = useCallback(
    (text: string): NetWeight | null => {
      const typed = parseWeightText(text);
      if (typed === null || typed <= 0) return null;
      if (picked.length === 0) return { ok: true, grams: typed };
      return netWeight(typed, picked.map(c => c.weightG), noun);
    },
    [picked, noun],
  );

  const toggle = useCallback((id: string) => {
    setSelected(cur => (cur.includes(id) ? cur.filter(x => x !== id) : [...cur, id]));
  }, []);
  const clear = useCallback(() => setSelected([]), []);

  return { selected, picked, toggle, clear, convert, hasCookware: cookware.length > 0 };
}

export type WeighIn = ReturnType<typeof useWeighIn>;
