import fs from 'fs';
import path from 'path';
import {
  SIMPLE_ADD_MENU_FEATURES,
  SIMPLE_AREAS,
  SIMPLE_AREA_LABELS,
  SIMPLE_CONTENT_SCREENS,
  SIMPLE_EDITOR_ROW_FEATURES,
  SIMPLE_FEATURES,
  SIMPLE_GROCERY_ROW_FEATURES,
  SIMPLE_HIDDEN_SCREENS,
  addMenuItemShown,
  editorRowShown,
  featureHidden,
  featureShown,
  groceryRowShown,
  screenShown,
  simpleFeaturesIn,
  taskKindsForMode,
  visibleLenses,
  type SimpleFeatureId,
} from '../utils/simpleMode';

const ids = SIMPLE_FEATURES.map(f => f.id);

describe('the catalog', () => {
  it('has no duplicate ids', () => {
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('files every feature under an area that Settings renders', () => {
    for (const feature of SIMPLE_FEATURES) {
      expect(SIMPLE_AREAS).toContain(feature.area);
      expect(SIMPLE_AREA_LABELS[feature.area]).toBeTruthy();
    }
  });

  it('leaves no area empty, since Settings gives each one a heading', () => {
    for (const area of SIMPLE_AREAS) {
      expect(simpleFeaturesIn(area).length).toBeGreaterThan(0);
    }
  });

  it('covers all four areas the switch claims to reach', () => {
    expect([...SIMPLE_AREAS].sort()).toEqual(['kitchen', 'screens', 'tasks', 'today']);
  });
});

describe('featureHidden / featureShown', () => {
  it('hides nothing while the mode is off', () => {
    for (const id of ids) expect(featureHidden(id, false)).toBe(false);
  });

  it('hides every listed feature while it is on', () => {
    for (const id of ids) expect(featureHidden(id, true)).toBe(true);
  });

  it('does not answer for an id it has never heard of', () => {
    expect(featureHidden('somethingElse' as SimpleFeatureId, true)).toBe(false);
  });

  // Rule 2, and the reason the mode is safe to flip: a feature already in use
  // stays on show, so nothing the user entered can go missing.
  it('keeps a feature that is already set', () => {
    expect(featureShown('chains', true, true)).toBe(true);
    expect(featureShown('chains', true, false)).toBe(false);
    expect(featureShown('chains', false, false)).toBe(true);
  });
});

describe('editorRowShown', () => {
  it('leaves the ordinary form alone', () => {
    for (const key of ['title', 'notes', 'date', 'repeat', 'remindMe', 'category',
      'project', 'tags', 'priority', 'subtasks', 'pin', 'link', 'phone', 'email']) {
      expect(editorRowShown(key, true, false)).toBe(true);
    }
  });

  it('drops an unset advanced row', () => {
    expect(editorRowShown('deadline', true, false)).toBe(false);
    expect(editorRowShown('waitingOn', true, false)).toBe(false);
    expect(editorRowShown('stack', true, false)).toBe(false);
    expect(editorRowShown('effort', true, false)).toBe(false);
    // A supply is an advanced field on a repeating task, the same family as
    // the daily target and the deliverable — and unlike a kind's set-up row
    // it reports a real `set`, so it hides until a task actually has one.
    expect(editorRowShown('supply', true, false)).toBe(false);
  });

  it('keeps the same row once the task uses it', () => {
    expect(editorRowShown('deadline', true, true)).toBe(true);
    expect(editorRowShown('waitingOn', true, true)).toBe(true);
    // Rule 2: a supply already counting down stays editable, or simplified
    // mode would strand a stock nobody could correct.
    expect(editorRowShown('supply', true, true)).toBe(true);
  });

  // The three set-up rows report `set: true` always and only render for the
  // kind they belong to, so a chain task keeps its steps and a timed one its
  // duration — the whole of rule 2 for the editor, for free.
  it('keeps a kind\'s own set-up rows, which are always set', () => {
    for (const key of ['duration', 'dailyTarget', 'chain']) {
      expect(editorRowShown(key, true, true)).toBe(true);
    }
  });

  it('keeps the kind picker exactly while the task is not Standard', () => {
    expect(editorRowShown('kind', true, false)).toBe(false);
    expect(editorRowShown('kind', true, true)).toBe(true);
  });

  it('maps every row to a feature the catalog knows', () => {
    for (const feature of Object.values(SIMPLE_EDITOR_ROW_FEATURES)) {
      expect(ids).toContain(feature);
    }
  });
});

describe('groceryRowShown', () => {
  it('never touches the fields that make an item findable', () => {
    for (const key of ['aisle', 'stores', 'usedIn']) {
      expect(groceryRowShown(key, true, false)).toBe(true);
    }
  });

  it('drops the deep fields until the item uses them', () => {
    expect(groceryRowShown('products', true, false)).toBe(false);
    expect(groceryRowShown('products', true, true)).toBe(true);
    expect(groceryRowShown('pantry', true, false)).toBe(false);
    expect(groceryRowShown('useBy', true, true)).toBe(true);
  });

  it('maps every row to a feature the catalog knows', () => {
    for (const feature of Object.values(SIMPLE_GROCERY_ROW_FEATURES)) {
      expect(ids).toContain(feature);
    }
  });
});

describe('addMenuItemShown', () => {
  it('leaves the whole menu alone while the mode is off', () => {
    for (const key of ['chain', 'stack', 'template', 'task', 'new', 'existing']) {
      expect(addMenuItemShown(key, false)).toBe(true);
    }
  });

  it('never touches the items that add an ordinary task', () => {
    for (const key of ['task', 'new', 'existing']) {
      expect(addMenuItemShown(key, true)).toBe(true);
    }
  });

  // Today's add button is left offering Task alone, which FabMenu performs on
  // the tap rather than opening a menu around.
  it('drops the three that start something simplified mode hides', () => {
    expect(addMenuItemShown('chain', true)).toBe(false);
    expect(addMenuItemShown('stack', true)).toBe(false);
    expect(addMenuItemShown('template', true)).toBe(false);
  });

  // Only *starting* a new one goes: an install with stacks keeps the screen
  // that edits them, and still loses the button that makes another.
  it('drops the button that makes another even where the screen survives', () => {
    expect(screenShown('Stacks', true, { stacks: 4, templates: 2 })).toBe(true);
    expect(screenShown('Templates', true, { stacks: 4, templates: 2 })).toBe(true);
    expect(addMenuItemShown('stack', true)).toBe(false);
    expect(addMenuItemShown('template', true)).toBe(false);
  });

  it('maps every item to a feature the catalog knows', () => {
    for (const feature of Object.values(SIMPLE_ADD_MENU_FEATURES)) {
      expect(ids).toContain(feature);
    }
  });
});

describe('screenShown', () => {
  const none = { stacks: 0, templates: 0 };

  it('shows everything while the mode is off', () => {
    for (const name of [...SIMPLE_HIDDEN_SCREENS, ...SIMPLE_CONTENT_SCREENS]) {
      expect(screenShown(name, false, none)).toBe(true);
    }
  });

  // The five lenses: every task they show is reachable from Today or Search,
  // so hiding them costs nothing however much data exists.
  it('drops the lens screens unconditionally', () => {
    for (const name of SIMPLE_HIDDEN_SCREENS) {
      expect(screenShown(name, true, none)).toBe(false);
      expect(screenShown(name, true, { stacks: 9, templates: 9 })).toBe(false);
    }
  });

  // The two content screens hold objects that live nowhere else, so hiding
  // them while the user has some would strand real data.
  it('keeps a content screen exactly while it holds something', () => {
    expect(screenShown('Stacks', true, none)).toBe(false);
    expect(screenShown('Stacks', true, { stacks: 1, templates: 0 })).toBe(true);
    expect(screenShown('Templates', true, none)).toBe(false);
    expect(screenShown('Templates', true, { stacks: 0, templates: 1 })).toBe(true);
  });

  it('leaves the screens simplified mode has no opinion about', () => {
    for (const name of ['Today', 'Search', 'Groceries', 'Projects', 'Logbook',
      'Categories', 'Tags', 'Archived']) {
      expect(screenShown(name, true, none)).toBe(true);
    }
  });

  it('does not name a screen in both sets', () => {
    for (const name of SIMPLE_CONTENT_SCREENS) {
      expect(SIMPLE_HIDDEN_SCREENS.has(name)).toBe(false);
    }
  });
});

describe('taskKindsForMode', () => {
  it('offers all four while the mode is off', () => {
    expect(taskKindsForMode(false, 'task')).toEqual(['task', 'timed', 'target', 'chain']);
  });

  // The row itself is gone for a Standard task, so this only ever runs for one
  // that already has a shape — and Standard has to stay, or there is no way
  // back out of the shape.
  it('keeps Standard alongside whatever the task already is', () => {
    expect(taskKindsForMode(true, 'chain')).toEqual(['task', 'chain']);
    expect(taskKindsForMode(true, 'timed')).toEqual(['task', 'timed']);
    expect(taskKindsForMode(true, 'task')).toEqual(['task']);
  });
});

describe('visibleLenses', () => {
  const LENSES = ['today', 'later', 'unscheduled', 'inbox'] as const;

  // Later and Inbox are each the only route to a set of real tasks. A lens
  // that hides tasks is a leak, not a simplification.
  it('never drops Later or Inbox', () => {
    const shown = visibleLenses(LENSES, { unscheduled: 0 }, 'today');
    expect(shown).toContain('later');
    expect(shown).toContain('inbox');
    expect(shown).toContain('today');
  });

  it('drops Unscheduled only while it is empty', () => {
    expect(visibleLenses(LENSES, { unscheduled: 0 }, 'today')).not.toContain('unscheduled');
    expect(visibleLenses(LENSES, { unscheduled: 3 }, 'today')).toContain('unscheduled');
  });

  it('keeps the lens you are standing on, so the mode cannot strand a view', () => {
    expect(visibleLenses(LENSES, { unscheduled: 0 }, 'unscheduled'))
      .toContain('unscheduled');
  });
});

/**
 * The catalog's one obligation.
 *
 * Adding an id to `SIMPLE_FEATURES` does nothing by itself, so a feature listed
 * in Settings under "what simplified mode hides" but gated nowhere is a promise
 * the app doesn't keep. This is what stops the list drifting away from the
 * behaviour, and it's the same job `settingsIndex.test.ts` does for the
 * settings index.
 *
 * Three kinds of gate count, because the registry enforces some of them itself:
 * a `featureHidden`/`featureShown` call somewhere under `src/`, a row mapped to
 * the feature in one of the two row maps, or a `screen` on the feature (which
 * `screenShown` reads). Anything else is a feature nobody can see the effect of.
 */
describe('every listed feature is actually gated somewhere', () => {
  const SRC = path.join(__dirname, '..');
  const REGISTRY = path.join(SRC, 'utils', 'simpleMode.ts');

  const sources: string[] = [];
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name !== '__tests__') walk(full);
      } else if (/\.tsx?$/.test(entry.name) && full !== REGISTRY) {
        sources.push(fs.readFileSync(full, 'utf8'));
      }
    }
  };
  walk(SRC);
  const haystack = sources.join('\n');

  const mapped = new Set<string>([
    ...Object.values(SIMPLE_EDITOR_ROW_FEATURES),
    ...Object.values(SIMPLE_GROCERY_ROW_FEATURES),
  ]);

  it.each(SIMPLE_FEATURES.map(f => [f.id, f] as const))('%s has a gate', (id, feature) => {
    const gated = haystack.includes(`'${id}'`) || mapped.has(id) || !!feature.screen;
    expect(gated).toBe(true);
  });

  // Not a no-op: without this, deleting every `featureHidden` call in the app
  // would still leave the suite green on the strength of the maps alone.
  it('spends most of the catalog at a real call site', () => {
    const atCallSites = ids.filter(id => haystack.includes(`'${id}'`));
    expect(atCallSites.length).toBeGreaterThan(SIMPLE_FEATURES.length / 3);
  });
});
