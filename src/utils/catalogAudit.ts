import type { GroceryItem, ItemProduct } from '../types';
import { isPortionBox } from '../types';
import { otherNameKeysOf } from './itemAliases';
import { groceryNameKey } from './groceryParse';
import { readableItemName } from './productCase';
import { hasTrailingSize, shopperNameFor } from './scanResolve';

/**
 * Reading the catalog for names that don't belong in it: a brand where the
 * generic should be, a name copied off a package, a shouted name, and two rows
 * that are one thing.
 *
 * **It reports and never writes.** Every finding is a judgment the person
 * makes (is "tofurky" a brand or the thing?), so the output names the rows,
 * says why they were flagged and how sure that is, and leaves the fix to the
 * tools that already exist: `update_grocery_item` to rename or mark a kind,
 * `merge_grocery_items` to join two rows, `save_grocery_box` to keep a brand as
 * a variant. Reading names for meaning is the guess the rest of the catalog
 * refuses to make (see `ItemProduct.brand`), so each check here is a plain
 * comparison of words against facts the catalog already holds: the brands on
 * its own variants, the other names a row declares, the kinds it declares.
 *
 * It is the one reading the MCP tool and any in-app screen share, so the two
 * cannot disagree about what counts as a duplicate.
 */

export type AuditKind =
  | 'brand_in_name'
  | 'package_title'
  | 'all_caps'
  | 'size_in_name'
  | 'same_words'
  | 'maybe_kind_of';

export interface AuditRow {
  id: string;
  name: string;
  aisle: string;
}

export interface AuditFinding {
  kind: AuditKind;
  /** high: the check is mechanical. low: a reason to look, not a conclusion. */
  confidence: 'high' | 'low';
  /** The row(s) involved. A pair is listed as [the more generic, the other]. */
  items: AuditRow[];
  why: string;
  /** What the existing tools would do about it. */
  suggestion: string;
  /** For `brand_in_name`: the brand the catalog holds that the name contains. */
  brand?: string;
}

const STOP = new Set(['and', 'or', 'the', 'of', 'a', 'an', 'in', 'with', 'from']);
/** Words that don't change which thing a row is. */
const NOISE = new Set(['fresh', 'organic', 'leaf', 'leave', 'boxed', 'raw']);
/** Two words for one thing, folded onto the first so the comparison sees one. */
const SYNONYM: Record<string, string> = {
  mayo: 'mayonnaise',
  stock: 'broth',
  powder: 'ground',
  powdered: 'ground',
};

function stem(word: string): string {
  return word.length > 3 && word.endsWith('s') && !word.endsWith('ss') ? word.slice(0, -1) : word;
}

/** The words that identify a row, with noise dropped and synonyms folded. */
export function auditTokens(name: string): string[] {
  const words = groceryNameKey(name).split(/\s+/).filter(Boolean).map(stem);
  const kept = words.filter(w => !STOP.has(w) && !NOISE.has(w)).map(w => SYNONYM[w] ?? w);
  return [...new Set(kept)];
}

const row = (i: GroceryItem): AuditRow => ({ id: i.id, name: i.name, aisle: i.aisle });

export function containsRun(words: string[], run: string[]): boolean {
  if (run.length === 0 || run.length > words.length) return false;
  for (let i = 0; i + run.length <= words.length; i++) {
    if (run.every((w, j) => words[i + j] === w)) return true;
  }
  return false;
}

export function auditCatalog(
  items: readonly GroceryItem[],
  products: readonly ItemProduct[]
): AuditFinding[] {
  const out: AuditFinding[] = [];
  const brandKeys = new Map<string, string>(); // key -> spelling
  const ownBrands = new Map<string, string[]>(); // itemId -> brands
  for (const p of products) {
    if (isPortionBox(p)) continue;
    const text = p.brand?.trim();
    const key = text ? groceryNameKey(text) : '';
    if (!text || !key) continue;
    if (!brandKeys.has(key)) brandKeys.set(key, text);
    ownBrands.set(p.itemId, [...(ownBrands.get(p.itemId) ?? []), text]);
  }

  for (const item of items) {
    const words = groceryNameKey(item.name).split(/\s+/).filter(Boolean);
    const display = row(item);

    if (/[A-Za-z]/.test(item.name) && !/[a-z]/.test(item.name) && !/^[A-Za-z]{1,4}$/.test(item.name.trim())) {
      out.push({
        kind: 'all_caps',
        confidence: 'high',
        items: [display],
        why: 'The name has no lowercase letters, which is how a package prints it.',
        suggestion: 'update_grocery_item rename to a normal-case name.',
      });
    }

    if (hasTrailingSize(item.name)) {
      out.push({
        kind: 'size_in_name',
        confidence: 'high',
        items: [display],
        why: 'The name ends in a package size.',
        suggestion: 'Rename without the size; put it in the quantity if it matters.',
      });
    }

    // A brand: one carried by any variant in the catalog, found as a run of
    // words in the name. Its own variants' brands are also matched on their
    // first word, because a scan names "Beyond Sausage…" under "Beyond Meat".
    let brandHit: { brand: string; whole: boolean } | null = null;
    for (const [key, spelling] of brandKeys) {
      const run = key.split(/\s+/);
      if (containsRun(words, run)) {
        brandHit = { brand: spelling, whole: words.length === run.length };
        break;
      }
    }
    if (!brandHit) {
      for (const brand of ownBrands.get(item.id) ?? []) {
        const brandWords = groceryNameKey(brand).split(/\s+/);
        const first = brandWords[0];
        // A name that is only the start of the brand ("peanut butter" under
        // "Peanut Butter & Co") is the generic thing, not the brand.
        const isBrandPrefix = words.every((w, i) => brandWords[i] === w);
        if (first && first.length >= 4 && words.length > 1 && words[0] === first && !isBrandPrefix) {
          brandHit = { brand, whole: false };
          break;
        }
      }
    }
    if (brandHit) {
      out.push({
        kind: 'brand_in_name',
        confidence: brandHit.whole ? 'high' : 'low',
        brand: brandHit.brand,
        items: [display],
        why: brandHit.whole
          ? `The whole name is the brand "${brandHit.brand}", which the catalog also holds as a brand on a variant.`
          : `The name contains the brand "${brandHit.brand}", which the catalog also holds as a brand on a variant.`,
        suggestion:
          'Rename to the generic thing and keep the brand as a variant (update_grocery_item rename, save_grocery_box). If a generic row exists already, merge_grocery_items.',
      });
    } else if (words.length >= 6 || /[,!]|--/.test(item.name)) {
      out.push({
        kind: 'package_title',
        confidence: 'low',
        items: [display],
        why: 'The name is long or punctuated like a package title, not like a thing you shop for.',
        suggestion: 'Rename to what it plainly is; the title can stay as the variant name.',
      });
    }
  }

  // Pairs. Rows a person already linked (an other name, a kind) are settled.
  const tokens = items.map(i => auditTokens(i.name));
  const linked = (a: GroceryItem, b: GroceryItem): boolean => {
    const declares = (x: GroceryItem, y: GroceryItem) =>
      otherNameKeysOf(x).includes(y.nameKey) || x.varietyOfKey === y.nameKey;
    return declares(a, b) || declares(b, a);
  };
  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      const a = items[i];
      const b = items[j];
      const ta = tokens[i];
      const tb = tokens[j];
      if (ta.length === 0 || tb.length === 0 || linked(a, b)) continue;
      const aInB = ta.every(w => tb.includes(w));
      const bInA = tb.every(w => ta.includes(w));
      if (aInB && bInA) {
        out.push({
          kind: 'same_words',
          confidence: 'high',
          items: [row(a), row(b)],
          why: 'Once case, plurals and filler words (fresh, organic) are set aside, the two names use the same words.',
          suggestion: 'merge_grocery_items into whichever you shop for; the other name is kept as an alias.',
        });
      } else if (aInB || bInA) {
        const [generic, specific] = aInB ? [a, b] : [b, a];
        out.push({
          kind: 'maybe_kind_of',
          confidence: 'low',
          items: [row(generic), row(specific)],
          why: `"${specific.name}" is "${generic.name}" with extra words.`,
          suggestion:
            'If one is a kind of the other, mark it with update_grocery_item kindOf. If they are the same thing, merge_grocery_items. If they differ on purpose, leave them.',
        });
      }
    }
  }
  return out;
}

/** The name with a brand's words taken out, or '' when nothing is left. */
export function withoutBrand(name: string, brand: string): string {
  const run = groceryNameKey(brand).split(/\s+/).filter(Boolean);
  const words = name.trim().split(/\s+/);
  const keys = words.map(w => groceryNameKey(w));
  for (let i = 0; i + run.length <= words.length; i++) {
    if (run.every((w, j) => keys[i + j] === w)) {
      return [...words.slice(0, i), ...words.slice(i + run.length)].join(' ').trim();
    }
  }
  return name.trim();
}

/**
 * A name to start a rename from, for one row's finding. Only a starting point:
 * a person edits it before it is saved, and a finding with nothing mechanical
 * to offer (a package title) starts from the name as it stands.
 */
export function suggestedName(finding: AuditFinding): string {
  const name = finding.items[0]?.name ?? '';
  switch (finding.kind) {
    case 'all_caps':
      return readableItemName(name);
    case 'size_in_name':
      return shopperNameFor(name, null);
    case 'brand_in_name':
      return finding.brand ? withoutBrand(name, finding.brand) : name;
    default:
      return name;
  }
}
