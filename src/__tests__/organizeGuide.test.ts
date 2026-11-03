import { ORGANIZE_GUIDE, PROJECT_DEFINITION, organizeGuideEntries } from '../utils/organizeGuide';

describe('the organize guide', () => {
  it('describes each of the five once', () => {
    expect(ORGANIZE_GUIDE.map(e => e.kind)).toEqual(['category', 'tag', 'project', 'stack', 'template']);
    expect(new Set(ORGANIZE_GUIDE.map(e => e.title)).size).toBe(5);
  });

  it('says the same thing about a project as the Projects empty state does', () => {
    expect(ORGANIZE_GUIDE.find(e => e.kind === 'project')?.body).toBe(PROJECT_DEFINITION);
  });

  it('is written in the app’s own copy style', () => {
    for (const e of ORGANIZE_GUIDE) {
      for (const text of [e.title, e.body, e.examples]) {
        expect(text.trim()).not.toBe('');
        expect(text).not.toMatch(/—/);
        expect(text).not.toMatch(/'/); // curly apostrophes only
      }
      expect(e.body.endsWith('.')).toBe(true);
    }
  });

  it('lists all five normally', () => {
    expect(organizeGuideEntries(false)).toHaveLength(5);
  });

  it('leaves out stacks and templates where Simplified mode takes them away, and nothing else', () => {
    const kinds = organizeGuideEntries(true).map(e => e.kind);
    expect(kinds).toEqual(['category', 'tag', 'project']);
  });
});
