import {
  ACTIVITY_FACTOR,
  ACTIVITY_LEVELS,
  EMPTY_BODY_PROFILE,
  KCAL_PER_LB,
  MAX_HEIGHT_CM,
  MIN_PROPOSED_KCAL,
  ageFromBirthYear,
  calorieBudget,
  cmToFeetInches,
  dailyAdjustmentKcal,
  feetInchesToCm,
  formatHeight,
  isProfileComplete,
  maintenanceKcal,
  parseBodyProfile,
  parseHeightInput,
  proposalFloorKcal,
  restingEnergyKcal,
  serializeBodyProfile,
  type BodyProfile,
} from '@/utils/energyBudget';
import { unitToKg } from '@/utils/weightLog';

const TODAY = new Date(2026, 8, 11);

function profile(overrides: Partial<BodyProfile> = {}): BodyProfile {
  return { heightCm: 180, birthYear: 1990, sex: 'male', activity: 'sedentary', ...overrides };
}

describe('ageFromBirthYear', () => {
  it('counts whole years from the calendar year', () => {
    expect(ageFromBirthYear(1990, TODAY)).toBe(36);
  });

  it('has no answer for a missing or impossible year', () => {
    expect(ageFromBirthYear(null, TODAY)).toBeNull();
    expect(ageFromBirthYear(2050, TODAY)).toBeNull();
    expect(ageFromBirthYear(1800, TODAY)).toBeNull();
  });
});

describe('restingEnergyKcal', () => {
  it('matches Mifflin-St Jeor for a man', () => {
    // 10(80) + 6.25(180) − 5(36) + 5 = 800 + 1125 − 180 + 5
    expect(restingEnergyKcal(profile(), 80, TODAY)).toBeCloseTo(1750);
  });

  it('matches Mifflin-St Jeor for a woman', () => {
    // The same body with the female constant: 166 calories lower.
    expect(restingEnergyKcal(profile({ sex: 'female' }), 80, TODAY)).toBeCloseTo(1584);
  });

  it('returns null rather than guessing at a missing field', () => {
    expect(restingEnergyKcal(profile({ heightCm: null }), 80, TODAY)).toBeNull();
    expect(restingEnergyKcal(profile({ birthYear: null }), 80, TODAY)).toBeNull();
    expect(restingEnergyKcal(profile({ sex: null }), 80, TODAY)).toBeNull();
    expect(restingEnergyKcal(EMPTY_BODY_PROFILE, 80, TODAY)).toBeNull();
  });

  it('refuses a height or weight outside the absurdity bounds', () => {
    expect(restingEnergyKcal(profile({ heightCm: 5 }), 80, TODAY)).toBeNull();
    expect(restingEnergyKcal(profile({ heightCm: MAX_HEIGHT_CM + 1 }), 80, TODAY)).toBeNull();
    expect(restingEnergyKcal(profile(), 0, TODAY)).toBeNull();
  });
});

describe('maintenanceKcal', () => {
  it('multiplies resting energy by the activity factor', () => {
    expect(maintenanceKcal(profile({ activity: 'moderate' }), 80, TODAY)).toBeCloseTo(1750 * 1.55);
  });

  it('defaults an untouched profile to the bottom of the ladder', () => {
    expect(EMPTY_BODY_PROFILE.activity).toBe('sedentary');
    expect(ACTIVITY_FACTOR.sedentary).toBe(Math.min(...ACTIVITY_LEVELS.map(l => ACTIVITY_FACTOR[l])));
  });
});

describe('dailyAdjustmentKcal', () => {
  it('reproduces the familiar 500 a day for a pound a week', () => {
    expect(dailyAdjustmentKcal(-unitToKg(1, 'lb'))).toBeCloseTo(-KCAL_PER_LB / 7);
    expect(dailyAdjustmentKcal(-unitToKg(1, 'lb'))).toBeCloseTo(-500);
  });

  it('signs a surplus the other way', () => {
    expect(dailyAdjustmentKcal(unitToKg(1, 'lb'))).toBeCloseTo(500);
  });

  it('is zero for a maintain', () => {
    expect(dailyAdjustmentKcal(0)).toBe(0);
  });
});

describe('calorieBudget', () => {
  it('returns every step of the arithmetic, and the parts add up to the total', () => {
    const budget = calorieBudget(profile({ activity: 'moderate' }), 80, -unitToKg(1, 'lb'), TODAY);
    expect(budget).not.toBeNull();
    expect(budget!.maintenanceKcal).toBe(Math.round(1750 * 1.55));
    expect(budget!.adjustmentKcal).toBe(-500);
    expect(budget!.arithmeticKcal).toBe(budget!.proposedKcal);
    expect(budget!.raisedToFloor).toBe(false);
  });

  it('has no answer without a complete profile', () => {
    expect(calorieBudget(profile({ sex: null }), 80, 0, TODAY)).toBeNull();
    expect(calorieBudget(EMPTY_BODY_PROFILE, 80, 0, TODAY)).toBeNull();
  });

  it('raises a proposal below the floor, and says that it did', () => {
    // A small, sedentary person aiming at two pounds a week: the arithmetic
    // asks for far less than the floor allows the app to suggest.
    const small = profile({ sex: 'female', heightCm: 155, birthYear: 1960 });
    const budget = calorieBudget(small, 50, -unitToKg(2, 'lb'), TODAY);
    expect(budget!.arithmeticKcal).toBeLessThan(MIN_PROPOSED_KCAL.female);
    expect(budget!.proposedKcal).toBe(MIN_PROPOSED_KCAL.female);
    expect(budget!.raisedToFloor).toBe(true);
  });

  it('keeps the unfloored figure visible alongside the floored one', () => {
    const small = profile({ sex: 'female', heightCm: 155, birthYear: 1960 });
    const budget = calorieBudget(small, 50, -unitToKg(2, 'lb'), TODAY);
    expect(budget!.arithmeticKcal).toBe(budget!.maintenanceKcal + budget!.adjustmentKcal);
  });

  it('never floors a gaining goal, which only ever adds', () => {
    const budget = calorieBudget(profile(), 80, unitToKg(1, 'lb'), TODAY);
    expect(budget!.raisedToFloor).toBe(false);
  });
});

describe('proposalFloorKcal', () => {
  it('uses the weaker floor when the sex is unknown', () => {
    expect(proposalFloorKcal(null)).toBe(MIN_PROPOSED_KCAL.female);
    expect(MIN_PROPOSED_KCAL.female).toBeLessThan(MIN_PROPOSED_KCAL.male);
  });
});

describe('height', () => {
  it('round-trips feet and inches', () => {
    expect(feetInchesToCm(5, 10)).toBeCloseTo(177.8);
    expect(cmToFeetInches(177.8)).toEqual({ feet: 5, inches: 10 });
  });

  it('formats in the system the weight unit implies', () => {
    expect(formatHeight(177.8, 'kg')).toBe('178 cm');
    expect(formatHeight(177.8, 'lb')).toBe('5′ 10″');
  });

  it('reads centimetres when the unit is kilograms', () => {
    expect(parseHeightInput('178', 'kg')).toBe(178);
    expect(parseHeightInput(" 178.5 ", 'kg')).toBeCloseTo(178.5);
    expect(parseHeightInput("5'10", 'kg')).toBeNull();
  });

  it('reads the forms somebody actually types for feet and inches', () => {
    for (const text of ["5'10", "5' 10\"", '5 10', '5ft 10in', '5′10″']) {
      expect(parseHeightInput(text, 'lb')).toBeCloseTo(177.8);
    }
  });

  it('reads a bare number in pounds mode as feet', () => {
    expect(parseHeightInput('6', 'lb')).toBeCloseTo(feetInchesToCm(6, 0));
  });

  it('refuses twelve inches or more, which is a different number of feet', () => {
    expect(parseHeightInput("5'12", 'lb')).toBeNull();
  });

  it('refuses what it cannot read, rather than clamping it', () => {
    expect(parseHeightInput('', 'lb')).toBeNull();
    expect(parseHeightInput('tall', 'lb')).toBeNull();
    expect(parseHeightInput('20', 'lb')).toBeNull();
    expect(parseHeightInput('9', 'kg')).toBeNull();
  });
});

describe('storage', () => {
  it('round-trips a profile', () => {
    const p = profile({ activity: 'active' });
    expect(parseBodyProfile(serializeBodyProfile(p))).toEqual(p);
  });

  it('reads nothing back as the empty profile', () => {
    expect(parseBodyProfile(null)).toEqual(EMPTY_BODY_PROFILE);
    expect(parseBodyProfile('nonsense')).toEqual(EMPTY_BODY_PROFILE);
    expect(parseBodyProfile('[]')).toEqual(EMPTY_BODY_PROFILE);
  });

  it('keeps the readable fields when one is unreadable', () => {
    const parsed = parseBodyProfile(JSON.stringify({ ...profile(), sex: 'unknown' }));
    expect(parsed.heightCm).toBe(180);
    expect(parsed.birthYear).toBe(1990);
    expect(parsed.sex).toBeNull();
  });

  it('drops an activity level this build does not know', () => {
    expect(parseBodyProfile(JSON.stringify({ ...profile(), activity: 'superhuman' })).activity).toBe(
      'sedentary',
    );
  });

  it('drops an out-of-range height', () => {
    expect(parseBodyProfile(JSON.stringify({ ...profile(), heightCm: 900 })).heightCm).toBeNull();
  });
});

describe('isProfileComplete', () => {
  it('needs all three typed fields, but never the activity level', () => {
    expect(isProfileComplete(profile())).toBe(true);
    expect(isProfileComplete(EMPTY_BODY_PROFILE)).toBe(false);
    expect(isProfileComplete(profile({ heightCm: null }))).toBe(false);
    expect(isProfileComplete({ ...profile(), activity: 'sedentary' })).toBe(true);
  });
});
