import {
  APP_FONT_OPTIONS,
  DEFAULT_APP_FONT,
  getAppFontOption,
  isAppFont,
  resolveFontFamily,
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

  it('leads with the default, and the default names no family on any platform', () => {
    expect(APP_FONT_OPTIONS[0].id).toBe(DEFAULT_APP_FONT);
    // The default has to be a true no-op rather than a restatement of the
    // platform font, so the OS keeps deciding what it is.
    expect(resolveFontFamily(DEFAULT_APP_FONT, 'ios')).toBeUndefined();
    expect(resolveFontFamily(DEFAULT_APP_FONT, 'android')).toBeUndefined();
  });

  it('names a family on both platforms for every non-default option', () => {
    for (const opt of APP_FONT_OPTIONS.filter(o => o.id !== DEFAULT_APP_FONT)) {
      expect(resolveFontFamily(opt.id, 'ios')).toBeTruthy();
      expect(resolveFontFamily(opt.id, 'android')).toBeTruthy();
    }
  });
});

describe('resolveFontFamily', () => {
  it('picks the family for the platform', () => {
    expect(resolveFontFamily('serif', 'ios')).toBe('Charter');
    expect(resolveFontFamily('serif', 'android')).toBe('serif');
    expect(resolveFontFamily('mono', 'ios')).toBe('Menlo');
    expect(resolveFontFamily('condensed', 'ios')).toBe('Avenir Next Condensed');
  });

  it('falls back to the platform default on an unknown platform', () => {
    // web/windows/macos never see these iOS family names, so they get nothing
    // rather than a family that isn't installed.
    expect(resolveFontFamily('serif', 'web')).toBeUndefined();
  });

  it('falls back to the platform default for an unknown id', () => {
    // A font removed from the app but still stored in an old settings row.
    expect(resolveFontFamily('retired-font' as AppFont, 'ios')).toBeUndefined();
  });
});

describe('isAppFont', () => {
  it('accepts every shipped id', () => {
    for (const opt of APP_FONT_OPTIONS) {
      expect(isAppFont(opt.id)).toBe(true);
    }
  });

  it('rejects anything else, so a stale stored value falls back to the default', () => {
    expect(isAppFont('comic-sans')).toBe(false);
    expect(isAppFont('')).toBe(false);
    expect(isAppFont(null)).toBe(false);
    expect(isAppFont(undefined)).toBe(false);
  });
});

describe('getAppFontOption', () => {
  it('finds an option by id', () => {
    expect(getAppFontOption('mono')?.label).toBe('Menlo');
  });

  it('returns undefined for an unknown id', () => {
    expect(getAppFontOption('nope' as AppFont)).toBeUndefined();
  });
});
