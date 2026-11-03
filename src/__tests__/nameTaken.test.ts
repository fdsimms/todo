import {
  categoryRenameTaken,
  choiceGroupRenameTaken,
  cookbookRenameTaken,
  ingredientLineClash,
  projectCategoryTakenBy,
  recipeRenameTaken,
} from '../utils/nameTaken';
import { cookbookKey, recipeNameKey } from '../utils/recipeUtils';
import type { ProjectCategory } from '../types';

// recipeUtils reaches the settings store through mealPlan and dateUtils, which
// nothing here needs. Same mock as recipeUtils.test.ts.
jest.mock('../store/useSettingsStore', () => ({
  useSettingsStore: { getState: () => ({ dayResetTime: '00:00' }) },
}));

const cat = (id: string, name: string): ProjectCategory => ({ id, name } as ProjectCategory);
const recipe = (id: string, name: string, cookbookId: string | null = null) => ({
  id, nameKey: recipeNameKey(name), cookbookId,
});

describe('categoryRenameTaken', () => {
  it('flags another category with exactly that name', () => {
    expect(categoryRenameTaken(['Home', 'Errands'], 'Home', 'Errands')).toBe(true);
    expect(categoryRenameTaken(['Home', 'Errands'], 'Home', '  Errands ')).toBe(true);
  });

  it('compares exactly, as the store does, so a different case is free', () => {
    expect(categoryRenameTaken(['Home', 'Errands'], 'Home', 'errands')).toBe(false);
  });

  it('is not a clash to keep the name, or to type nothing', () => {
    expect(categoryRenameTaken(['Home', 'Errands'], 'Home', 'Home')).toBe(false);
    expect(categoryRenameTaken(['Home', 'Errands'], 'Home', '   ')).toBe(false);
  });
});

describe('projectCategoryTakenBy', () => {
  const list = [cat('a', 'Travel'), cat('b', 'Work')];

  it('ignores case, since Project.category stores the name', () => {
    expect(projectCategoryTakenBy(list, 'travel')?.id).toBe('a');
    expect(projectCategoryTakenBy(list, '  WORK ')?.id).toBe('b');
  });

  it('does not count the row being renamed, so re-casing its own name is a rename', () => {
    expect(projectCategoryTakenBy(list, 'travel', 'a')).toBeUndefined();
    expect(projectCategoryTakenBy(list, 'work', 'a')?.id).toBe('b');
  });

  it('finds nothing for a free or blank name', () => {
    expect(projectCategoryTakenBy(list, 'Garden')).toBeUndefined();
    expect(projectCategoryTakenBy(list, '  ')).toBeUndefined();
  });
});

describe('recipeRenameTaken', () => {
  const tacos = recipe('r1', 'Chicken Tacos');
  const soup = recipe('r2', 'Lentil Soup');
  const bookSoup = recipe('r3', 'Lentil Soup', 'book-1');

  it('flags a name another recipe in the same cookbook has, by the store’s own key', () => {
    expect(recipeRenameTaken([tacos, soup], tacos, 'Lentil Soup')).toBe(true);
    expect(recipeRenameTaken([tacos, soup], tacos, '  lentil   SOUP! ')).toBe(true);
  });

  it('is not a clash with another cookbook’s recipe', () => {
    expect(recipeRenameTaken([tacos, bookSoup], tacos, 'Lentil Soup')).toBe(false);
  });

  it('lets a rename that only changes capitalization through', () => {
    expect(recipeRenameTaken([tacos, soup], tacos, 'chicken tacos')).toBe(false);
  });

  it('is not a clash to type nothing', () => {
    expect(recipeRenameTaken([tacos, soup], tacos, '   ')).toBe(false);
  });
});

describe('cookbookRenameTaken', () => {
  const sweet = { titleKey: cookbookKey('Sweet', 'Yotam') };
  const salt = { titleKey: cookbookKey('Salt Fat', null) };

  it('flags a title and author another book already has, however it is typed', () => {
    expect(cookbookRenameTaken([sweet, salt], salt, ' sweet ', 'YOTAM')).toBe(true);
  });

  it('treats the same title under another author as a different book', () => {
    expect(cookbookRenameTaken([sweet, salt], salt, 'Sweet', 'Someone else')).toBe(false);
    expect(cookbookRenameTaken([sweet, salt], salt, 'Sweet', null)).toBe(false);
  });

  it('is not a clash to keep its own title and author, or to type no title', () => {
    expect(cookbookRenameTaken([sweet, salt], salt, 'Salt Fat', null)).toBe(false);
    expect(cookbookRenameTaken([sweet, salt], salt, '  ', null)).toBe(false);
  });
});

describe('choiceGroupRenameTaken', () => {
  const recipeWith = (ingredientGroups: (string | null)[], componentGroups: (string | null)[] = []) => ({
    ingredients: ingredientGroups.map(choiceGroup => ({ choiceGroup })),
    components: componentGroups.map(choiceGroup => ({ choiceGroup })),
  }) as never;

  it('flags a label another group in the recipe has, by exact match', () => {
    expect(choiceGroupRenameTaken(recipeWith(['Sweetener', 'Milk']), 'Sweetener', 'Milk')).toBe(true);
    expect(choiceGroupRenameTaken(recipeWith(['Sweetener', 'Milk']), 'Sweetener', 'milk')).toBe(false);
  });

  it('counts a used recipe’s label too, since the two share one namespace', () => {
    expect(choiceGroupRenameTaken(recipeWith(['Sweetener'], ['Side']), 'Sweetener', 'Side')).toBe(true);
  });

  it('cleans what was typed before comparing', () => {
    expect(choiceGroupRenameTaken(recipeWith(['Sweetener', 'Milk']), 'Sweetener', '  Milk  ')).toBe(true);
  });

  it('is not a clash to keep its own label or to type nothing', () => {
    expect(choiceGroupRenameTaken(recipeWith(['Sweetener', 'Milk']), 'Sweetener', 'Sweetener')).toBe(false);
    expect(choiceGroupRenameTaken(recipeWith(['Sweetener', 'Milk']), 'Sweetener', '   ')).toBe(false);
  });
});

describe('ingredientLineClash', () => {
  const line = (id: string, name: string, extra: Record<string, unknown> = {}) => ({
    id, name, nameKey: name.toLowerCase(), quantity: '', aisle: null, prep: null, purpose: null, section: null, choiceGroup: null, ...extra,
  }) as never as import('../types').RecipeIngredient;
  const flour = line('a', 'flour');
  const sugar = line('b', 'sugar');
  const draft = (over: Partial<{ name: string; section: string; prep: string; purpose: string }> = {}) =>
    ({ name: 'flour', section: '', prep: '', purpose: '', ...over });

  it('finds the other line that this edit would make a twin of', () => {
    expect(ingredientLineClash([flour, sugar], flour, draft({ name: 'sugar' }))).toBe(sugar);
  });

  it('needs name, heading, prep and purpose together, not the name alone', () => {
    expect(ingredientLineClash([flour, sugar], flour, draft({ name: 'sugar', prep: 'sifted' }))).toBeUndefined();
    const sifted = line('c', 'sugar', { prep: 'sifted' });
    expect(ingredientLineClash([flour, sifted], flour, draft({ name: 'Sugar', prep: ' Sifted ' }))).toBe(sifted);
  });

  it('compares the heading as written and prep and purpose without case', () => {
    const under = line('c', 'sugar', { section: 'Topping' });
    expect(ingredientLineClash([flour, under], flour, draft({ name: 'sugar', section: 'topping' }))).toBeUndefined();
    expect(ingredientLineClash([flour, under], flour, draft({ name: 'sugar', section: 'Topping' }))).toBe(under);
  });

  it('is not a clash when nothing that identifies the line changed, even beside an existing twin', () => {
    const twin = line('c', 'flour');
    expect(ingredientLineClash([flour, twin], flour, draft())).toBeUndefined();
  });

  it('never counts the line against itself', () => {
    expect(ingredientLineClash([flour], flour, draft({ prep: 'sifted' }))).toBeUndefined();
  });
});
