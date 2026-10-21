import { cleanPastedLines } from '../utils/pastedLines';

describe('cleanPastedLines', () => {
  it('strips the bullets a copied list carries and drops blank lines', () => {
    expect(cleanPastedLines(['- Passport', '• Charger', '', '1. Socks', '2) Hat', '[ ] Sunscreen', '[x] Tickets', '  Plain  ']))
      .toEqual(['Passport', 'Charger', 'Socks', 'Hat', 'Sunscreen', 'Tickets', 'Plain']);
  });

  it('keeps a hyphen that is part of the line', () => {
    expect(cleanPastedLines(['Re-pot the fern', '-5 degree bag'])).toEqual(['Re-pot the fern', '-5 degree bag']);
  });
});
