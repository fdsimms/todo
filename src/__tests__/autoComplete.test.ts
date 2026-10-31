import { autoCompleteReason } from '../utils/autoComplete';
import { canAutoComplete, runUnattended, setAutoCompleteAttended } from '../utils/autoCompleteScope';
import { runStartupStep } from '../utils/startup';

describe('autoCompleteReason', () => {
  it('names what the person did, for the kinds that may complete themselves', () => {
    expect(autoCompleteReason({ generatedKind: 'moodLog' })).toBe('Logged your mood');
    expect(autoCompleteReason({ generatedKind: 'weighIn' })).toBe('Recorded your weight');
  });

  it('is null for a task the app did not write', () => {
    expect(autoCompleteReason({ generatedKind: null })).toBeNull();
  });

  // A block offer reads ready because the block ran its time, which is the
  // clock and not an action, and its coins are held back until the tick.
  it('is null for a kind that is ready by the clock rather than by an action', () => {
    expect(autoCompleteReason({ generatedKind: 'blockOffer' })).toBeNull();
  });

  // A meal logged to the wrong slot would otherwise tick through the slot's
  // whole chain, and deleting the entry doesn't un-tick it.
  it('is null for a meal slot, which reads ready and waits for the tick', () => {
    expect(autoCompleteReason({ generatedKind: 'mealSlot' })).toBeNull();
  });
});

describe('canAutoComplete', () => {
  afterEach(() => setAutoCompleteAttended(false));

  it('is off until the interface says someone is there', () => {
    expect(canAutoComplete()).toBe(false);
    setAutoCompleteAttended(true);
    expect(canAutoComplete()).toBe(true);
  });

  it('is off inside an unattended run, including a nested one, and back on after', () => {
    setAutoCompleteAttended(true);
    runUnattended(() => {
      expect(canAutoComplete()).toBe(false);
      runUnattended(() => expect(canAutoComplete()).toBe(false));
      expect(canAutoComplete()).toBe(false);
    });
    expect(canAutoComplete()).toBe(true);
  });

  it('is back on after an unattended run that throws', () => {
    setAutoCompleteAttended(true);
    expect(() => runUnattended(() => { throw new Error('boom'); })).toThrow('boom');
    expect(canAutoComplete()).toBe(true);
  });

  it('is off for every launch and background step', () => {
    setAutoCompleteAttended(true);
    let seen: boolean | null = null;
    runStartupStep('check something', () => { seen = canAutoComplete(); });
    expect(seen).toBe(false);
    expect(canAutoComplete()).toBe(true);
  });
});
