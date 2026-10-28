import type { IngredientPrintSection } from './shareText';
import { describeAllergens, guessAllergens } from './allergenGuess';

/**
 * The two pages a person can print of a recipe's ingredients, for taking a
 * dish somewhere: a full page with the amounts, and a table card with names
 * only to set beside the dish. Both are HTML for `expo-print` to turn into a
 * PDF (`writePdfFile`).
 *
 * Always light, whatever the app's theme: it is paper. The allergen line is a
 * guess (`allergenGuess.ts`) and says so on the page, in the same words
 * whether or not anything was found, so its absence never reads as an all-clear.
 */

export interface IngredientPrintInput {
  name: string;
  /** "Serves 12", already worded for the scale the screen shows; null for none. */
  servingsLine: string | null;
  sections: readonly IngredientPrintSection[];
  /** Printed as "Made by …" on the card; blank leaves the line out. */
  madeBy?: string;
  /** Include the guessed allergen line. */
  showAllergens: boolean;
  /** The scaled list's footnote (`unscaledNoteFor`), under the amounts on the full page; null for none. */
  unscaledNote?: string | null;
}

export const ALLERGEN_CAVEAT = 'Guessed from the ingredient names, so it can miss things. Check labels if you have an allergy.';

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const e = escapeHtml;

const BASE_CSS = `*{box-sizing:border-box;margin:0;padding:0}
body{font-family:-apple-system,"Helvetica Neue",Arial,sans-serif;color:#17131C;background:#fff}
h1{font-weight:700;letter-spacing:-.3px}
.sub{color:#4F4A57}
h2{font-size:10px;font-weight:600;letter-spacing:.8px;color:#4F4A57;text-transform:uppercase}
.ing{border-bottom:1px solid #EEECF1;break-inside:avoid}
.sec{break-inside:avoid}
.allergens{font-weight:600}
.caveat{color:#6B6574}`;

function allergenBlock(input: IngredientPrintInput): { line: string | null } {
  if (!input.showAllergens) return { line: null };
  const names = input.sections.flatMap(s => s.names);
  return { line: describeAllergens(guessAllergens(names)) };
}

/** Full page: name, servings, allergen line, every ingredient with its amount under its heading. */
export function ingredientPageHtml(input: IngredientPrintInput): string {
  const { line } = allergenBlock(input);
  const sections = input.sections.map(section => `<div class="sec">${section.heading ? `<div class="sh">${e(section.heading)}</div>` : ''}${
    section.lines.map(l => `<div class="ing">${e(l)}</div>`).join('')
  }</div>`).join('');
  const allergens = input.showAllergens
    ? `<div class="allergen-box">${line ? `<div class="allergens">${e(line)}</div>` : ''}<div class="caveat">${e(ALLERGEN_CAVEAT)}</div></div>`
    : '';
  return `<!doctype html><html><head><meta charset="utf-8"><style>
${BASE_CSS}
.top{border-top:6px solid #6A3FDB;padding-top:18px}
h1{font-size:34px;line-height:1.1}
.sub{display:inline-block;font-size:13px;font-weight:600;color:#4B2BA8;background:#F0EAFC;border-radius:12px;padding:4px 12px;margin-top:12px}
.allergen-box{background:#FBF6EA;border-left:4px solid #D99A1E;border-radius:4px;padding:10px 14px;margin-top:20px;font-size:13px;line-height:1.45}
.allergens{font-size:14px}
.caveat{font-size:11px;margin-top:2px}
.main{font-size:20px;font-weight:700;letter-spacing:-.2px;margin:26px 0 14px;padding-bottom:8px;border-bottom:2px solid #17131C}
.cols{column-count:2;column-gap:40px}
.sec{margin-bottom:20px}
.sh{font-size:11px;font-weight:600;letter-spacing:1px;text-transform:uppercase;color:#6A3FDB;margin:0 0 4px}
.ing{font-size:15px;line-height:1.35;padding:6px 0}
</style></head><body>
<div class="top">
<h1>${e(input.name)}</h1>
${input.servingsLine ? `<div class="sub">${e(input.servingsLine)}</div>` : ''}
</div>
${allergens}
<div class="main">Ingredients</div>
<div class="cols">${sections}</div>
${input.unscaledNote ? `<div class="caveat">${e(input.unscaledNote)}.</div>` : ''}
</body></html>`;
}

/**
 * A card for the table: names only, since a guest wants to know what is in
 * the dish and not how much of it went in. It sits at the top of a Letter
 * page inside a dashed border to cut or fold along.
 */
export function ingredientCardHtml(input: IngredientPrintInput): string {
  const { line } = allergenBlock(input);
  const names = input.sections.flatMap(s => s.names);
  const meta = [input.servingsLine, input.madeBy?.trim() ? `Made by ${input.madeBy.trim()}` : null]
    .filter(Boolean)
    .join(' · ');
  return `<!doctype html><html><head><meta charset="utf-8"><style>
${BASE_CSS}
.card{width:100%;border:1px dashed #C9C6CF;border-top:5px solid #6A3FDB;padding:20px 26px}
h1{font-size:26px}
.sub{font-size:12px;margin-top:4px}
hr{border:0;border-top:2px solid #17131C;margin:12px 0 8px}
.cols{column-count:2;column-gap:24px}
.ing{font-size:13px;line-height:1.3;padding:3px 0}
.allergens{font-size:12px;margin-top:12px;background:#FBF6EA;border-left:4px solid #D99A1E;border-radius:4px;padding:6px 10px}
.caveat{font-size:10px;margin-top:2px}
</style></head><body><div class="card">
<h1>${e(input.name)}</h1>
${meta ? `<div class="sub">${e(meta)}</div>` : ''}
<hr>
<div class="cols">${names.map(n => `<div class="ing">${e(n)}</div>`).join('')}</div>
${input.showAllergens ? `${line ? `<div class="allergens">${e(line)}</div>` : ''}<div class="caveat">${e(ALLERGEN_CAVEAT)}</div>` : ''}
</div></body></html>`;
}

/** `lemon-orzo-salad-ingredients.pdf`. */
export function ingredientFileName(recipeName: string, kind: 'page' | 'card'): string {
  const slug = recipeName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'recipe';
  return `${slug}-${kind === 'card' ? 'card' : 'ingredients'}.pdf`;
}
