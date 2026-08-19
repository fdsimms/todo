import { MAX_RECIPE_CHARS, describeAIError } from './aiSuggestions';
import { normalizeRecipeUrl, parseRecipePage, type ParsedRecipePage } from '../utils/recipeUrl';

/**
 * Fetching a recipe page. The **second** place this app talks to the network,
 * and the first that talks to a host the user names rather than to
 * `api.anthropic.com` — which is the whole of what's new here, so it gets its
 * own module rather than a branch inside `aiSuggestions`.
 *
 * Thin by construction: this does the request and maps its failures, and every
 * decision about what the returned bytes *mean* lives in `utils/recipeUrl.ts`
 * where it can be tested. The extraction that follows is the existing one — a
 * fetched page becomes a string and takes the same path a paste already does.
 */

const REQUEST_TIMEOUT_MS = 20_000;
/**
 * How much page we'll accept. Recipe sites are bloated — 2MB of markup for one
 * chilli is ordinary — but the cap keeps a mis-typed link to a video file from
 * being read into memory as one string.
 *
 * Checked against `content-length` (bytes) and against the decoded string
 * (UTF-16 units), which are not the same unit. That's deliberate rather than
 * sloppy: this is a backstop against something absurd, not a budget anyone is
 * spending to the last byte, and the two readings agree to well within the
 * order of magnitude that matters here. `MAX_RECIPE_CHARS` is the cap that has
 * to be exact, and it's applied downstream by `parseRecipePage`.
 */
const MAX_PAGE_SIZE = 4_000_000;

/**
 * Honest, and deliberately not a browser's.
 *
 * A fair number of sites will refuse this and serve a 403. That's their call to
 * make, and the answer to it is the one the app already had — open the page,
 * copy the recipe, paste it — which `describeImportError` says in as many
 * words. Impersonating Chrome to get around a block the site put there on
 * purpose is not something to do quietly on a user's behalf.
 */
const USER_AGENT = 'dundundun/1.0 (recipe import; on-device)';

export type RecipePageErrorCode =
  | 'badUrl'
  | 'timeout'
  | 'offline'
  | 'blocked'
  | 'notFound'
  | 'serverError'
  | 'notHtml'
  | 'tooLarge'
  | 'noRecipe';

/**
 * Tagged with a plain property rather than an `instanceof` check on an Error
 * subclass: `extends Error` survives neither Hermes' nor ts-jest's downlevelling
 * reliably, and a failed `instanceof` here would silently mean every page error
 * rendered as "check your API key".
 */
export interface RecipePageError extends Error {
  recipePageCode: RecipePageErrorCode;
}

export function recipePageError(code: RecipePageErrorCode): RecipePageError {
  const error = new Error(`Recipe page error: ${code}`) as RecipePageError;
  error.recipePageCode = code;
  return error;
}

export function isRecipePageError(error: unknown): error is RecipePageError {
  return (
    !!error &&
    typeof error === 'object' &&
    typeof (error as RecipePageError).recipePageCode === 'string'
  );
}

const MESSAGES: Record<RecipePageErrorCode, string> = {
  badUrl: 'That doesn’t look like a web address. Check it and try again.',
  timeout: 'That page took too long to load. Try again.',
  offline: 'Couldn’t reach that page. Check your connection.',
  blocked: 'That site wouldn’t let dundundun read the page. Open it in a browser, copy the recipe, and paste it instead.',
  notFound: 'That page isn’t there any more. Check the link.',
  serverError: 'That site is having problems. Try again shortly.',
  notHtml: 'That link isn’t a web page. Paste the recipe text instead.',
  tooLarge: 'That page is too big to read. Paste the recipe text instead.',
  noRecipe: 'Nothing readable came back from that page — some sites build the recipe in the browser. Open it, copy the recipe, and paste it instead.',
};

/**
 * The one error mapper the import sheets call. A run is now a page fetch
 * *then* an extraction, so both failures arrive at the same catch — and mapping
 * only the second would render "That site wouldn't let us in" as "check your
 * API key in Settings".
 */
export function describeImportError(error: unknown): string {
  if (isRecipePageError(error)) return MESSAGES[error.recipePageCode];
  return describeAIError(error);
}

/**
 * Codes where trying the *exact same input* again could plausibly work. The
 * rest are deterministic: a 404 is a typo in the path, a site that refuses this
 * user agent will refuse it again, and a page that builds its recipe in the
 * browser will keep doing that. Retrying those spins forever.
 */
const RETRYABLE: ReadonlySet<RecipePageErrorCode> = new Set(['timeout', 'offline', 'serverError']);

/**
 * Whether the error state should offer "Try again" or a way back to the input.
 *
 * Only mattered once a link could fail. A paste and a photo failed almost
 * exclusively at the model — rate limits, timeouts, 5xx — where a retry is both
 * the right offer and the only one needed, so the sheets hard-coded it. A link
 * fails at the *address* most of the time, and the fix for that is editing it,
 * which a retry-only error state gives no way to reach.
 *
 * The three AI failures that are equally deterministic (no key, feature off, a
 * key the API rejected) come along for free — a retry never fixed those either,
 * it just looked like it might.
 */
export function isRetryableImportError(error: unknown): boolean {
  if (isRecipePageError(error)) return RETRYABLE.has(error.recipePageCode);
  const message = error instanceof Error ? error.message : '';
  if (message.startsWith('No API key')) return false;
  if (message === 'AI feature disabled') return false;
  if (message === 'API error 401') return false;
  return true;
}

export interface FetchedRecipePage extends ParsedRecipePage {
  /** The normalised address actually requested — what gets saved as `sourceUrl`. */
  url: string;
}

/** Content types worth trying to read a recipe out of. */
const HTML_TYPE = /^(text\/html|application\/xhtml\+xml|text\/plain)/i;

/**
 * A page's readable recipe, or a thrown `RecipePageError` naming why not.
 *
 * Redirects are followed (a shared recipe link is nearly always a shortener or
 * a tracking wrapper), and `url` comes back as the address requested rather
 * than the one landed on — `Response.url` is unreliable across RN's fetch, and
 * the link the user pasted is the one they'd recognise in the recipe's source
 * field anyway.
 */
export async function fetchRecipePage(input: string): Promise<FetchedRecipePage> {
  const url = normalizeRecipeUrl(input);
  if (!url) throw recipePageError('badUrl');

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  let response: Response;
  try {
    response = await fetch(url, {
      method: 'GET',
      headers: {
        // Sites routinely serve a different page to a client that doesn't ask
        // for HTML — often a JSON API stub with no recipe markup in it.
        Accept: 'text/html,application/xhtml+xml',
        'User-Agent': USER_AGENT,
      },
      redirect: 'follow',
      signal: controller.signal,
    });
  } catch (e) {
    if (e instanceof Error && e.name === 'AbortError') throw recipePageError('timeout');
    throw recipePageError('offline');
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) {
    const { status } = response;
    if (status === 404 || status === 410) throw recipePageError('notFound');
    if (status >= 500) throw recipePageError('serverError');
    // 401/403 are the paywall and the bot block; 429 is being told to slow
    // down. All three are the site declining, and the way out is the same one.
    throw recipePageError('blocked');
  }

  const contentType = response.headers?.get?.('content-type') ?? null;
  if (contentType && !HTML_TYPE.test(contentType)) throw recipePageError('notHtml');

  const declaredLength = Number(response.headers?.get?.('content-length') ?? NaN);
  if (Number.isFinite(declaredLength) && declaredLength > MAX_PAGE_SIZE) {
    throw recipePageError('tooLarge');
  }

  let html: string;
  try {
    html = await response.text();
  } catch {
    throw recipePageError('offline');
  }
  if (html.length > MAX_PAGE_SIZE) throw recipePageError('tooLarge');

  const parsed = parseRecipePage(html, MAX_RECIPE_CHARS);
  // A page with structured markup has already proved itself. Without it, too
  // little text back means the recipe is built in the browser and never
  // appeared in the markup — worth saying so, rather than sending an empty
  // string to the model and reporting whatever it makes of it.
  if (!parsed.structured && parsed.text.length < 200) throw recipePageError('noRecipe');

  return { ...parsed, url };
}
