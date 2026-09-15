import { AGENDA_SPEECH_RATE, speakAgenda, stopSpeakingAgenda } from '../utils/agendaSpeech';

// expo-speech is a native module reached through a call-site require (see the
// module's own note). Mocked here so the two rules it exists to hold — stop
// before speak, and never throw — can be pinned without a device.
const mockSpeech = { speak: jest.fn(), stop: jest.fn() };
jest.mock('expo-speech', () => mockSpeech, { virtual: true });
jest.mock('react-native', () => ({ Platform: { OS: 'ios' } }));

beforeEach(() => {
  jest.clearAllMocks();
});

describe('speakAgenda', () => {
  it('speaks the line at the reading rate', () => {
    speakAgenda('Today: 3 tasks due.');
    expect(mockSpeech.speak).toHaveBeenCalledWith(
      'Today: 3 tasks due.',
      { rate: AGENDA_SPEECH_RATE },
    );
  });

  it('reads slower than the default, since it is heard across a room', () => {
    expect(AGENDA_SPEECH_RATE).toBeLessThan(1);
  });

  it('stops before it speaks, because speak queues rather than interrupts', () => {
    // Two agendas read back to back is the outcome nobody wants from tapping a
    // notification twice.
    speakAgenda('Today: 3 tasks due.');
    expect(mockSpeech.stop).toHaveBeenCalled();
    expect(mockSpeech.stop.mock.invocationCallOrder[0])
      .toBeLessThan(mockSpeech.speak.mock.invocationCallOrder[0]);
  });

  it('never throws, because it runs from a notification tap', () => {
    // A silent agenda is a disappointment; a throw inside a notification
    // handler is a crash on launch.
    mockSpeech.speak.mockImplementationOnce(() => { throw new Error('no voice'); });
    expect(() => speakAgenda('Today: 1 task due.')).not.toThrow();
  });

  it('survives the stop throwing too', () => {
    mockSpeech.stop.mockImplementationOnce(() => { throw new Error('nothing to stop'); });
    expect(() => speakAgenda('Today: 1 task due.')).not.toThrow();
  });
});

describe('stopSpeakingAgenda', () => {
  it('stops', () => {
    stopSpeakingAgenda();
    expect(mockSpeech.stop).toHaveBeenCalled();
  });

  it('never throws either', () => {
    mockSpeech.stop.mockImplementationOnce(() => { throw new Error('boom'); });
    expect(() => stopSpeakingAgenda()).not.toThrow();
  });
});
