import { Alert } from 'react-native';
import { confirmSlip } from '../utils/slipConfirm';
import type { Task } from '../types';

jest.mock('react-native', () => ({ Alert: { alert: jest.fn() } }));

const task = (penaltyMinutes: number | null): Task =>
  ({ id: 't', title: 'No phone after 9', penaltyMinutes } as Task);

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
    confirmSlip(task(30), false, onConfirm);
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(Alert.alert).not.toHaveBeenCalled();
  });

  // Only the tasks somebody attached a cost to are worth an extra tap.
  it('goes straight through when the task costs nothing', () => {
    const onConfirm = jest.fn();
    confirmSlip(task(null), true, onConfirm);
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(Alert.alert).not.toHaveBeenCalled();
  });

  it('asks first when the slip costs blocked minutes', () => {
    const onConfirm = jest.fn();
    confirmSlip(task(30), true, onConfirm);
    expect(onConfirm).not.toHaveBeenCalled();
    expect(Alert.alert).toHaveBeenCalledTimes(1);
  });

  it('says how long the block lasts and that it stands', () => {
    confirmSlip(task(90), true, jest.fn());
    const [, message] = (Alert.alert as jest.Mock).mock.calls[0];
    expect(message).toContain('1.5h');
    expect(message).toContain('can’t be undone');
  });

  it('logs the slip once confirmed', () => {
    const onConfirm = jest.fn();
    confirmSlip(task(30), true, onConfirm);
    tapButton('Log it');
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('logs nothing when the prompt is cancelled', () => {
    const onConfirm = jest.fn();
    confirmSlip(task(30), true, onConfirm);
    tapButton('Cancel');
    expect(onConfirm).not.toHaveBeenCalled();
  });
});
