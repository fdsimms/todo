import { SIMPLE_QUICK_ADD_CHIPS, isSimpleChip } from '../utils/simpleTaskForm';
import { QUICK_ADD_CHIP_LABELS, type QuickAddChip } from '../utils/taskKinds';

const ALL_CHIPS = Object.keys(QUICK_ADD_CHIP_LABELS) as QuickAddChip[];

describe('simple task form', () => {
  describe('off', () => {
    it('keeps every chip', () => {
      for (const chip of ALL_CHIPS) {
        expect(isSimpleChip(chip, false)).toBe(true);
      }
    });
  });

  describe('on', () => {
    it('keeps exactly Date, Time of day and Repeat', () => {
      const kept = ALL_CHIPS.filter(c => isSimpleChip(c, true));
      expect(kept).toEqual(['date', 'repeat', 'segment']);
    });
  });

  it('only lists chips the toolbar actually has', () => {
    for (const chip of SIMPLE_QUICK_ADD_CHIPS) {
      expect(ALL_CHIPS).toContain(chip);
    }
  });
});
