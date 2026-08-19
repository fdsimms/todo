// Cuts the dateUtils -> useSettingsStore -> database -> expo-sqlite chain that
// `describeAIError`'s module drags in; same mock aiSuggestions.test.ts uses, and
// nothing here reads a setting.
jest.mock('../store/useSettingsStore', () => ({
  useSettingsStore: { getState: () => ({ anthropicApiKey: null, aiFeatureConfig: {} }) },
}));

import {
  fetchRecipePage,
  describeImportError,
  isRecipePageError,
  isRetryableImportError,
  recipePageError,
  type RecipePageErrorCode,
} from '../services/recipePage';

/**
 * The service is a request plus a failure map — everything it does with the
 * bytes lives in `recipeUrl.ts` and is tested there. So these drive a stubbed
 * `fetch` and check which code comes out, plus that the mapper hands anything
 * that isn't a page error back to `describeAIError`.
 */

const RECIPE_LD = {
  '@context': 'https://schema.org',
  '@type': 'Recipe',
  name: 'Weeknight chilli',
  recipeIngredient: ['2 cans black beans', '3 cloves garlic'],
  recipeInstructions: [{ '@type': 'HowToStep', text: 'Simmer.' }],
  publisher: { name: 'A Food Blog' },
};

const ldPage = (payload: unknown) =>
  `<html><head><script type="application/ld+json">${JSON.stringify(payload)}</script></head><body></body></html>`;

interface StubOptions {
  status?: number;
  headers?: Record<string, string>;
  body?: string;
  throws?: Error;
}

function stubFetch({ status = 200, headers = {}, body = '', throws }: StubOptions) {
  const lower = new Map(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
  const impl = jest.fn(async () => {
    if (throws) throw throws;
    return {
      ok: status >= 200 && status < 300,
      status,
      headers: { get: (name: string) => lower.get(name.toLowerCase()) ?? null },
      text: async () => body,
    } as unknown as Response;
  });
  (global as unknown as { fetch: unknown }).fetch = impl;
  return impl;
}

/** Runs the fetch and returns the code it failed with, or 'ok'. */
async function codeOf(url: string): Promise<RecipePageErrorCode | 'ok'> {
  try {
    await fetchRecipePage(url);
    return 'ok';
  } catch (e) {
    return isRecipePageError(e) ? e.recipePageCode : 'ok';
  }
}

const originalFetch = global.fetch;
afterEach(() => {
  (global as unknown as { fetch: unknown }).fetch = originalFetch;
  jest.restoreAllMocks();
});

describe('fetchRecipePage', () => {
  it('reads a page that publishes a recipe', async () => {
    stubFetch({ headers: { 'content-type': 'text/html; charset=utf-8' }, body: ldPage(RECIPE_LD) });
    const page = await fetchRecipePage('example.com/chili');
    expect(page.url).toBe('https://example.com/chili');
    expect(page.structured).toBe(true);
    expect(page.title).toBe('Weeknight chilli');
    expect(page.siteName).toBe('A Food Blog');
    expect(page.steps).toEqual(['Simmer.']);
    expect(page.text).toContain('3 cloves garlic');
  });

  it('requests the normalised address, asking for HTML', async () => {
    const impl = stubFetch({ headers: { 'content-type': 'text/html' }, body: ldPage(RECIPE_LD) });
    await fetchRecipePage('  EXAMPLE.com/Chili  ');
    const [url, init] = impl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://example.com/Chili');
    expect((init.headers as Record<string, string>).Accept).toContain('text/html');
    expect(init.redirect).toBe('follow');
  });

  it('refuses a bad address without going near the network', async () => {
    const impl = stubFetch({ body: ldPage(RECIPE_LD) });
    expect(await codeOf('not a url')).toBe('badUrl');
    expect(await codeOf('mailto:cook@example.com')).toBe('badUrl');
    expect(impl).not.toHaveBeenCalled();
  });

  it('maps the statuses a site declines with', async () => {
    for (const [status, code] of [[403, 'blocked'], [401, 'blocked'], [429, 'blocked'],
      [404, 'notFound'], [410, 'notFound'], [500, 'serverError'], [503, 'serverError']] as const) {
      stubFetch({ status });
      expect(await codeOf('example.com/x')).toBe(code);
    }
  });

  it('refuses a link that is not a web page', async () => {
    stubFetch({ headers: { 'content-type': 'application/pdf' }, body: '%PDF' });
    expect(await codeOf('example.com/recipe.pdf')).toBe('notHtml');
  });

  it('accepts a page that declares no content type at all', async () => {
    stubFetch({ body: ldPage(RECIPE_LD) });
    expect(await codeOf('example.com/x')).toBe('ok');
  });

  it('refuses a page too big to read, by its declared length', async () => {
    stubFetch({ headers: { 'content-length': String(50_000_000) }, body: 'x' });
    expect(await codeOf('example.com/x')).toBe('tooLarge');
  });

  it('reports a timeout separately from being offline', async () => {
    const abort = new Error('Aborted');
    abort.name = 'AbortError';
    stubFetch({ throws: abort });
    expect(await codeOf('example.com/x')).toBe('timeout');

    stubFetch({ throws: new TypeError('Network request failed') });
    expect(await codeOf('example.com/x')).toBe('offline');
  });

  it('says so when a page came back with nothing readable in it', async () => {
    // The shape a JS-rendered site has: markup, no recipe, no text.
    stubFetch({ headers: { 'content-type': 'text/html' }, body: '<html><body><div id="root"></div></body></html>' });
    expect(await codeOf('example.com/x')).toBe('noRecipe');
  });

  it('accepts a thin page that did publish a recipe', async () => {
    // Structured markup has already proved itself — the length gate is only for
    // pages with nothing to go on.
    stubFetch({ headers: { 'content-type': 'text/html' }, body: ldPage(RECIPE_LD) });
    const page = await fetchRecipePage('example.com/x');
    expect(page.text.length).toBeLessThan(200);
    expect(page.structured).toBe(true);
  });

  it('falls back to page text when there is no markup to read', async () => {
    const body = `<html><body><h1>Chilli</h1><p>Ingredients</p><ul>${
      Array.from({ length: 30 }, (_, i) => `<li>${i + 1} cup thing number ${i}</li>`).join('')
    }</ul></body></html>`;
    stubFetch({ headers: { 'content-type': 'text/html' }, body });
    const page = await fetchRecipePage('example.com/x');
    expect(page.structured).toBe(false);
    expect(page.steps).toEqual([]);
    expect(page.text).toContain('1 cup thing number 0');
  });
});

describe('describeImportError', () => {
  it('has copy for every page failure, and says what to do instead', () => {
    const codes: RecipePageErrorCode[] = ['badUrl', 'timeout', 'offline', 'blocked',
      'notFound', 'serverError', 'notHtml', 'tooLarge', 'noRecipe'];
    for (const code of codes) {
      const message = describeImportError(recipePageError(code));
      expect(message).toBeTruthy();
      expect(message).not.toContain(code);
    }
    // The three dead ends all point back at the paste box, which still works.
    for (const code of ['blocked', 'notHtml', 'tooLarge', 'noRecipe'] as const) {
      expect(describeImportError(recipePageError(code)).toLowerCase()).toContain('paste');
    }
  });

  it('hands anything else to the AI error mapper', () => {
    expect(describeImportError(new Error('API error 401'))).toBe('Check your API key in Settings.');
    expect(describeImportError(new Error('Request timed out'))).toBe('The request timed out. Try again.');
    expect(describeImportError(new Error('No API key configured. Add your Anthropic API key in Settings.')))
      .toBe('Add your Anthropic API key in Settings.');
  });
});

describe('isRecipePageError', () => {
  it('recognises its own errors and nothing else', () => {
    expect(isRecipePageError(recipePageError('blocked'))).toBe(true);
    expect(isRecipePageError(new Error('API error 500'))).toBe(false);
    expect(isRecipePageError(null)).toBe(false);
    expect(isRecipePageError('blocked')).toBe(false);
  });
});

describe('isRetryableImportError', () => {
  it('offers a retry only where the same input could plausibly work', () => {
    for (const code of ['timeout', 'offline', 'serverError'] as const) {
      expect(isRetryableImportError(recipePageError(code))).toBe(true);
    }
  });

  it('refuses one for every deterministic failure', () => {
    // Each of these fails identically however many times you ask, and the
    // error state offers a way back to the input instead.
    for (const code of ['badUrl', 'blocked', 'notFound', 'notHtml', 'tooLarge', 'noRecipe'] as const) {
      expect(isRetryableImportError(recipePageError(code))).toBe(false);
    }
  });

  it('refuses one for the AI failures a retry never fixed either', () => {
    expect(isRetryableImportError(new Error('No API key configured. Add your Anthropic API key in Settings.'))).toBe(false);
    expect(isRetryableImportError(new Error('AI feature disabled'))).toBe(false);
    expect(isRetryableImportError(new Error('API error 401'))).toBe(false);
  });

  it('keeps offering one for a transient model failure', () => {
    for (const message of ['Request timed out', 'API error 429', 'API error 503', 'Response was truncated']) {
      expect(isRetryableImportError(new Error(message))).toBe(true);
    }
    // An unrecognised throw is treated as transient, which is the safe default:
    // an offered retry that fails is recoverable, a withheld one is a dead end.
    expect(isRetryableImportError(new Error('kaboom'))).toBe(true);
    expect(isRetryableImportError(null)).toBe(true);
  });

  it('covers every code the union declares', () => {
    // Guards the set against a code added later and silently left retryable.
    const codes: RecipePageErrorCode[] = ['badUrl', 'timeout', 'offline', 'blocked',
      'notFound', 'serverError', 'notHtml', 'tooLarge', 'noRecipe'];
    const retryable = codes.filter(c => isRetryableImportError(recipePageError(c)));
    expect(retryable.sort()).toEqual(['offline', 'serverError', 'timeout']);
  });
});
