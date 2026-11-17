import { lastTimeGym } from '../utils/lastTimeGym';

const previous = [{ sessionId: 's1' }, { sessionId: 's1' }];
const gyms = [{ id: 'home', name: 'Home gym' }, { id: 'eq', name: 'Equinox' }];
const sessionAt = (gymId: string | null) => [{ id: 's1', startedAt: '2026-11-10T18:00', gymId }];

describe('lastTimeGym', () => {
  it('names the gym last time was done at when it is not this one', () => {
    expect(lastTimeGym(previous, sessionAt('home'), gyms, 'eq')).toEqual({ name: 'Home gym', at: '2026-11-10T18:00' });
  });

  it('names it when this workout has no gym chosen', () => {
    expect(lastTimeGym(previous, sessionAt('home'), gyms, null)?.name).toBe('Home gym');
  });

  it('says nothing at the same gym', () => {
    expect(lastTimeGym(previous, sessionAt('home'), gyms, 'home')).toBeNull();
  });

  it('says nothing when last time had no gym, or its gym was deleted', () => {
    expect(lastTimeGym(previous, sessionAt(null), gyms, 'eq')).toBeNull();
    expect(lastTimeGym(previous, sessionAt('gone'), gyms, 'eq')).toBeNull();
  });

  it('says nothing when the exercise has no previous sets or its session is unknown', () => {
    expect(lastTimeGym([], sessionAt('home'), gyms, 'eq')).toBeNull();
    expect(lastTimeGym([{ sessionId: 'other' }], sessionAt('home'), gyms, 'eq')).toBeNull();
  });
});
