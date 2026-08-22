import {
  methodRowMeta,
  prepTasksRowMeta,
  methodPreviewLines,
  prepTaskPreviewLines,
  previewToggleLabel,
} from '../utils/recipeImportPreview';
import type { ExtractedPrepTask } from '../services/aiSuggestions';

const prep = (title: string, offsetDays: number): ExtractedPrepTask => ({ title, offsetDays });

describe('methodRowMeta', () => {
  it('counts the steps', () => {
    expect(methodRowMeta(7, false)).toBe('7 steps');
  });

  it('does not pluralise a single step', () => {
    expect(methodRowMeta(1, false)).toBe('1 step');
  });

  it('says where the steps land when the recipe already has a method', () => {
    expect(methodRowMeta(3, true)).toBe('3 steps, added after the method it already has');
  });
});

describe('prepTasksRowMeta', () => {
  it('counts the tasks', () => {
    expect(prepTasksRowMeta(2, false)).toBe('2 tasks');
    expect(prepTasksRowMeta(1, false)).toBe('1 task');
  });

  it('says where they land when the recipe already has some', () => {
    expect(prepTasksRowMeta(1, true)).toBe('1 task, added after what it already has');
  });
});

describe('methodPreviewLines', () => {
  it('keeps each step verbatim and carries no lead time', () => {
    expect(methodPreviewLines(['Preheat the oven.', 'Cream the butter.'])).toEqual([
      { text: 'Preheat the oven.', lead: null },
      { text: 'Cream the butter.', lead: null },
    ]);
  });

  // The row numbers the lines itself, so a source that numbers its own steps
  // must not be renumbered into "1. 1. Preheat".
  it('does not add its own numbering', () => {
    expect(methodPreviewLines(['1. Preheat the oven.'])[0].text).toBe('1. Preheat the oven.');
  });

  it('is empty for a recipe with no method', () => {
    expect(methodPreviewLines([])).toEqual([]);
  });
});

describe('prepTaskPreviewLines', () => {
  it('puts the lead time on the line, worded as the app words offsets', () => {
    expect(prepTaskPreviewLines([prep('Soak the beans', -1), prep('Brine the turkey', -2)])).toEqual([
      { text: 'Soak the beans', lead: '1 day before' },
      { text: 'Brine the turkey', lead: '2 days before' },
    ]);
  });

  it('is empty when nothing needs advance prep', () => {
    expect(prepTaskPreviewLines([])).toEqual([]);
  });
});

describe('previewToggleLabel', () => {
  it('names the direction and the count', () => {
    expect(previewToggleLabel(false, 7, 'step')).toBe('Show the 7 steps');
    expect(previewToggleLabel(true, 7, 'step')).toBe('Hide the 7 steps');
  });

  it('drops the count for a lone line', () => {
    expect(previewToggleLabel(false, 1, 'task')).toBe('Show the task');
    expect(previewToggleLabel(true, 1, 'step')).toBe('Hide the step');
  });
});
