import type { GroceryItem, ItemProduct } from '../types';
import { isPortionBox } from '../types';
import { groceryNameKey } from './groceryParse';
import { productKeyFor } from './groceryProduct';

/**
 * Brands as the catalog actually holds them: a text field on each variant, with
 * no row of their own. Two things want a brand as a whole, and both are derived
 * here from the variants rather than from a table:
 *
 * - **A list of them** (`brandSummaries`): every brand once, with the spellings
 *   in use and where it appears, so "Quest" showing up as `QUEST` and `Quest`
 *   across thirty variants is visible.
 * - **A bulk rename** (`planBrandRename`): one spelling written onto every
 *   variant of a brand, which is the "fix it in one place" a brand table would
 *   have given, without the table, its migration or its sync rule.
 *
 * Identity is `groceryNameKey`, the same normalizer `productKeyFor` uses, so
 * `Siggi’s`, `siggi's` and `SIGGI'S` are one brand here exactly as they are one
 * variant key there.
 */

export interface BrandSummary {
  /** The normalized identity. */
  key: string;
  /** The spelling to show: the most common one, the older on a tie. */
  name: string;
  /** Every spelling in use with how many variants carry it, most common first. */
  spellings: { text: string; count: number }[];
  /** How many variants carry this brand. */
  variants: number;
  /** The names of the items those variants belong to, sorted, each once. */
  items: string[];
}

/** Every brand in the catalog, most variants first. A frozen portion has no brand and is skipped. */
export function brandSummaries(
  products: readonly ItemProduct[],
  items: readonly Pick<GroceryItem, 'id' | 'name'>[]
): BrandSummary[] {
  const itemName = new Map(items.map(i => [i.id, i.name]));
  const byKey = new Map<string, { spellings: Map<string, number>; items: Set<string>; variants: number }>();
  for (const p of products) {
    if (isPortionBox(p)) continue;
    const text = p.brand?.trim();
    if (!text) continue;
    const key = groceryNameKey(text);
    if (!key) continue;
    const entry = byKey.get(key) ?? { spellings: new Map(), items: new Set(), variants: 0 };
    entry.spellings.set(text, (entry.spellings.get(text) ?? 0) + 1);
    const name = itemName.get(p.itemId);
    if (name) entry.items.add(name);
    entry.variants += 1;
    byKey.set(key, entry);
  }
  return [...byKey.entries()]
    .map(([key, entry]) => {
      // Map iteration is insertion order, so a stable sort keeps the older
      // spelling first on a tie.
      const spellings = [...entry.spellings.entries()]
        .map(([text, count]) => ({ text, count }))
        .sort((a, b) => b.count - a.count);
      return {
        key,
        name: spellings[0].text,
        spellings,
        variants: entry.variants,
        items: [...entry.items].sort((a, b) => a.localeCompare(b)),
      };
    })
    .sort((a, b) => b.variants - a.variants || a.name.localeCompare(b.name));
}

/**
 * The variants a bulk rename would rewrite, or the reason it can't.
 *
 * `from` is matched by key, so any spelling finds the brand. Renaming to a
 * different brand (not just a different spelling) changes each variant's key,
 * and is refused when that would give one item two variants with the same key:
 * "Aoodles" renamed to "Goodles" under an item that already has a Goodles
 * variant of the same name. That is a merge of two variants, which this does not
 * do silently.
 */
export function planBrandRename(
  products: readonly ItemProduct[],
  from: string,
  to: string
): { updates: ItemProduct[] } | { refusal: string } {
  const target = to.trim();
  if (!target) return { refusal: 'A brand needs a name to be renamed to.' };
  const fromKey = groceryNameKey(from);
  if (!fromKey) return { refusal: 'Name the brand to rename.' };
  const matching = products.filter(
    p => !isPortionBox(p) && !!p.brand && groceryNameKey(p.brand) === fromKey
  );
  if (matching.length === 0) return { refusal: `No variant has the brand "${from.trim()}".` };

  const updates = matching
    .filter(p => p.brand?.trim() !== target)
    .map(p => ({ ...p, brand: target, productKey: productKeyFor(target, p.variant) }));

  // Only a change of key can collide; a respelling keeps every key as it was.
  const moving = new Set(updates.filter(u => u.productKey !== products.find(p => p.id === u.id)?.productKey).map(u => u.id));
  for (const u of updates) {
    if (!moving.has(u.id)) continue;
    const clash = products.find(
      p => p.id !== u.id && p.itemId === u.itemId && !moving.has(p.id) && p.productKey === u.productKey
    );
    if (clash) {
      return {
        refusal: `Renaming would give one item two variants of "${target}" with the same variant name. Merge or rename those variants first.`,
      };
    }
  }
  return { updates };
}
