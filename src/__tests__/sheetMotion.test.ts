import { sheetTravel, SHEET_TRAVEL_SLACK } from '../utils/sheetMotion';

describe('sheetTravel', () => {
  it('falls back to the window before the card has a layout', () => {
    expect(sheetTravel(null, 844)).toBe(844);
    expect(sheetTravel(0, 844)).toBe(844);
  });

  it('travels the card height plus slack once measured', () => {
    expect(sheetTravel(300, 844)).toBe(300 + SHEET_TRAVEL_SLACK);
  });

  it('adds a raised keyboard', () => {
    expect(sheetTravel(300, 844, 336)).toBe(300 + 336 + SHEET_TRAVEL_SLACK);
  });

  it('never travels further than the window', () => {
    expect(sheetTravel(830, 844)).toBe(844);
    expect(sheetTravel(500, 844, 400)).toBe(844);
  });

  it('ignores a negative keyboard height', () => {
    expect(sheetTravel(300, 844, -10)).toBe(300 + SHEET_TRAVEL_SLACK);
  });
});
