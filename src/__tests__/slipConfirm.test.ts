import { Alert } from 'react-native';
import { confirmSlip } from '../utils/slipConfirm';
import type { Task } from '../types';

const DAY = new Date(2026, 9, 6);

jest.mock('react-native', () => ({ Alert: { alert: jest.fn() } }));

const task = (penaltyMinutes: number | null, extra: Partial<Task> = {}): Task =>
  ({ id: 't', title: 'No phone after 9', penaltyMinutes, slipCount: 0, slipDate: null, ...extra } as Task);

const tapButton = (label: string) => {
  const buttons = (Alert.alert as jest.Mock).mock.calls[0][2] as {
    text: string;
    onPress?: () => void;
  }[];
  buttons.find(b => b.text === label)?.onPress?.();
};

beforeEach(() => jest.clearAllMocks());

describe('confirmSlip', () => {
  it('goes straight through when the feature is off', () => {
    const onConfirm = jest.fn();
    confirmSlip(task(30), false, DAY, onConfirm);
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(Alert.alert).not.toHaveBeenCalled();
  });

  // Only the tasks somebody attached a cost to are worth an extra tap.
  it('goes straight through when the task costs nothing', () => {
    const onConfirm = jest.fn();
    confirmSlip(task(null), true, DAY, onConfirm);
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(Alert.alert).not.toHaveBeenCalled();
  });

  it('asks first when the slip costs blocked minutes', () => {
    const onConfirm = jest.fn();
    confirmSlip(task(30), true, DAY, onConfirm);
    expect(onConfirm).not.toHaveBeenCalled();
    expect(Alert.alert).toHaveBeenCalledTimes(1);
  });

  it('says how long the block lasts and that it stands', () => {
    confirmSlip(task(90), true, DAY, jest.fn());
    const [, message] = (Alert.alert as jest.Mock).mock.calls[0];
    expect(message).toContain('1.5h');
    expect(message).toContain('can’t be undone');
  });

  it('logs the slip once confirmed', () => {
    const onConfirm = jest.fn();
    confirmSlip(task(30), true, DAY, onConfirm);
    tapButton('Log it');
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('logs nothing when the prompt is cancelled', () => {
    const onConfirm = jest.fn();
    confirmSlip(task(30), true, DAY, onConfirm);
    tapButton('Cancel');
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('goes straight through while the slip is inside the day\u2019s allowance', () => {
    const onConfirm = jest.fn();
    confirmSlip(task(30, { slipAllowance: 2 }), true, DAY, onConfirm);
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(Alert.alert).not.toHaveBeenCalled();
  });

  it('asks again once the allowance is used up', () => {
    const spent = task(30, { slipAllowance: 1, slipCount: 1, slipDate: DAY.toISOString() });
    confirmSlip(spent, true, DAY, jest.fn());
    expect(Alert.alert).toHaveBeenCalledTimes(1);
  });

  describe('on a habit a reward guards', () => {
    const reward = {
      id: 'dessert', title: 'A dessert', cost: 110, createdAt: '', linkUrl: null, note: null,
      oneTime: false, taskId: null, priceMinor: null, guardsTaskId: 't',
    };

    it('offers the claim, and blocks nothing since no slip is logged', () => {
      const onConfirm = jest.fn();
      confirmSlip(task(30), true, DAY, onConfirm, { plan: { kind: 'claim', reward }, balance: 207, claimedToday: false });
      const [title, message] = (Alert.alert as jest.Mock).mock.calls[0];
      expect(title).toBe('Claim A dessert?');
      expect(message).not.toMatch(/blocks/);
      tapButton('Claim it');
      expect(onConfirm).toHaveBeenCalledTimes(1);
    });

    it('asks before a charge, naming the block too', () => {
      const onConfirm = jest.fn();
      confirmSlip(task(30), true, DAY, onConfirm, { plan: { kind: 'charge', reward, amount: 50 }, balance: 50, claimedToday: false });
      const [title, message] = (Alert.alert as jest.Mock).mock.calls[0];
      expect(title).toBe('Log a slip?');
      expect(message).toMatch(/takes all of it\. This blocks the apps you picked/);
      tapButton('Log it');
      expect(onConfirm).toHaveBeenCalledTimes(1);
    });

    it('asks even with no penalty, and cancelling logs nothing', () => {
      const onConfirm = jest.fn();
      confirmSlip(task(null), false, DAY, onConfirm, { plan: { kind: 'charge', reward, amount: 0 }, balance: 0, claimedToday: false });
      expect(Alert.alert).toHaveBeenCalledTimes(1);
      tapButton('Cancel');
      expect(onConfirm).not.toHaveBeenCalled();
    });
  });
});
