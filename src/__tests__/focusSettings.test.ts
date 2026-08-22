import {
  FOCUS_DEFAULTS,
  FOCUS_LONG_REST_EVERY_MAX,
  FOCUS_REST_AFTER_MINUTES_MIN,
  FOCUS_REST_AFTER_TASKS_MAX,
  FOCUS_REST_MAX,
  FOCUS_WORK_CAP_MAX,
  FOCUS_WORK_CAP_MIN,
  focusPlanOptionsFrom,
  focusRestsDisabled,
  parseFocusDefaultWorkMinutes,
  parseFocusLongRestEvery,
  parseFocusRestAfterMinutes,
  parseFocusRestAfterTasks,
  parseFocusRestMinutes,
  parseFocusWorkCapMinutes,
  serializeOptionalCount,
  type FocusSettingsSource,
} from '../utils/focusSettings';

describe('required counts', () => {
  it('falls back to the default for an absent or unreadable value', () => {
    expect(parseFocusWorkCapMinutes(null)).toBe(FOCUS_DEFAULTS.workCapMinutes);
    expect(parseFocusWorkCapMinutes(undefined)).toBe(FOCUS_DEFAULTS.workCapMinutes);
    expect(parseFocusWorkCapMinutes('')).toBe(FOCUS_DEFAULTS.workCapMinutes);
    expect(parseFocusWorkCapMinutes('nonsense')).toBe(FOCUS_DEFAULTS.workCapMinutes);
  });

  it('reads a stored number back', () => {
    expect(parseFocusWorkCapMinutes('40')).toBe(40);
    expect(parseFocusDefaultWorkMinutes('15')).toBe(15);
    expect(parseFocusRestMinutes('7')).toBe(7);
  });

  it('clamps to the bounds the steppers offer', () => {
    expect(parseFocusWorkCapMinutes('1')).toBe(FOCUS_WORK_CAP_MIN);
    expect(parseFocusWorkCapMinutes('9999')).toBe(FOCUS_WORK_CAP_MAX);
    expect(parseFocusRestMinutes('9999')).toBe(FOCUS_REST_MAX);
  });

  it('rounds a fractional value rather than carrying it into the plan', () => {
    expect(parseFocusWorkCapMinutes('24.6')).toBe(25);
  });
});

describe('optional counts', () => {
  it('reads the empty string as off, which is how the settings table spells null', () => {
    expect(parseFocusRestAfterTasks('')).toBeNull();
    expect(parseFocusRestAfterMinutes('')).toBeNull();
    expect(parseFocusLongRestEvery('')).toBeNull();
  });

  it('falls back to the default when nothing was ever stored', () => {
    expect(parseFocusRestAfterTasks(null)).toBe(FOCUS_DEFAULTS.restAfterTasks);
    expect(parseFocusRestAfterMinutes(null)).toBe(FOCUS_DEFAULTS.restAfterMinutes);
  });

  it('reads a stored zero back as off, the same as an empty string', () => {
    expect(parseFocusRestAfterMinutes('0')).toBeNull();
    expect(parseFocusRestAfterTasks('-3')).toBeNull();
  });

  it('clamps a value that is on', () => {
    expect(parseFocusRestAfterTasks('99')).toBe(FOCUS_REST_AFTER_TASKS_MAX);
    expect(parseFocusRestAfterMinutes('1')).toBe(FOCUS_REST_AFTER_MINUTES_MIN);
    expect(parseFocusLongRestEvery('99')).toBe(FOCUS_LONG_REST_EVERY_MAX);
  });

  it('round-trips through the serializer', () => {
    expect(parseFocusRestAfterTasks(serializeOptionalCount(null))).toBeNull();
    expect(parseFocusRestAfterTasks(serializeOptionalCount(3))).toBe(3);
  });
});

describe('the shipped defaults', () => {
  it('are a classic pomodoro: 25 on, 5 off, 15 every fourth break', () => {
    expect(FOCUS_DEFAULTS.workCapMinutes).toBe(25);
    expect(FOCUS_DEFAULTS.restAfterMinutes).toBe(25);
    expect(FOCUS_DEFAULTS.restMinutes).toBe(5);
    expect(FOCUS_DEFAULTS.longRestEvery).toBe(4);
    expect(FOCUS_DEFAULTS.longRestMinutes).toBe(15);
  });

  it('leave the task-count trigger off, so short tasks do not each earn a break', () => {
    expect(FOCUS_DEFAULTS.restAfterTasks).toBeNull();
  });
});

describe('focusPlanOptionsFrom', () => {
  const settings: FocusSettingsSource = {
    focusWorkCapMinutes: 30,
    focusDefaultWorkMinutes: 20,
    focusRestAfterTasks: 2,
    focusRestAfterMinutes: 40,
    focusRestMinutes: 6,
    focusLongRestEvery: 3,
    focusLongRestMinutes: 20,
  };

  it('renames the store fields onto what the plan builder asks for', () => {
    expect(focusPlanOptionsFrom(settings)).toEqual({
      workCapMinutes: 30,
      defaultWorkMinutes: 20,
      restAfterTasks: 2,
      restAfterMinutes: 40,
      restMinutes: 6,
      longRestEvery: 3,
      longRestMinutes: 20,
    });
  });
});

describe('focusRestsDisabled', () => {
  it('is true only when both triggers are off', () => {
    expect(focusRestsDisabled({ focusRestAfterTasks: null, focusRestAfterMinutes: null })).toBe(true);
    expect(focusRestsDisabled({ focusRestAfterTasks: 0, focusRestAfterMinutes: 0 })).toBe(true);
    expect(focusRestsDisabled({ focusRestAfterTasks: 2, focusRestAfterMinutes: null })).toBe(false);
    expect(focusRestsDisabled({ focusRestAfterTasks: null, focusRestAfterMinutes: 25 })).toBe(false);
  });
});
