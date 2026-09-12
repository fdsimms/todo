import { categoryLabel } from '../utils/categoryLabel';
import type { Category } from '../types';

const cat = (name: string, emoji?: string): Category =>
  ({ id: name, name, emoji, sortOrder: 1 } as Category);

const categories = [cat('Work', '💼'), cat('Errands')];

describe('categoryLabel', () => {
  it('prefixes the name with the category emoji', () => {
    expect(categoryLabel('Work', categories)).toBe('💼 Work');
  });

  it('leaves a category with no emoji as its bare name', () => {
    expect(categoryLabel('Errands', categories)).toBe('Errands');
  });

  // A task can name a category that has since been deleted or renamed, and the
  // name it carries is still what should be shown.
  it('shows a name that matches no known category', () => {
    expect(categoryLabel('Gone', categories)).toBe('Gone');
  });

  it('has nothing to say about a task with no category', () => {
    expect(categoryLabel(null, categories)).toBe('');
    expect(categoryLabel(undefined, categories)).toBe('');
    expect(categoryLabel('', categories)).toBe('');
  });

  it('works with no categories loaded', () => {
    expect(categoryLabel('Work', [])).toBe('Work');
  });
});
