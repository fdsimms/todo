import { captureHint, captureModes, resolveCaptureMode } from '../utils/foodCapture';

describe('captureModes', () => {
  it('lists package before meal', () => {
    expect(captureModes({ package: true, meal: true })).toEqual(['package', 'meal']);
  });

  it('leaves out a mode the caller cannot honor', () => {
    expect(captureModes({ package: false, meal: true })).toEqual(['meal']);
    expect(captureModes({ package: true, meal: false })).toEqual(['package']);
    expect(captureModes({ package: false, meal: false })).toEqual([]);
  });
});

describe('resolveCaptureMode', () => {
  it('keeps the current mode while it is offered', () => {
    expect(resolveCaptureMode('meal', ['package', 'meal'])).toBe('meal');
  });

  it('falls back to the first offered mode', () => {
    expect(resolveCaptureMode('package', ['meal'])).toBe('meal');
  });
});

describe('captureHint', () => {
  it('names both things a package can be', () => {
    expect(captureHint('package')).toBe('Scan a barcode or photograph a label');
  });

  it('says a meal photo is estimated', () => {
    expect(captureHint('meal')).toMatch(/estimate/);
  });
});
