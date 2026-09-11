jest.mock('react-native', () => ({ StyleSheet: { hairlineWidth: 1 } }));

import { flattenOverlay } from '../theme';

describe('flattenOverlay', () => {
  it('flattens an rgba() overlay against an opaque hex background', () => {
    // rgba(10, 132, 255, 0.15) over #1C1C1E — the exact accentSubtle/bgSecondary
    // pairing this exists for.
    expect(flattenOverlay('rgba(10, 132, 255, 0.15)', '#1C1C1E')).toBe('#192c40');
  });

  it('flattens a hex-with-alpha-byte overlay (color + "1A") against an opaque hex background', () => {
    // 0x1A / 255 ≈ 0.1020, close enough to the 0.15 rgba() case above to land
    // on a visually similar (not identical) flattened color.
    expect(flattenOverlay('#0A84FF1A', '#1C1C1E')).toBe('#1a2735');
  });

  it('is a no-op for a fully opaque rgba overlay', () => {
    expect(flattenOverlay('rgb(10, 132, 255)', '#1C1C1E')).toBe('#0a84ff');
  });

  it('returns the input unchanged when it does not match a recognized format', () => {
    expect(flattenOverlay('not-a-color', '#1C1C1E')).toBe('not-a-color');
  });
});
