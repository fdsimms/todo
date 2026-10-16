import { Alert } from 'react-native';
import { confirmDiscard } from '../utils/confirmDiscard';

jest.mock('react-native', () => ({
  Alert: { alert: jest.fn() },
}));

beforeEach(() => {
  jest.clearAllMocks();
});

describe('confirmDiscard', () => {
  it('shows the shared wording and only fires onDiscard from its destructive button', () => {
    const onDiscard = jest.fn();

    confirmDiscard(onDiscard);

    expect(onDiscard).not.toHaveBeenCalled();
    const [title, message, buttons] = (Alert.alert as jest.Mock).mock.calls[0];
    expect(title).toBe('Discard changes?');
    expect(message).toBe('Your changes haven’t been saved yet. If you leave now, they’ll be lost.');
    expect(buttons).toEqual([
      { text: 'Keep editing', style: 'cancel' },
      { text: 'Discard', style: 'destructive', onPress: onDiscard },
    ]);
  });

  it('runs onKeepEditing from the cancel button, for a sheet that has to snap back', () => {
    const onKeepEditing = jest.fn();

    confirmDiscard(jest.fn(), { onKeepEditing });

    const buttons = (Alert.alert as jest.Mock).mock.calls[0][2];
    expect(buttons[0]).toEqual({ text: 'Keep editing', style: 'cancel', onPress: onKeepEditing });
  });

  it('lets a caller reword it for something that was never saved', () => {
    confirmDiscard(jest.fn(), { title: 'Discard this project?', message: 'This project hasn’t been saved yet. If you leave now, it’ll be lost.' });

    const [title, message] = (Alert.alert as jest.Mock).mock.calls[0];
    expect(title).toBe('Discard this project?');
    expect(message).toBe('This project hasn’t been saved yet. If you leave now, it’ll be lost.');
  });
});
