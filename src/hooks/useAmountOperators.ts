import { useRef, useState } from 'react';
import { appendOperator, type AmountOperator } from '../utils/amountMath';

/**
 * Wires the + − × buttons on the number pad's bar (`NumberPadAccessory`'s
 * `onOperator`) to whichever amount field is focused. A sheet with one amount
 * field and a sheet with a row per food use it the same way: spread
 * `fieldProps(key, get, set)` onto the field and pass `onOperator` to the bar.
 * `onOperator` is undefined while no such field is focused, so the bar shows
 * only Done over every other number field.
 *
 * `get` and `set` are re-registered on every render, so a tap always works on
 * the text the field is showing now.
 */
export function useAmountOperators() {
  const [focusKey, setFocusKey] = useState<string | null>(null);
  const rows = useRef(new Map<string, { get: () => string; set: (text: string) => void }>());

  const fieldProps = (key: string, get: () => string, set: (text: string) => void) => {
    rows.current.set(key, { get, set });
    return {
      onFocus: () => setFocusKey(key),
      onBlur: () => setFocusKey(current => (current === key ? null : current)),
    };
  };

  const onOperator = focusKey === null
    ? undefined
    : (op: AmountOperator) => {
      const row = rows.current.get(focusKey);
      if (row) row.set(appendOperator(row.get(), op));
    };

  return { fieldProps, onOperator };
}
