import { derivedId, isDerivedId, spawnSeed } from '../utils/syncIds';
import { generateId } from '../utils/id';

describe('derivedId', () => {
  it('gives the same id for the same seed', () => {
    // The whole point: two devices computing this independently must agree,
    // or completing one task on both produces two successors.
    expect(derivedId('occ:t1')).toBe(derivedId('occ:t1'));
  });

  it('gives different ids for different seeds', () => {
    expect(derivedId('occ:t1')).not.toBe(derivedId('occ:t2'));
  });

  it('separates seeds that differ only late in a long string', () => {
    const long = 'x'.repeat(200);
    expect(derivedId(`${long}a`)).not.toBe(derivedId(`${long}b`));
  });

  it('marks a derived id as derived', () => {
    expect(isDerivedId(derivedId('occ:t1'))).toBe(true);
  });

  it('spreads well enough not to collide across a realistic number of rows', () => {
    // Far more spawned rows than an install will hold. A collision here would
    // mean two unrelated occurrences silently merging into one.
    const ids = new Set<string>();
    for (let i = 0; i < 20000; i++) ids.add(derivedId(spawnSeed.occurrence(`task-${i}`)));
    expect(ids.size).toBe(20000);
  });

  it('does not collide across the different kinds of spawn from one task', () => {
    // A completion can spawn an occurrence, a milestone task and series rows
    // all at once; they must not land on the same id.
    const ids = new Set([
      derivedId(spawnSeed.occurrence('t1')),
      derivedId(spawnSeed.extra('t1')),
      derivedId(spawnSeed.catchUp('t1')),
      derivedId(spawnSeed.seriesDate('t1', '2026-01-10T00:00:00.000Z')),
      derivedId(spawnSeed.seriesDate('t1', '2026-01-15T00:00:00.000Z')),
      derivedId(spawnSeed.subtask('t1', 'sub1')),
    ]);
    expect(ids.size).toBe(6);
  });
});

describe('generateId stays random', () => {
  it('is not derived, so two tasks typed on two devices stay two tasks', () => {
    // Only rows the app writes unattended get a derived id. Giving one to a
    // task a person typed would merge two genuinely different tasks.
    expect(generateId()).not.toBe(generateId());
  });
});
