/**
 * Reading a recipe off a web page.
 *
 * Everything here is pure — a string in, data out — so the fetch itself lives in
 * `src/services/recipePage.ts` and this module is testable in the `node`
 * environment the rest of the suite runs in. No `URL`, no `DOMParser`: React
 * Native ships a partial `URL` and no DOM at all, so both are parsed by hand
 * rather than depending on a global whose behaviour differs between the app and
 * the test runner.
 *
 * **The JSON-LD path is not a bypass of the AI extraction, it is a better input
 * to it.** `extractRecipe`'s own note is right that a parser can't turn "3 cloves
 * garlic, minced" into a shop's "garlic" — so what a page's `schema.org/Recipe`
 * block buys is a short, ordered, furniture-free ingredient list where the
 * alternative is 40kB of stripped page text that `MAX_RECIPE_CHARS` would cut
 * off somewhere in the writer's childhood anecdote. One extraction path, one
 * schema, one validator; this only decides what text reaches it.
 *
 * The method is the exception, and it's the one thing taken verbatim: a page
 * that publishes `recipeInstructions` has already done the structuring, so
 * running it through a model that is under instruction to *ignore* the method
 * would spend tokens to lose information.
 */

/** Recognised on the way in; anything else is not a page to read. */
const SCHEME = /^([a-z][a-z0-9+.-]*):\/\//i;

/**
 * A URL typed or pasted by a person, canonicalised — or null when it isn't one.
 *
 * A missing scheme is filled in as `https`, since that's what a person means by
 * "example.com/chili" and the http fallback is a downgrade nobody asked for.
 * Two refusals are deliberate rather than tidied up: a host with no dot is a
 * machine on the local network rather than a recipe site, and `user@host` is the
 * shape a link takes when it wants to be read as a different host than it opens.
 */
export function normalizeRecipeUrl(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed || /\s/.test(trimmed)) return null;

  const scheme = SCHEME.exec(trimmed);
  if (scheme && !/^https?$/i.test(scheme[1])) return null;
  const withoutScheme = scheme ? trimmed.slice(scheme[0].length) : trimmed;

  const cut = withoutScheme.search(/[/?#]/);
  const authority = cut === -1 ? withoutScheme : withoutScheme.slice(0, cut);
  const path = cut === -1 ? '' : withoutScheme.slice(cut);
  if (!authority || authority.includes('@')) return null;

  const portAt = authority.lastIndexOf(':');
  const host = portAt === -1 ? authority : authority.slice(0, portAt);
  const port = portAt === -1 ? '' : authority.slice(portAt);
  if (port && !/^:\d+$/.test(port)) return null;
  if (!/^[a-z0-9.-]+$/i.test(host)) return null;
  const labels = host.split('.');
  if (labels.length < 2 || labels.some(label => !label)) return null;

  const protocol = scheme ? scheme[1].toLowerCase() : 'https';
  return `${protocol}://${host.toLowerCase()}${port}${path}`;
}

// ——— Entities and tags ————————————————————————————————————————————————

/**
 * The named entities a recipe page actually produces. The fractions are the
 * reason this isn't just the XML five: "&frac12; cup" is a quantity, and left
 * undecoded it reaches the extractor as the word "frac12".
 */
const NAMED_ENTITIES: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
  ndash: '–', mdash: '—', hellip: '…', middot: '·', bull: '•',
  lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”',
  deg: '°', times: '×', frac12: '½', frac13: '⅓', frac23: '⅔',
  frac14: '¼', frac34: '¾', frac18: '⅛', frac38: '⅜', frac58: '⅝', frac78: '⅞',
  eacute: 'é', egrave: 'è', ccedil: 'ç', ntilde: 'ñ', uuml: 'ü', ouml: 'ö', auml: 'ä',
};

export function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z][a-z0-9]*);/gi, (whole, body: string) => {
    if (body[0] === '#') {
      const code = body[1] === 'x' || body[1] === 'X'
        ? parseInt(body.slice(2), 16)
        : parseInt(body.slice(1), 10);
      // Surrogates and out-of-range values come back from fromCodePoint as a
      // throw; a page that emits one gets its literal text back rather than
      // taking the whole parse down.
      if (!Number.isFinite(code) || code <= 0 || code > 0x10ffff) return whole;
      try {
        return String.fromCodePoint(code);
      } catch {
        return whole;
      }
    }
    const named = NAMED_ENTITIES[body.toLowerCase()];
    return named ?? whole;
  });
}

/** Elements whose *content* is not page text — dropped whole, not just untagged. */
const NON_TEXT_ELEMENTS = /<(script|style|noscript|template|svg|iframe)\b[^>]*>[\s\S]*?<\/\1\s*>/gi;
const BLOCK = 'p|div|li|ul|ol|table|tr|td|th|dl|dt|dd|h[1-6]|section|article|header|footer|blockquote|figcaption';
/**
 * Both ends of a block element break the line. The *opening* tag counts too
 * because unclosed `<li>`s are ordinary in hand-written markup, and on a closing
 * tag alone an ingredient list written that way comes out as one run-on line.
 */
const BLOCK_EDGE = new RegExp(`</?(?:${BLOCK})\\b[^>]*>`, 'gi');

/**
 * A page's readable text, with its line structure kept and its markup gone.
 *
 * Inline tags are replaced with **nothing**, not with a space: `the
 * <b>onion</b>.` has to come back as "the onion.", and a space there gives
 * "the onion ." — which then reaches the extractor as a quantity line with a
 * stray token in it. Block edges are what put the spaces back where they belong.
 */
export function htmlToText(html: string): string {
  const stripped = html
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(NON_TEXT_ELEMENTS, ' ')
    .replace(BLOCK_EDGE, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]*>/g, '');
  return decodeEntities(stripped)
    .replace(/\r\n?/g, '\n')
    .replace(/[^\S\n]+/g, ' ')
    .replace(/ *\n */g, '\n')
    // A run of breaks is still one break. Paragraph spacing buys the extractor
    // nothing and costs characters against MAX_RECIPE_CHARS, which is the one
    // budget this text is actually competing for.
    .replace(/\n{2,}/g, '\n')
    .trim();
}

/** The value of one attribute on one tag, quoted or bare. */
function attr(tag: string, name: string): string | null {
  const match = new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s"'>]+))`, 'i').exec(tag);
  if (!match) return null;
  return decodeEntities(match[1] ?? match[2] ?? match[3] ?? '').trim() || null;
}

/**
 * `<meta property="og:site_name" content="…">`, by either `property` or `name`
 * — Open Graph uses the first and plain HTML the second, and pages mix them.
 */
export function metaContent(html: string, key: string): string | null {
  const tags = html.match(/<meta\b[^>]*>/gi) ?? [];
  for (const tag of tags) {
    const which = attr(tag, 'property') ?? attr(tag, 'name');
    if (which && which.toLowerCase() === key.toLowerCase()) {
      const content = attr(tag, 'content');
      if (content) return content;
    }
  }
  return null;
}

// ——— schema.org/Recipe ————————————————————————————————————————————————

/** What a page published about its recipe, before any of it is interpreted. */
export interface PageRecipe {
  name: string | null;
  /** Verbatim ingredient lines — "3 cloves garlic, minced". */
  ingredients: string[];
  /** The method, in order, already flattened out of steps and sections. */
  steps: string[];
  /** `recipeYield` as written ("4 servings", "2 loaves"); read by the extractor. */
  recipeYield: string | null;
  totalMinutes: number | null;
  author: string | null;
  publisher: string | null;
}

const ISO_DURATION = /^P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:[\d.]+S)?)?$/i;

/** `"PT1H30M"` → 90. Null for anything that isn't a positive duration. */
export function parseIsoDuration(value: unknown): number | null {
  if (typeof value !== 'string') return null;
  const match = ISO_DURATION.exec(value.trim());
  if (!match) return null;
  const minutes =
    Number(match[1] ?? 0) * 7 * 24 * 60 +
    Number(match[2] ?? 0) * 24 * 60 +
    Number(match[3] ?? 0) * 60 +
    Number(match[4] ?? 0);
  return minutes > 0 ? minutes : null;
}

function typeMatches(value: unknown, wanted: string): boolean {
  const one = (t: unknown) =>
    typeof t === 'string' && t.split(/[/#]/).pop()?.toLowerCase() === wanted.toLowerCase();
  return Array.isArray(value) ? value.some(one) : one(value);
}

type Node = Record<string, unknown>;

/**
 * Every `Recipe` node in one parsed JSON-LD value. A page may wrap it in an
 * array, in `@graph`, or in neither, and the depth cap is what stops a
 * self-referencing graph from walking forever.
 */
function collectRecipes(value: unknown, out: Node[], depth = 0): void {
  if (depth > 6 || !value || typeof value !== 'object') return;
  if (Array.isArray(value)) {
    value.forEach(entry => collectRecipes(entry, out, depth + 1));
    return;
  }
  const node = value as Node;
  if (typeMatches(node['@type'], 'Recipe')) out.push(node);
  if (node['@graph']) collectRecipes(node['@graph'], out, depth + 1);
}

function asText(value: unknown): string | null {
  if (typeof value === 'string') {
    const text = htmlToText(value);
    return text || null;
  }
  if (typeof value === 'number') return String(value);
  return null;
}

/** `author`/`publisher`: a string, a `{name}`, or an array of either. */
function nameOf(value: unknown): string | null {
  if (typeof value === 'string') return value.trim() || null;
  if (Array.isArray(value)) {
    for (const entry of value) {
      const name = nameOf(entry);
      if (name) return name;
    }
    return null;
  }
  if (value && typeof value === 'object') {
    const name = (value as Node).name;
    if (typeof name === 'string') return name.trim() || null;
  }
  return null;
}

/**
 * `recipeInstructions` in each of the four shapes pages actually publish: one
 * blob, a list of strings, a list of `HowToStep`, and `HowToSection`s holding
 * their own `itemListElement` lists. A blob is split on newlines — the same
 * call `cookMode`'s `stepsFromNotes` makes, and for the same reason, since a
 * sentence split is what turns "add 1.5 cups" into two steps.
 */
function flattenInstructions(value: unknown, out: string[], depth = 0): void {
  if (depth > 4 || !value) return;
  if (typeof value === 'string') {
    htmlToText(value)
      .split('\n')
      .map(line => line.trim())
      .filter(Boolean)
      .forEach(line => out.push(line));
    return;
  }
  if (Array.isArray(value)) {
    value.forEach(entry => flattenInstructions(entry, out, depth + 1));
    return;
  }
  if (typeof value !== 'object') return;
  const node = value as Node;
  if (node.itemListElement) {
    flattenInstructions(node.itemListElement, out, depth + 1);
    return;
  }
  const text = asText(node.text) ?? asText(node.name);
  if (text) out.push(text);
}

/**
 * Parses out of a `<script type="application/ld+json">` block, tolerating the
 * one malformation that's common enough to be worth handling: a CMS that
 * HTML-escapes the JSON it emits. Script content is raw text per the spec, so
 * `&quot;` there is a bug — but it's a frequent one, and retrying the decode
 * costs a line.
 */
function parseJson(raw: string): unknown {
  const body = raw.trim().replace(/^<!\[CDATA\[/, '').replace(/\]\]>$/, '');
  if (!body) return null;
  try {
    return JSON.parse(body);
  } catch {
    try {
      return JSON.parse(decodeEntities(body));
    } catch {
      return null;
    }
  }
}

const LD_JSON = /<script\b[^>]*\btype\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script\s*>/gi;

/**
 * The page's own `schema.org/Recipe`, or null when it doesn't publish one.
 *
 * When a page carries several — a round-up post, or a recipe plus the one in a
 * "you might also like" block — the one with the most ingredients wins. It's a
 * crude rule and it's the right one: the recipe the page is *about* is the one
 * it describes most fully, and every alternative (first-in-document, longest
 * method, closest to the title) picks the sidebar on some real site.
 */
export function parseRecipeJsonLd(html: string): PageRecipe | null {
  const nodes: Node[] = [];
  LD_JSON.lastIndex = 0;
  let block: RegExpExecArray | null;
  while ((block = LD_JSON.exec(html)) !== null) {
    collectRecipes(parseJson(block[1]), nodes);
  }
  if (nodes.length === 0) return null;

  const parsed = nodes.map<PageRecipe>(node => {
    const ingredients = (Array.isArray(node.recipeIngredient) ? node.recipeIngredient
      : Array.isArray(node.ingredients) ? node.ingredients
      : [])
      .map(asText)
      .filter((line): line is string => !!line);

    const steps: string[] = [];
    flattenInstructions(node.recipeInstructions, steps);

    const yieldValue = Array.isArray(node.recipeYield) ? node.recipeYield[0] : node.recipeYield;

    return {
      name: asText(node.name),
      ingredients,
      steps,
      recipeYield: asText(yieldValue),
      totalMinutes:
        parseIsoDuration(node.totalTime) ??
        // No totalTime is common; cook + prep is the same number when both are
        // given, and either alone still beats reporting nothing.
        ((parseIsoDuration(node.cookTime) ?? 0) + (parseIsoDuration(node.prepTime) ?? 0) || null),
      author: nameOf(node.author),
      publisher: nameOf(node.publisher),
    };
  });

  return parsed.reduce((best, current) =>
    current.ingredients.length > best.ingredients.length ? current : best);
}

// ——— What reaches the extractor ————————————————————————————————————————

/** The heading a fallback page is trimmed around — see `focusRecipeText`. */
const INGREDIENTS_HEADING = /^ *ingredients\b/im;

/**
 * A page too long to send, trimmed to the part that matters.
 *
 * A food blog puts the story first and the recipe last, so a plain
 * `slice(0, limit)` reliably keeps the anecdote and drops the ingredients —
 * exactly backwards. Anchoring on the "Ingredients" heading keeps a little of
 * what sits above it (the title and the "serves 4" line usually do) and the
 * whole of what follows.
 */
export function focusRecipeText(text: string, limit: number): string {
  if (text.length <= limit) return text;
  const at = text.search(INGREDIENTS_HEADING);
  if (at === -1) return text.slice(0, limit);
  const start = Math.max(0, at - 300);
  return text.slice(start, start + limit);
}

/** A `PageRecipe` written back out as the plain recipe text an extractor reads. */
export function recipeToPlainText(recipe: PageRecipe): string {
  const lines: string[] = [];
  if (recipe.name) lines.push(recipe.name, '');
  if (recipe.recipeYield) lines.push(`Yield: ${recipe.recipeYield}`);
  if (recipe.totalMinutes !== null) lines.push(`Total time: ${recipe.totalMinutes} minutes`);
  if (recipe.recipeYield || recipe.totalMinutes !== null) lines.push('');
  lines.push('Ingredients:');
  recipe.ingredients.forEach(line => lines.push(line));
  return lines.join('\n').trim();
}

export interface ParsedRecipePage {
  /** The recipe text to hand `extractRecipe`. */
  text: string;
  /** The page's own title for the recipe, when it gave one. */
  title: string | null;
  /** The publication — `og:site_name` or the JSON-LD publisher. Never the host. */
  siteName: string | null;
  author: string | null;
  /**
   * The method, taken verbatim and only ever from structured data. Empty when
   * the page published none — a method guessed out of stripped page text is
   * how a sidebar ends up saved as step 3.
   */
  steps: string[];
  /** Whether the page published a `schema.org/Recipe` at all. */
  structured: boolean;
}

/**
 * One page of HTML, reduced to what the import needs.
 *
 * `limit` is the extractor's own text cap, passed in rather than restated here
 * so the two can't drift — see `MAX_RECIPE_CHARS`. The structured path is
 * comfortably under it (an ingredient list is a few hundred characters); the
 * fallback is what the cap is for.
 */
export function parseRecipePage(html: string, limit: number): ParsedRecipePage {
  const structured = parseRecipeJsonLd(html);
  const siteName = metaContent(html, 'og:site_name') ?? structured?.publisher ?? null;

  if (structured && structured.ingredients.length > 0) {
    return {
      text: focusRecipeText(recipeToPlainText(structured), limit),
      title: structured.name,
      siteName,
      author: structured.author,
      steps: structured.steps,
      structured: true,
    };
  }

  // No usable recipe markup — hand the extractor the readable page and let it
  // do the job it already does for a paste.
  const title =
    structured?.name ??
    metaContent(html, 'og:title') ??
    asText(/<title\b[^>]*>([\s\S]*?)<\/title\s*>/i.exec(html)?.[1] ?? null);

  return {
    text: focusRecipeText(htmlToText(html), limit),
    title,
    siteName,
    author: structured?.author ?? null,
    steps: [],
    structured: false,
  };
}
