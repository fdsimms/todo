import type { RecognizedLine } from 'todo-vision-bridge';
import { reconstructToc, shouldUseOcrText, stripTocNoise } from '../utils/cookbookOcr';

/** A recognized text run, normalized 0..1 with the origin at the top left. */
function run(text: string, x: number, y: number, width = 0.3, height = 0.02): RecognizedLine {
  return { text, x, y, width, height, confidence: 0.9 };
}

/** A whole printed row: a recipe title on the left, its page number on the right. */
function tocRow(title: string, page: string, y: number): RecognizedLine[] {
  return [run(title, 0.08, y, 0.4), run(page, 0.86, y + 0.002, 0.06, 0.015)];
}

describe('reconstructToc', () => {
  it('joins a title and its page number onto one printed row', () => {
    const reading = reconstructToc(tocRow('Roast Chicken', '42', 0.1));
    expect(reading.rows).toEqual(['Roast Chicken 42']);
    expect(reading.text).toBe('Roast Chicken 42');
  });

  it('reads rows top to bottom whatever order Vision returned', () => {
    const reading = reconstructToc([
      ...tocRow('Tomato Soup', '18', 0.2),
      ...tocRow('Roast Chicken', '42', 0.1),
    ]);
    expect(reading.rows).toEqual(['Roast Chicken 42', 'Tomato Soup 18']);
  });

  it('drops blank runs', () => {
    const reading = reconstructToc([run('  ', 0.08, 0.1), run('Roast Chicken', 0.08, 0.1)]);
    expect(reading.rows).toEqual(['Roast Chicken']);
  });
});

describe('shouldUseOcrText', () => {
  it('refuses a read too thin to be a contents page', () => {
    expect(shouldUseOcrText({ rows: ['Contents'], text: 'Contents' })).toBe(false);
  });

  it('accepts a read with several printed rows', () => {
    const rows = ['Breakfast', 'Roast Chicken 42', 'Tomato Soup 18', 'Banana Bread 55'];
    expect(shouldUseOcrText({ rows, text: rows.join('\n') })).toBe(true);
  });
});

describe('stripTocNoise', () => {
  it('strips a dot leader and page number', () => {
    expect(stripTocNoise('Roast Chicken .......... 42')).toBe('Roast Chicken');
  });

  it('strips a page number separated only by spaces', () => {
    expect(stripTocNoise('Roast Chicken    42')).toBe('Roast Chicken');
  });

  it('leaves a title with no trailing page number alone', () => {
    expect(stripTocNoise('Roast Chicken')).toBe('Roast Chicken');
  });

  it('does not mistake a title that plainly ends in a number for a page number', () => {
    // No leader and no run of spaces before the digit — nothing here says this
    // trailing "2" is a page number rather than part of the title.
    expect(stripTocNoise('Dinner for 2')).toBe('Dinner for 2');
  });
});
