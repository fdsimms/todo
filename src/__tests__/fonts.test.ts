import {
  APP_FONT_OPTIONS,
  DEFAULT_APP_FONT,
  FONT_WEIGHT_KEYS,
  faceNamesFor,
  getAppFontOption,
  isAppFont,
  normalizeFontWeight,
  resolveFontFace,
  type AppFont,
} from '../theme/fonts';

describe('app font options', () => {
  it('has unique ids and no blank labels or hints', () => {
    const ids = APP_FONT_OPTIONS.map(o => o.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const opt of APP_FONT_OPTIONS) {
      expect(opt.label.trim()).not.toBe('');
      expect(opt.hint.trim()).not.toBe('');
    }
  });

  it('leads with the default, and the default names no face at any weight', () => {
    expect(APP_FONT_OPTIONS[0].id).toBe(DEFAULT_APP_FONT);
    // The default has to be a true no-op so the OS keeps deciding the font —
    // and so it loads nothing.
    for (const weight of FONT_WEIGHT_KEYS) {
      expect(resolveFontFace(DEFAULT_APP_FONT, weight)).toBeUndefined();
    }
    expect(faceNamesFor(DEFAULT_APP_FONT)).toEqual([]);
  });

  it('ships all four weights for every bundled font', () => {
    // A missing weight resolves to undefined and drops that text back to the
    // platform font mid-list, so this is the invariant that keeps a page whole.
    for (const opt of APP_FONT_OPTIONS.filter(o => o.id !== DEFAULT_APP_FONT)) {
      const faces = FONT_WEIGHT_KEYS.map(w => resolveFontFace(opt.id, w));
      expect(faces.every(Boolean)).toBe(true);
      expect(new Set(faces).size).toBe(FONT_WEIGHT_KEYS.length);
      expect(faceNamesFor(opt.id)).toHaveLength(FONT_WEIGHT_KEYS.length);
    }
  });
});

// fontAssets.ts can't be imported here — Jest doesn't transform `.ttf` requires
// — so it's checked as source text. Worth the awkwardness: a face name that
// disagrees with the key it's registered under fails *silently*, rendering as
// the platform font with nothing logged, and that's the whole contract between
// these two files.
describe('fontAssets.ts agrees with the font table', () => {
  const fs = require('fs') as typeof import('fs');
  const path = require('path') as typeof import('path');

  const source = fs.readFileSync(path.join(__dirname, '../theme/fontAssets.ts'), 'utf8');
  const entries = [...source.matchAll(/^\s{4}(\w+):\s*require\('([^']+)'\)/gm)];

  it('registers every face the font table names', () => {
    const registered = new Set(entries.map(([, face]) => face));
    for (const opt of APP_FONT_OPTIONS) {
      for (const face of faceNamesFor(opt.id)) {
        expect(registered).toContain(face);
      }
    }
  });

  it('points every face at a font file that exists', () => {
    expect(entries.length).toBeGreaterThan(0);
    for (const [, face, assetPath] of entries) {
      expect(assetPath.endsWith('.ttf')).toBe(true);
      // The file is named after the face it registers, so a mismatched pair is
      // visible right here rather than at runtime.
      expect(path.basename(assetPath, '.ttf')).toBe(face);
      expect(fs.existsSync(path.join(__dirname, '../../node_modules', assetPath))).toBe(true);
    }
  });
});

describe('normalizeFontWeight', () => {
  it('maps the four weights the app uses to themselves', () => {
    expect(normalizeFontWeight('400')).toBe(400);
    expect(normalizeFontWeight('500')).toBe(500);
    expect(normalizeFontWeight('600')).toBe(600);
    expect(normalizeFontWeight('700')).toBe(700);
  });

  it('treats an unset weight as regular, like React Native does', () => {
    expect(normalizeFontWeight(undefined)).toBe(400);
    expect(normalizeFontWeight(null)).toBe(400);
    expect(normalizeFontWeight('normal')).toBe(400);
  });

  it('understands the keyword and numeric forms', () => {
    expect(normalizeFontWeight('bold')).toBe(700);
    expect(normalizeFontWeight(600)).toBe(600);
  });

  it('snaps weights we do not bundle onto the nearest face we do', () => {
    // Rounding beats resolving to nothing: an unbundled face renders as the
    // platform font and breaks the page mid-list.
    expect(normalizeFontWeight('100')).toBe(400);
    expect(normalizeFontWeight('300')).toBe(400);
    expect(normalizeFontWeight('800')).toBe(700);
    expect(normalizeFontWeight('900')).toBe(700);
  });

  it('falls back to regular for a weight it cannot parse', () => {
    expect(normalizeFontWeight('heavyish')).toBe(400);
  });
});

describe('resolveFontFace', () => {
  it('picks the face for the weight', () => {
    expect(resolveFontFace('nunito', '400')).toBe('Nunito_400Regular');
    expect(resolveFontFace('nunito', '600')).toBe('Nunito_600SemiBold');
    expect(resolveFontFace('bricolage', 'bold')).toBe('BricolageGrotesque_700Bold');
    expect(resolveFontFace('fraunces', undefined)).toBe('Fraunces_400Regular');
    expect(resolveFontFace('spaceGrotesk', '500')).toBe('SpaceGrotesk_500Medium');
  });

  it('falls back to the platform font for an unknown id', () => {
    // A font dropped from the app but still stored in an old settings row.
    expect(resolveFontFace('retired-font' as AppFont, '400')).toBeUndefined();
  });
});

describe('isAppFont', () => {
  it('accepts every shipped id', () => {
    for (const opt of APP_FONT_OPTIONS) {
      expect(isAppFont(opt.id)).toBe(true);
    }
  });

  it('rejects anything else, so a stale stored value falls back to the default', () => {
    expect(isAppFont('avenir')).toBe(false);
    expect(isAppFont('')).toBe(false);
    expect(isAppFont(null)).toBe(false);
    expect(isAppFont(undefined)).toBe(false);
  });
});

describe('getAppFontOption', () => {
  it('finds an option by id', () => {
    expect(getAppFontOption('spaceGrotesk')?.label).toBe('Space Grotesk');
  });

  it('returns undefined for an unknown id', () => {
    expect(getAppFontOption('nope' as AppFont)).toBeUndefined();
  });
});
