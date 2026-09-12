import { deliverableRefusal } from '../deliverableAsk';

describe('deliverableRefusal', () => {
  it('lets a task that asks nothing through', () => {
    expect(deliverableRefusal(null, false)).toBeNull();
  });

  it('refuses an omitted answer and names the kind wanted', () => {
    expect(deliverableRefusal('number', false)).toContain('a number');
    expect(deliverableRefusal('text', false)).toContain('some text');
    expect(deliverableRefusal('date', false)).toContain('a date');
  });

  // The distinction the whole module exists for. The app may never *require*
  // an answer, so declining is a real answer and has to get through; what is
  // refused is a caller that never offered the choice.
  it('accepts an explicit decline, which is what the app offers a person', () => {
    expect(deliverableRefusal('text', true)).toBeNull();
    expect(deliverableRefusal('date', true)).toBeNull();
  });

  it('says how to decline, so the refusal is not a dead end', () => {
    expect(deliverableRefusal('text', false)).toContain('deliverableValue: null');
  });

  // A caller weighing whether to bother asking should know the answer is not
  // merely being filed: it dates a task it has not been shown.
  it('names the step an answer is about to schedule', () => {
    const message = deliverableRefusal('date', false, 'Get haircut');
    expect(message).toContain('Get haircut');
    expect(message).toContain('schedules the next step');
  });

  it('says nothing about scheduling when the answer is only recorded', () => {
    expect(deliverableRefusal('date', false)).not.toContain('schedules the next step');
  });
});
