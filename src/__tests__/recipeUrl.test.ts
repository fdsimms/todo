import {
  normalizeRecipeUrl,
  decodeEntities,
  htmlToText,
  metaContent,
  parseIsoDuration,
  parseRecipeJsonLd,
  focusRecipeText,
  recipeToPlainText,
  parseRecipePage,
} from '../utils/recipeUrl';

const LIMIT = 4_000;

/** Wraps a JSON-LD payload in the script tag a page would ship it in. */
const ldPage = (payload: unknown, extra = '') =>
  `<html><head>${extra}<script type="application/ld+json">${JSON.stringify(payload)}</script></head><body><p>Hello</p></body></html>`;

const RECIPE_LD = {
  '@context': 'https://schema.org',
  '@type': 'Recipe',
  name: 'Weeknight chilli',
  recipeYield: '4 servings',
  totalTime: 'PT1H15M',
  author: { '@type': 'Person', name: 'Alison Roman' },
  publisher: { '@type': 'Organization', name: 'NYT Cooking' },
  recipeIngredient: ['2 cans black beans, drained', '3 cloves garlic, minced', '1 tbsp cumin'],
  recipeInstructions: [
    { '@type': 'HowToStep', text: 'Soften the onion.' },
    { '@type': 'HowToStep', text: 'Add everything else and simmer.' },
  ],
};

describe('normalizeRecipeUrl', () => {
  it('fills in https for a bare address', () => {
    expect(normalizeRecipeUrl('example.com/chili')).toBe('https://example.com/chili');
    expect(normalizeRecipeUrl('  www.example.com/chili  ')).toBe('https://www.example.com/chili');
  });

  it('keeps an explicit scheme, lowercasing only the host', () => {
    expect(normalizeRecipeUrl('http://example.com/Chili')).toBe('http://example.com/Chili');
    expect(normalizeRecipeUrl('HTTPS://Example.COM/Chili')).toBe('https://example.com/Chili');
  });

  it('keeps the query and fragment intact', () => {
    expect(normalizeRecipeUrl('example.com/r?id=7&x=2#steps'))
      .toBe('https://example.com/r?id=7&x=2#steps');
  });

  it('allows a port', () => {
    expect(normalizeRecipeUrl('localrecipes.lan:8080/r')).toBe('https://localrecipes.lan:8080/r');
  });

  it('refuses a scheme that is not http(s)', () => {
    expect(normalizeRecipeUrl('mailto:cook@example.com')).toBeNull();
    expect(normalizeRecipeUrl('javascript:alert(1)')).toBeNull();
    expect(normalizeRecipeUrl('file:///etc/passwd')).toBeNull();
    expect(normalizeRecipeUrl('ftp://example.com/x')).toBeNull();
  });

  it('refuses a host with no dot — that is a machine, not a recipe site', () => {
    expect(normalizeRecipeUrl('localhost')).toBeNull();
    expect(normalizeRecipeUrl('http://localhost:3000/r')).toBeNull();
  });

  it('refuses credentials in the authority', () => {
    expect(normalizeRecipeUrl('https://evil.com@real-recipes.com/x')).toBeNull();
  });

  it('refuses anything with whitespace, or nothing at all', () => {
    expect(normalizeRecipeUrl('two cups flour')).toBeNull();
    expect(normalizeRecipeUrl('')).toBeNull();
    expect(normalizeRecipeUrl('   ')).toBeNull();
  });

  it('refuses a malformed host or port', () => {
    expect(normalizeRecipeUrl('example..com/x')).toBeNull();
    expect(normalizeRecipeUrl('.example.com/x')).toBeNull();
    expect(normalizeRecipeUrl('example.com:80x/x')).toBeNull();
  });
});

describe('decodeEntities', () => {
  it('decodes the named ones', () => {
    expect(decodeEntities('salt &amp; pepper')).toBe('salt & pepper');
    expect(decodeEntities('caf&eacute;')).toBe('café');
    expect(decodeEntities('a&nbsp;b')).toBe('a b');
  });

  it('decodes fractions, which are quantities', () => {
    expect(decodeEntities('&frac12; cup')).toBe('½ cup');
    expect(decodeEntities('&frac34; tsp')).toBe('¾ tsp');
  });

  it('decodes numeric and hex references', () => {
    expect(decodeEntities('don&#39;t')).toBe("don't");
    expect(decodeEntities('don&#x27;t')).toBe("don't");
  });

  it('leaves an unknown or out-of-range entity as written', () => {
    expect(decodeEntities('&notathing; x')).toBe('&notathing; x');
    expect(decodeEntities('&#9999999999;')).toBe('&#9999999999;');
  });
});

describe('htmlToText', () => {
  it('drops scripts and styles content and all', () => {
    const text = htmlToText('<p>Keep</p><script>var drop = 1;</script><style>.drop{}</style>');
    expect(text).toBe('Keep');
  });

  it('keeps line structure from block ends and breaks', () => {
    expect(htmlToText('<li>2 eggs</li><li>1 cup flour</li>')).toBe('2 eggs\n1 cup flour');
    expect(htmlToText('a<br>b')).toBe('a\nb');
  });

  it('collapses runs of whitespace without joining separate lines', () => {
    expect(htmlToText('<p>a    b</p>\n\n\n<p>c</p>')).toBe('a b\nc');
  });

  it('decodes entities in the text it keeps', () => {
    expect(htmlToText('<p>salt &amp; &frac12; cup</p>')).toBe('salt & ½ cup');
  });
});

describe('metaContent', () => {
  it('reads by property or by name, whichever the page used', () => {
    expect(metaContent('<meta property="og:site_name" content="NYT Cooking">', 'og:site_name'))
      .toBe('NYT Cooking');
    expect(metaContent('<meta name="og:title" content="Chilli">', 'og:title')).toBe('Chilli');
  });

  it('handles single quotes and reordered attributes', () => {
    expect(metaContent("<meta content='Serious Eats' property='og:site_name'>", 'og:site_name'))
      .toBe('Serious Eats');
  });

  it('is null when the tag is absent or empty', () => {
    expect(metaContent('<meta property="og:type" content="article">', 'og:site_name')).toBeNull();
    expect(metaContent('<meta property="og:site_name" content="">', 'og:site_name')).toBeNull();
  });
});

describe('parseIsoDuration', () => {
  it('reads hours and minutes', () => {
    expect(parseIsoDuration('PT1H30M')).toBe(90);
    expect(parseIsoDuration('PT45M')).toBe(45);
    expect(parseIsoDuration('PT2H')).toBe(120);
  });

  it('reads days and weeks, for a cure or a ferment', () => {
    expect(parseIsoDuration('P1D')).toBe(1440);
    expect(parseIsoDuration('P1W')).toBe(10080);
  });

  it('ignores seconds rather than rounding a minute up', () => {
    expect(parseIsoDuration('PT30M20S')).toBe(30);
  });

  it('is null for a zero, a non-duration, or a non-string', () => {
    expect(parseIsoDuration('PT0M')).toBeNull();
    expect(parseIsoDuration('90 minutes')).toBeNull();
    expect(parseIsoDuration(90)).toBeNull();
    expect(parseIsoDuration(null)).toBeNull();
  });
});

describe('parseRecipeJsonLd', () => {
  it('pulls a plain recipe node out of a page', () => {
    const recipe = parseRecipeJsonLd(ldPage(RECIPE_LD));
    expect(recipe).not.toBeNull();
    expect(recipe!.name).toBe('Weeknight chilli');
    expect(recipe!.ingredients).toEqual([
      '2 cans black beans, drained',
      '3 cloves garlic, minced',
      '1 tbsp cumin',
    ]);
    expect(recipe!.steps).toEqual(['Soften the onion.', 'Add everything else and simmer.']);
    expect(recipe!.recipeYield).toBe('4 servings');
    expect(recipe!.totalMinutes).toBe(75);
    expect(recipe!.author).toBe('Alison Roman');
    expect(recipe!.publisher).toBe('NYT Cooking');
  });

  it('finds it inside an @graph', () => {
    const page = ldPage({ '@context': 'https://schema.org', '@graph': [{ '@type': 'WebSite' }, RECIPE_LD] });
    expect(parseRecipeJsonLd(page)?.name).toBe('Weeknight chilli');
  });

  it('finds it inside a top-level array', () => {
    expect(parseRecipeJsonLd(ldPage([{ '@type': 'Person' }, RECIPE_LD]))?.name).toBe('Weeknight chilli');
  });

  it('accepts an @type array and a full schema.org URL', () => {
    const page = ldPage({ ...RECIPE_LD, '@type': ['NewsArticle', 'http://schema.org/Recipe'] });
    expect(parseRecipeJsonLd(page)?.name).toBe('Weeknight chilli');
  });

  it('prefers the fullest recipe when a page carries several', () => {
    const sidebar = { '@type': 'Recipe', name: 'Sidebar suggestion', recipeIngredient: ['1 egg'] };
    // Sidebar first, so first-in-document would pick the wrong one.
    expect(parseRecipeJsonLd(ldPage([sidebar, RECIPE_LD]))?.name).toBe('Weeknight chilli');
  });

  it('flattens HowToSections down to their steps', () => {
    const page = ldPage({
      ...RECIPE_LD,
      recipeInstructions: [
        {
          '@type': 'HowToSection',
          name: 'For the cake',
          itemListElement: [{ '@type': 'HowToStep', text: 'Cream the butter.' }],
        },
        {
          '@type': 'HowToSection',
          name: 'For the frosting',
          itemListElement: [{ '@type': 'HowToStep', text: 'Whip the cream.' }],
        },
      ],
    });
    expect(parseRecipeJsonLd(page)?.steps).toEqual(['Cream the butter.', 'Whip the cream.']);
  });

  it('splits a single instruction blob on newlines, never on sentences', () => {
    const page = ldPage({
      ...RECIPE_LD,
      recipeInstructions: 'Add 1.5 cups of stock. Simmer for Mr. Wong.\nThen serve.',
    });
    // One line stays one step — a sentence split would make four of these.
    expect(parseRecipeJsonLd(page)?.steps).toEqual([
      'Add 1.5 cups of stock. Simmer for Mr. Wong.',
      'Then serve.',
    ]);
  });

  it('strips markup out of instruction and ingredient text', () => {
    const page = ldPage({
      ...RECIPE_LD,
      recipeIngredient: ['<span>2 cans</span> black beans'],
      recipeInstructions: ['<p>Soften the <b>onion</b>.</p>'],
    });
    const recipe = parseRecipeJsonLd(page);
    expect(recipe?.ingredients).toEqual(['2 cans black beans']);
    expect(recipe?.steps).toEqual(['Soften the onion.']);
  });

  it('falls back to prep + cook when there is no totalTime', () => {
    const { totalTime, ...withoutTotal } = RECIPE_LD;
    const page = ldPage({ ...withoutTotal, prepTime: 'PT15M', cookTime: 'PT30M' });
    expect(parseRecipeJsonLd(page)?.totalMinutes).toBe(45);
  });

  it('takes the first entry of a recipeYield array', () => {
    expect(parseRecipeJsonLd(ldPage({ ...RECIPE_LD, recipeYield: ['6 servings', '6'] }))?.recipeYield)
      .toBe('6 servings');
  });

  it('reads an author given as a bare string or an array', () => {
    expect(parseRecipeJsonLd(ldPage({ ...RECIPE_LD, author: 'Nigel Slater' }))?.author)
      .toBe('Nigel Slater');
    expect(parseRecipeJsonLd(ldPage({ ...RECIPE_LD, author: [{ name: 'Nigel Slater' }] }))?.author)
      .toBe('Nigel Slater');
  });

  it('survives a CMS that HTML-escaped its own JSON', () => {
    const escaped = JSON.stringify(RECIPE_LD).replace(/"/g, '&quot;');
    const page = `<script type="application/ld+json">${escaped}</script>`;
    expect(parseRecipeJsonLd(page)?.name).toBe('Weeknight chilli');
  });

  it('is null for a page with no recipe markup, or with broken JSON', () => {
    expect(parseRecipeJsonLd('<html><body>no markup</body></html>')).toBeNull();
    expect(parseRecipeJsonLd(ldPage({ '@type': 'NewsArticle', name: 'Not a recipe' }))).toBeNull();
    expect(parseRecipeJsonLd('<script type="application/ld+json">{oh no</script>')).toBeNull();
  });

  it('stops descending rather than walking an arbitrarily nested graph', () => {
    // Well past the depth cap — it must come back empty-handed, not hang.
    let nested: unknown = RECIPE_LD;
    for (let i = 0; i < 40; i++) nested = { '@type': 'WebSite', '@graph': [nested] };
    expect(parseRecipeJsonLd(ldPage(nested))).toBeNull();
  });

  it('still reaches a recipe nested a realistic couple of levels down', () => {
    const page = ldPage({ '@graph': [{ '@type': 'WebPage', mainEntity: {} }, { '@graph': [RECIPE_LD] }] });
    expect(parseRecipeJsonLd(page)?.name).toBe('Weeknight chilli');
  });
});

describe('focusRecipeText', () => {
  it('leaves anything already short enough alone', () => {
    expect(focusRecipeText('short', 100)).toBe('short');
  });

  it('trims around the ingredients heading rather than off the front', () => {
    const story = 'My grandmother once told me. '.repeat(200);
    const text = `${story}\nIngredients\n2 eggs\n1 cup flour`;
    const focused = focusRecipeText(text, 500);
    expect(focused).toContain('Ingredients');
    expect(focused).toContain('1 cup flour');
    expect(focused.length).toBeLessThanOrEqual(500);
  });

  it('falls back to the front when there is no heading to anchor on', () => {
    const text = 'a'.repeat(1000);
    expect(focusRecipeText(text, 100)).toBe('a'.repeat(100));
  });
});

describe('recipeToPlainText', () => {
  it('writes the recipe back out as the text an extractor reads', () => {
    const recipe = parseRecipeJsonLd(ldPage(RECIPE_LD))!;
    const text = recipeToPlainText(recipe);
    expect(text).toContain('Weeknight chilli');
    expect(text).toContain('Yield: 4 servings');
    expect(text).toContain('Total time: 75 minutes');
    expect(text).toContain('3 cloves garlic, minced');
  });

  it('leaves out the method — the extractor is told to ignore it', () => {
    const recipe = parseRecipeJsonLd(ldPage(RECIPE_LD))!;
    expect(recipeToPlainText(recipe)).not.toContain('Soften the onion');
  });
});

describe('parseRecipePage', () => {
  it('prefers the structured recipe and reports it as such', () => {
    const parsed = parseRecipePage(
      ldPage(RECIPE_LD, '<meta property="og:site_name" content="NYT Cooking">'),
      LIMIT,
    );
    expect(parsed.structured).toBe(true);
    expect(parsed.title).toBe('Weeknight chilli');
    expect(parsed.siteName).toBe('NYT Cooking');
    expect(parsed.author).toBe('Alison Roman');
    expect(parsed.steps).toEqual(['Soften the onion.', 'Add everything else and simmer.']);
    expect(parsed.text).toContain('3 cloves garlic, minced');
  });

  it('prefers og:site_name over the JSON-LD publisher', () => {
    const parsed = parseRecipePage(
      ldPage(RECIPE_LD, '<meta property="og:site_name" content="Cooking">'),
      LIMIT,
    );
    expect(parsed.siteName).toBe('Cooking');
  });

  it('falls back to page text, and claims no method, when there is no markup', () => {
    const html = `
      <html><head><title>Chilli | A Food Blog</title></head>
      <body><h1>Chilli</h1><p>Ingredients</p><ul><li>2 cans beans</li></ul>
      <p>Method</p><ol><li>Simmer.</li></ol></body></html>`;
    const parsed = parseRecipePage(html, LIMIT);
    expect(parsed.structured).toBe(false);
    // A method guessed out of stripped page text is how a sidebar becomes step 3.
    expect(parsed.steps).toEqual([]);
    expect(parsed.text).toContain('2 cans beans');
    expect(parsed.title).toBe('Chilli | A Food Blog');
  });

  it('falls back when the markup has a recipe node but no ingredients in it', () => {
    const parsed = parseRecipePage(ldPage({ '@type': 'Recipe', name: 'Empty' }), LIMIT);
    expect(parsed.structured).toBe(false);
  });

  it('prefers og:title over <title> in the fallback', () => {
    const html = '<head><title>Chilli | A Food Blog</title><meta property="og:title" content="Chilli"></head><body>x</body>';
    expect(parseRecipePage(html, LIMIT).title).toBe('Chilli');
  });

  it('never sets the site name from the bare host', () => {
    expect(parseRecipePage('<html><body>nothing</body></html>', LIMIT).siteName).toBeNull();
  });
});
