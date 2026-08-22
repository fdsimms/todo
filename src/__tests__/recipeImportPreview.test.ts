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
    expect(methodRowMeta(7, 7, false)).toBe('7 steps');
  });

  it('does not pluralise a single step', () => {
    expect(methodRowMeta(1, 1, false)).toBe('1 step');
  });

  it('says where the steps land when the recipe already has a method', () => {
    expect(methodRowMeta(3, 3, true)).toBe('3 steps, added after the method it already has');
  });

  // The whole point of a per-line tick is lost if the folded row still claims
  // all seven are coming.
  it('becomes a fraction once a line is unticked', () => {
    expect(methodRowMeta(5, 7, false)).toBe('5 of 7 steps');
  });

  it('says none rather than zero', () => {
    expect(methodRowMeta(0, 7, false)).toBe('none of 7 steps');
  });

  // A row adding no steps isn't adding them after anything.
  it('drops the appending clause when nothing is ticked', () => {
    expect(methodRowMeta(0, 7, true)).toBe('none of 7 steps');
    expect(methodRowMeta(1, 7, true)).toBe('1 of 7 steps, added after the method it already has');
  });
});

describe('prepTasksRowMeta', () => {
  it('counts the tasks', () => {
    expect(prepTasksRowMeta(2, 2, false)).toBe('2 tasks');
    expect(prepTasksRowMeta(1, 1, false)).toBe('1 task');
  });

  it('says where they land when the recipe already has some', () => {
    expect(prepTasksRowMeta(1, 1, true)).toBe('1 task, added after what it already has');
  });

  it('becomes a fraction once a line is unticked', () => {
    expect(prepTasksRowMeta(1, 3, false)).toBe('1 of 3 tasks');
    expect(prepTasksRowMeta(0, 3, true)).toBe('none of 3 tasks');
  });
});

describe('methodPreviewLines', () => {
  it('keeps each step verbatim and carries no lead time', () => {
    expect(methodPreviewLines(['Preheat the oven.', 'Cream the butter.'])).toEqual([
      { text: 'Preheat the oven.', offsetDays: null },
      { text: 'Cream the butter.', offsetDays: null },
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
  it('carries the offset as a number, for the line\'s own stepper', () => {
    expect(prepTaskPreviewLines([prep('Soak the beans', -1), prep('Brine the turkey', -2)])).toEqual([
      { text: 'Soak the beans', offsetDays: -1 },
      { text: 'Brine the turkey', offsetDays: -2 },
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
