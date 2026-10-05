import * as fs from 'fs';
import * as path from 'path';

// CoinBurst calls these from useAnimatedStyle, on the UI thread, where a
// function without the 'worklet' directive is a fatal error. Jest can't run
// Reanimated, so pin the directive in the source.
describe('coinBurst worklets', () => {
  const src = fs.readFileSync(path.join(__dirname, '../utils/coinBurst.ts'), 'utf8');
  it.each(['burstOffset', 'burstOpacity'])('%s is marked as a worklet', name => {
    expect(src).toMatch(new RegExp(`export function ${name}\\([^)]*\\)[^\\n]*\\{\\n\\s*'worklet';`));
  });
});
