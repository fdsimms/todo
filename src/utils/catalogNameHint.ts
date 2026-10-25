import type { GroceryItem, ItemProduct } from '../types';
import { isPortionBox } from '../types';
import { auditTokens, containsRun } from './catalogAudit';
import { groceryNameKey } from './groceryParse';
import { catalogItemForKey } from './groceryPlural';

/**
 * What the add field says about a name before it becomes a catalog row.
 *
 * Two answers, both read off the catalog and neither a guess about meaning
 * (the reason `ItemProduct.brand` is never parsed out of typed text):
 *
 * - **`brand`**: the name holds a brand the catalog already keeps on a variant
 *   ("Beyond Meat", "CeraVe"). The item should be the generic thing, with the
 *   brand a variant of it. `generic` is the name with the brand taken out, or
 *   null when nothing is left (the whole name was the brand).
 * - **`same_thing`**: the name is not an existing row's name, other name or
 *   plural, but uses the same words once case, plurals and filler are set
 *   aside ("ground ginger" against "ginger powder"). Adding it would make a
 *   second row for one thing.
 *
 * **A name that already finds a row says nothing.** `catalogItemForKey` is the
 * lookup the add itself makes, so a typed name that lands on an existing row is
 * not a new name and has nothing to warn about. It is a hint, not a gate: the
 * add always goes through, and "keep this name" is a choice the caller offers.
 */
export type NameHint =
  | { kind: 'brand'; brand: string; generic: string | null }
  | { kind: 'same_thing'; item: { id: string; name: string } };

export function nameHintFor(
  typed: string,
  items: readonly GroceryItem[],
  products: readonly ItemProduct[]
): NameHint | null {
  const name = typed.trim();
  const key = groceryNameKey(name);
  if (!key) return null;
  if (catalogItemForKey(key, items)) return null;

  const words = key.split(/\s+/);
  const seen = new Set<string>();
  for (const p of products) {
    if (isPortionBox(p)) continue;
    const brand = p.brand?.trim();
    const brandKey = brand ? groceryNameKey(brand) : '';
    if (!brand || !brandKey || seen.has(brandKey)) continue;
    seen.add(brandKey);
    const run = brandKey.split(/\s+/);
    if (!containsRun(words, run)) continue;
    const at = words.findIndex((_, i) => run.every((w, j) => words[i + j] === w));
    const rest = [...words.slice(0, at), ...words.slice(at + run.length)].join(' ').trim();
    return { kind: 'brand', brand, generic: rest || null };
  }

  const mine = auditTokens(name);
  if (mine.length === 0) return null;
  for (const item of items) {
    const theirs = auditTokens(item.name);
    if (theirs.length === mine.length && theirs.every(w => mine.includes(w))) {
      return { kind: 'same_thing', item: { id: item.id, name: item.name } };
    }
  }
  return null;
}
