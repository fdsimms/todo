import { describeProduct } from '../utils/groceryProduct';

describe('describeProduct', () => {
  // One caption, not two: the row can already be four captions tall, and these
  // two name a single product between them.
  it('joins a brand and a variant with a space', () => {
    expect(describeProduct({ brand: 'Good Culture', variant: 'low fat' })).toBe(
      'Good Culture low fat'
    );
  });

  it('gives either one on its own, verbatim', () => {
    expect(describeProduct({ brand: 'Oatly', variant: null })).toBe('Oatly');
    // The state the row has to get right: caring about the milk fat and not the
    // dairy. It reads as qualifying the name above it, and nothing is added to
    // announce that it isn't a brand.
    expect(describeProduct({ brand: null, variant: 'low fat' })).toBe('low fat');
  });

  it('is null when the item names neither', () => {
    expect(describeProduct({ brand: null, variant: null })).toBeNull();
  });

  // Both setters trim to null, so this is belt and braces — but a row written
  // before they did, or by a future caller, must not caption itself with a
  // blank line or a leading space.
  it('treats a blank field as absent', () => {
    expect(describeProduct({ brand: '  ', variant: 'low fat' })).toBe('low fat');
    expect(describeProduct({ brand: 'Oatly', variant: '   ' })).toBe('Oatly');
    expect(describeProduct({ brand: '', variant: '' })).toBeNull();
  });
});
