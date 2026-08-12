import { ordinal } from '@/utils/ordinal';

describe('ordinal', () => {
  it('handles the usual suffixes', () => {
    expect([1, 2, 3, 4, 5].map(ordinal)).toEqual(['1st', '2nd', '3rd', '4th', '5th']);
  });

  it('handles the teens, which are the reason this exists', () => {
    expect([11, 12, 13].map(ordinal)).toEqual(['11th', '12th', '13th']);
  });

  it('handles the twenties and beyond', () => {
    expect([21, 22, 23, 24, 99, 111, 112].map(ordinal))
      .toEqual(['21st', '22nd', '23rd', '24th', '99th', '111th', '112th']);
  });
});
