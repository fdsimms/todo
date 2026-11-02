import type { CheckIn } from '../types';
import {
  answerForAction,
  checkInDueAt,
  checkInQuestion,
  defaultWaitMinutes,
  describeCheckIn,
  formatWait,
  isWaitingForAnswer,
  suggestedWaitMinutes,
  CHECK_IN_ACTIONS,
} from '../utils/checkIns';

const base: CheckIn = {
  id: 'c1',
  sourceKind: 'medication',
  sourceId: 'd1',
  subject: 'Aleve',
  about: null,
  dueAt: '2026-11-02T15:00:00.000Z',
  dayKey: '2026-11-02',
  answer: null,
  answeredAt: null,
};

describe('suggestedWaitMinutes', () => {
  it('matches brand and generic names, ignoring case and extra words', () => {
    expect(suggestedWaitMinutes('Aleve')).toBe(60);
    expect(suggestedWaitMinutes('NAPROXEN 220 mg')).toBe(60);
    expect(suggestedWaitMinutes('Claritin')).toBe(120);
    expect(suggestedWaitMinutes('Tums')).toBe(30);
  });

  it('has no suggestion for an unknown medicine or an empty name', () => {
    expect(suggestedWaitMinutes('Mystery pill')).toBeNull();
    expect(suggestedWaitMinutes('  ')).toBeNull();
  });
});

describe('defaultWaitMinutes', () => {
  it('uses the suggestion, then an hour for a medicine, and two hours for a food', () => {
    expect(defaultWaitMinutes('medication', 'Aleve')).toBe(60);
    expect(defaultWaitMinutes('medication', 'Claritin')).toBe(120);
    expect(defaultWaitMinutes('medication', 'Mystery pill')).toBe(60);
    expect(defaultWaitMinutes('food', 'Aleve')).toBe(120);
  });
});

describe('copy', () => {
  it('asks about what it is for when it was entered', () => {
    expect(checkInQuestion({ ...base, about: 'headache' })).toBe('Is your headache better, the same, or worse?');
  });

  it('asks how you feel when nothing was entered', () => {
    expect(checkInQuestion(base)).toBe('How are you feeling since taking Aleve?');
    expect(checkInQuestion({ ...base, sourceKind: 'food', subject: 'Cheese pizza' })).toBe('How are you feeling since Cheese pizza?');
  });

  it('formats a wait', () => {
    expect(formatWait(30)).toBe('30 min');
    expect(formatWait(120)).toBe('2 hr');
    expect(formatWait(90)).toBe('90 min');
  });
});

describe('timing and status', () => {
  it('adds the wait to the moment of the dose, never less than a minute', () => {
    expect(checkInDueAt(new Date('2026-11-02T14:00:00.000Z'), 60).toISOString()).toBe('2026-11-02T15:00:00.000Z');
    expect(checkInDueAt(new Date('2026-11-02T14:00:00.000Z'), 0).toISOString()).toBe('2026-11-02T14:01:00.000Z');
  });

  it('is waiting for an answer only once due and unanswered', () => {
    expect(isWaitingForAnswer(base, new Date('2026-11-02T14:59:00.000Z'))).toBe(false);
    expect(isWaitingForAnswer(base, new Date('2026-11-02T15:00:00.000Z'))).toBe(true);
    expect(isWaitingForAnswer({ ...base, answer: 'same' }, new Date('2026-11-02T16:00:00.000Z'))).toBe(false);
  });

  it('describes the answer, or that it is waiting or unanswered', () => {
    expect(describeCheckIn({ ...base, answer: 'better' }, new Date('2026-11-02T16:00:00.000Z'))).toBe('Check-in: better');
    expect(describeCheckIn(base, new Date('2026-11-02T14:00:00.000Z'))).toBe('Check-in: waiting');
    expect(describeCheckIn(base, new Date('2026-11-02T16:00:00.000Z'))).toBe('Check-in: not answered');
  });
});

describe('answerForAction', () => {
  it('maps each button to its answer and anything else to null', () => {
    expect(answerForAction(CHECK_IN_ACTIONS.better)).toBe('better');
    expect(answerForAction(CHECK_IN_ACTIONS.same)).toBe('same');
    expect(answerForAction(CHECK_IN_ACTIONS.worse)).toBe('worse');
    expect(answerForAction('expo.modules.notifications.actions.DEFAULT')).toBeNull();
  });
});
