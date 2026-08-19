import { Alert } from 'react-native';
import { confirmDelete } from '../utils/confirmDelete';
import { useSettingsStore } from '../store/useSettingsStore';

jest.mock('react-native', () => ({
  Alert: { alert: jest.fn() },
}));

jest.mock('../db/database', () => ({
  dbGetSetting: jest.fn().mockReturnValue(null),
  dbSetSetting: jest.fn(),
}));

jest.mock('../utils/secureApiKey', () => ({
  loadAnthropicApiKey: jest.fn().mockResolvedValue(''),
  saveAnthropicApiKey: jest.fn().mockResolvedValue(true),
}));

beforeEach(() => {
  jest.clearAllMocks();
  useSettingsStore.setState({ confirmBeforeDeleting: true });
});

describe('confirmDelete', () => {
  it('shows an Alert and only fires onConfirm when its destructive button is pressed', () => {
    const onConfirm = jest.fn();

    confirmDelete({ title: 'Delete Recipe', message: 'Delete "Chili"?', onConfirm });

    expect(onConfirm).not.toHaveBeenCalled();
    expect(Alert.alert).toHaveBeenCalledTimes(1);
    const [title, message, buttons] = (Alert.alert as jest.Mock).mock.calls[0];
    expect(title).toBe('Delete Recipe');
    expect(message).toBe('Delete "Chili"?');
    expect(buttons).toEqual([
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: onConfirm },
    ]);
  });

  it('defaults the destructive button label to "Delete"', () => {
    confirmDelete({ title: 'x', onConfirm: jest.fn() });
    const buttons = (Alert.alert as jest.Mock).mock.calls[0][2];
    expect(buttons[1].text).toBe('Delete');
  });

  it('uses a custom confirmLabel when given', () => {
    confirmDelete({ title: 'x', confirmLabel: 'Forget', onConfirm: jest.fn() });
    const buttons = (Alert.alert as jest.Mock).mock.calls[0][2];
    expect(buttons[1].text).toBe('Forget');
  });

  it('skips the Alert and fires onConfirm immediately when the setting is off', () => {
    useSettingsStore.setState({ confirmBeforeDeleting: false });
    const onConfirm = jest.fn();

    confirmDelete({ title: 'Delete Recipe', onConfirm });

    expect(Alert.alert).not.toHaveBeenCalled();
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });
});
