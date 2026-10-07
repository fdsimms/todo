import { parseGroceryInput } from '../utils/groceryParse';
import {
  mirrorTitleFor,
  normalizeMirrorTitle,
  parseGroceryLinks,
  planGroceryReminderSync,
  serializeGroceryLinks,
  withGroceryLinks,
  type GroceryReminderLink,
  type MirrorItem,
  type MirrorReminder,
} from '../utils/groceryReminderMirror';

const item = (over: Partial<MirrorItem> & { id: string; name: string }): MirrorItem => ({
  nameKey: over.name.trim().toLowerCase(),
  quantity: null,
  onList: true,
  checked: false,
  note: '',
  ...over,
});

const reminder = (
  over: Partial<MirrorReminder> & { id: string; title: string }
): MirrorReminder => ({ completed: false, notes: '', ...over });

const link = (
  over: Partial<GroceryReminderLink> & { reminderId: string; itemId: string; name: string }
): GroceryReminderLink => ({ checked: false, note: '', seen: true, ...over });

describe('mirrorTitleFor', () => {
  it('puts the amount back in front of the name', () => {
    expect(mirrorTitleFor({ name: 'chicken', quantity: '2 lb' })).toBe('2 lb chicken');
  });

  it('is just the name when there is no amount', () => {
    expect(mirrorTitleFor({ name: 'milk', quantity: null })).toBe('milk');
    expect(mirrorTitleFor({ name: 'milk', quantity: '  ' })).toBe('milk');
  });

  it('writes a stored size the way it was typed, which reads back', () => {
    // Stored as "3, large"; "3, large eggs" would read back as one name.
    expect(mirrorTitleFor({ name: 'eggs', quantity: '3, large' })).toBe('3 large eggs');
  });

  it('falls back to parentheses for an amount that reads back nowhere else', () => {
    expect(mirrorTitleFor({ name: 'eggs', quantity: 'about a dozen' })).toBe('eggs (about a dozen)');
  });

  it('writes every typed line as a title that reads back to the same row', () => {
    // A title the mirror can't split is a reminder it can't match, and the
    // next pass adds it as a new catalog row with a reminder of its own.
    for (const typed of [
      'milk x2', '12 eggs x2', '3 large eggs', '1 medium onion', '2 lb chicken thighs',
      '2 14 oz cans black beans', 'eggs (dozen)', '1/4 cup tomato paste', 'bananas',
    ]) {
      const row = parseGroceryInput(typed);
      const title = mirrorTitleFor(row);
      expect(parseGroceryInput(title)).toEqual(row);
    }
  });
});

describe('normalizeMirrorTitle', () => {
  it('splits a typed title and rejoins it in the app’s own order', () => {
    expect(normalizeMirrorTitle('2 lb chicken')).toEqual({
      name: 'chicken',
      quantity: '2 lb',
      title: '2 lb chicken',
    });
  });

  it('is null when nothing is left to file it under', () => {
    expect(normalizeMirrorTitle('   ')).toBeNull();
  });

  // The round trip is what keeps a shadow stable: whatever the user types, both
  // sides have to agree on the same string next pass.
  it('round-trips its own output', () => {
    const first = normalizeMirrorTitle('chicken 2lb');
    expect(first).not.toBeNull();
    expect(normalizeMirrorTitle(first!.title)!.title).toBe(first!.title);
  });
});

describe('parseGroceryLinks', () => {
  it('is empty for anything unreadable', () => {
    expect(parseGroceryLinks(null)).toEqual({});
    expect(parseGroceryLinks('{')).toEqual({});
    expect(parseGroceryLinks('[]')).toEqual({});
    expect(parseGroceryLinks('"nope"')).toEqual({});
  });

  it('drops entries missing either id', () => {
    const raw = JSON.stringify({ L: [{ reminderId: 'r1' }, { itemId: 'i1' }, {}] });
    expect(parseGroceryLinks(raw)).toEqual({});
  });

  it('keeps one link per reminder and per item', () => {
    const raw = JSON.stringify({
      L: [
        { reminderId: 'r1', itemId: 'i1', name: 'milk', checked: false },
        { reminderId: 'r1', itemId: 'i2', name: 'milk', checked: false },
        { reminderId: 'r2', itemId: 'i1', name: 'milk', checked: false },
        { reminderId: 'r3', itemId: 'i3', name: 'eggs', checked: true },
      ],
    });
    expect(parseGroceryLinks(raw).L.map(l => l.reminderId)).toEqual(['r1', 'r3']);
  });

  it('treats a record with no seen flag as already confirmed', () => {
    const raw = JSON.stringify({ L: [{ reminderId: 'r1', itemId: 'i1', name: 'milk' }] });
    expect(parseGroceryLinks(raw).L[0].seen).toBe(true);
  });

  it('reads a record from before notes were mirrored as agreeing on no note (#2933)', () => {
    const raw = JSON.stringify({ L: [{ reminderId: 'r1', itemId: 'i1', name: 'milk', checked: false }] });
    expect(parseGroceryLinks(raw).L[0].note).toBe('');
  });

  it('survives a serialize round trip', () => {
    const index = { L: [link({ reminderId: 'r1', itemId: 'i1', name: '2 lb chicken' })] };
    expect(parseGroceryLinks(serializeGroceryLinks(index))).toEqual(index);
  });
});

describe('withGroceryLinks', () => {
  it('deletes an emptied bucket rather than storing []', () => {
    const index = { A: [link({ reminderId: 'r1', itemId: 'i1', name: 'milk' })], B: [] as GroceryReminderLink[] };
    expect(withGroceryLinks(index, 'A', [])).toEqual({ B: [] });
  });

  it('leaves other lists alone', () => {
    const other = [link({ reminderId: 'r9', itemId: 'i9', name: 'eggs' })];
    const next = withGroceryLinks({ B: other }, 'A', [link({ reminderId: 'r1', itemId: 'i1', name: 'milk' })]);
    expect(next.B).toBe(other);
    expect(next.A).toHaveLength(1);
  });
});

describe('planGroceryReminderSync — first pass, nothing linked', () => {
  it('writes a reminder for every unchecked row on the list', () => {
    const plan = planGroceryReminderSync(
      [item({ id: 'i1', name: 'milk' }), item({ id: 'i2', name: 'chicken', quantity: '2 lb' })],
      [],
      []
    );
    expect(plan.createReminders).toEqual([
      { itemId: 'i1', title: 'milk', notes: '' },
      { itemId: 'i2', title: '2 lb chicken', notes: '' },
    ]);
    expect(plan.links).toEqual([]);
  });

  it('leaves a row that is off the list alone', () => {
    const plan = planGroceryReminderSync([item({ id: 'i1', name: 'milk', onList: false })], [], []);
    expect(plan.createReminders).toEqual([]);
  });

  // Switching this on mid-shop should mirror what is still to buy, not post a
  // completed reminder for everything already in the cart.
  it('leaves a row that is already in the cart alone', () => {
    const plan = planGroceryReminderSync([item({ id: 'i1', name: 'milk', checked: true })], [], []);
    expect(plan.createReminders).toEqual([]);
  });

  it('imports a reminder the list has never heard of', () => {
    const plan = planGroceryReminderSync([], [reminder({ id: 'r1', title: 'milk' })], []);
    expect(plan.addItems).toEqual([{ reminderId: 'r1', title: 'milk', notes: '' }]);
    expect(plan.createReminders).toEqual([]);
  });

  it('ignores a completed reminder it has never seen', () => {
    const plan = planGroceryReminderSync([], [reminder({ id: 'r1', title: 'milk', completed: true })], []);
    expect(plan.addItems).toEqual([]);
  });

  it('ignores a blank reminder', () => {
    const plan = planGroceryReminderSync([], [reminder({ id: 'r1', title: '   ' })], []);
    expect(plan.addItems).toEqual([]);
  });
});

describe('planGroceryReminderSync — adoption', () => {
  // The whole no-duplicates guarantee: both sides already say "milk", so the
  // pass links them rather than adding a second one anywhere.
  it('links a matching pair instead of adding to either side', () => {
    const plan = planGroceryReminderSync(
      [item({ id: 'i1', name: 'milk' })],
      [reminder({ id: 'r1', title: 'milk' })],
      []
    );
    expect(plan.addItems).toEqual([]);
    expect(plan.createReminders).toEqual([]);
    expect(plan.updateReminders).toEqual([]);
    expect(plan.links).toEqual([
      { reminderId: 'r1', itemId: 'i1', name: 'milk', checked: false, note: '', seen: true },
    ]);
  });

  it('matches on the catalog key, so the amount does not split a pair', () => {
    const plan = planGroceryReminderSync(
      [item({ id: 'i1', name: 'chicken', quantity: '2 lb' })],
      [reminder({ id: 'r1', title: 'chicken' })],
      []
    );
    expect(plan.addItems).toEqual([]);
    expect(plan.createReminders).toEqual([]);
    // Adopted, and the app's amount is pushed onto the reminder.
    expect(plan.updateReminders).toEqual([
      { reminderId: 'r1', itemId: 'i1', title: '2 lb chicken', completed: false, notes: '' },
    ]);
  });

  it('matches a reminder that carries the amount in its own title', () => {
    // The app's own title shape ("2 lb chicken") read as a name nothing in the
    // catalog had, so the row was imported onto itself and pass 3 then wrote
    // it a second reminder.
    const plan = planGroceryReminderSync(
      [item({ id: 'i1', name: 'chicken', quantity: '2 lb' })],
      [reminder({ id: 'r1', title: '2 lb chicken' })],
      []
    );
    expect(plan.addItems).toEqual([]);
    expect(plan.createReminders).toEqual([]);
    expect(plan.links.map(l => [l.reminderId, l.itemId])).toEqual([['r1', 'i1']]);
  });

  it('re-lists a row that had come off the list', () => {
    const plan = planGroceryReminderSync(
      [item({ id: 'i1', name: 'milk', onList: false })],
      [reminder({ id: 'r1', title: 'milk' })],
      []
    );
    expect(plan.addItems).toEqual([{ reminderId: 'r1', title: 'milk', notes: '' }]);
    expect(plan.createReminders).toEqual([]);
  });

  it('leaves a second reminder for the same thing alone', () => {
    const plan = planGroceryReminderSync(
      [item({ id: 'i1', name: 'milk' })],
      [reminder({ id: 'r1', title: 'milk' }), reminder({ id: 'r2', title: 'Milk' })],
      []
    );
    expect(plan.links.map(l => l.reminderId)).toEqual(['r1']);
    expect(plan.addItems).toEqual([]);
    expect(plan.deleteReminders).toEqual([]);
  });

  it('adds only once for two reminders naming the same unknown thing', () => {
    const plan = planGroceryReminderSync(
      [],
      [reminder({ id: 'r1', title: 'milk' }), reminder({ id: 'r2', title: 'milk' })],
      []
    );
    expect(plan.addItems).toEqual([{ reminderId: 'r1', title: 'milk', notes: '' }]);
  });

  // An adopted pair has no shadow to appeal to, so a disagreement resolves the
  // app's way like any other conflict.
  it('pushes the app’s state onto an adopted reminder', () => {
    const plan = planGroceryReminderSync(
      [item({ id: 'i1', name: 'milk', checked: true })],
      [reminder({ id: 'r1', title: 'milk' })],
      []
    );
    expect(plan.setChecked).toEqual([]);
    expect(plan.updateReminders).toEqual([
      { reminderId: 'r1', itemId: 'i1', title: 'milk', completed: true, notes: '' },
    ]);
  });
});

describe('planGroceryReminderSync — a linked pair', () => {
  const linked = [link({ reminderId: 'r1', itemId: 'i1', name: 'milk' })];

  it('does nothing when both sides still agree', () => {
    const plan = planGroceryReminderSync(
      [item({ id: 'i1', name: 'milk' })],
      [reminder({ id: 'r1', title: 'milk' })],
      linked
    );
    expect(plan).toMatchObject({
      createReminders: [], updateReminders: [], deleteReminders: [],
      addItems: [], setChecked: [], renameItems: [], removeItems: [],
    });
    expect(plan.links).toEqual(linked);
  });

  it('completes the reminder when the row is checked off here', () => {
    const plan = planGroceryReminderSync(
      [item({ id: 'i1', name: 'milk', checked: true })],
      [reminder({ id: 'r1', title: 'milk' })],
      linked
    );
    expect(plan.updateReminders).toEqual([
      { reminderId: 'r1', itemId: 'i1', title: 'milk', completed: true, notes: '' },
    ]);
    expect(plan.links[0].checked).toBe(true);
  });

  it('checks the row off when the reminder is completed there', () => {
    const plan = planGroceryReminderSync(
      [item({ id: 'i1', name: 'milk' })],
      [reminder({ id: 'r1', title: 'milk', completed: true })],
      linked
    );
    expect(plan.setChecked).toEqual([{ itemId: 'i1', checked: true }]);
    expect(plan.updateReminders).toEqual([]);
    expect(plan.links[0].checked).toBe(true);
  });

  it('un-checks the row when the reminder is un-completed there', () => {
    const plan = planGroceryReminderSync(
      [item({ id: 'i1', name: 'milk', checked: true })],
      [reminder({ id: 'r1', title: 'milk' })],
      [link({ reminderId: 'r1', itemId: 'i1', name: 'milk', checked: true })]
    );
    expect(plan.setChecked).toEqual([{ itemId: 'i1', checked: false }]);
    expect(plan.updateReminders).toEqual([]);
  });

  it('lets the app win when both sides changed the same field', () => {
    const plan = planGroceryReminderSync(
      [item({ id: 'i1', name: 'milk', checked: false })],
      [reminder({ id: 'r1', title: 'milk', completed: true })],
      [link({ reminderId: 'r1', itemId: 'i1', name: 'milk', checked: true })]
    );
    expect(plan.setChecked).toEqual([]);
    expect(plan.updateReminders).toEqual([
      { reminderId: 'r1', itemId: 'i1', title: 'milk', completed: false, notes: '' },
    ]);
  });

  it('renames the row when the reminder was renamed there', () => {
    const plan = planGroceryReminderSync(
      [item({ id: 'i1', name: 'milk' })],
      [reminder({ id: 'r1', title: '2 gal oat milk' })],
      linked
    );
    expect(plan.renameItems).toEqual([
      { itemId: 'i1', name: 'oat milk', quantity: '2 gal', title: '2 gal oat milk' },
    ]);
    expect(plan.updateReminders).toEqual([]);
    expect(plan.links[0].name).toBe('2 gal oat milk');
  });

  it('renames the reminder when the row was renamed here', () => {
    const plan = planGroceryReminderSync(
      [item({ id: 'i1', name: 'oat milk', nameKey: 'oat milk' })],
      [reminder({ id: 'r1', title: 'milk' })],
      linked
    );
    expect(plan.renameItems).toEqual([]);
    expect(plan.updateReminders).toEqual([
      { reminderId: 'r1', itemId: 'i1', title: 'oat milk', completed: false, notes: '' },
    ]);
  });

  it('lets the app win a rename both sides made', () => {
    const plan = planGroceryReminderSync(
      [item({ id: 'i1', name: 'oat milk', nameKey: 'oat milk' })],
      [reminder({ id: 'r1', title: 'soy milk' })],
      linked
    );
    expect(plan.renameItems).toEqual([]);
    expect(plan.updateReminders).toEqual([
      { reminderId: 'r1', itemId: 'i1', title: 'oat milk', completed: false, notes: '' },
    ]);
  });

  it('ignores a rename that leaves no name behind', () => {
    const plan = planGroceryReminderSync(
      [item({ id: 'i1', name: 'milk' })],
      [reminder({ id: 'r1', title: '  ' })],
      linked
    );
    expect(plan.renameItems).toEqual([]);
    expect(plan.updateReminders).toEqual([
      { reminderId: 'r1', itemId: 'i1', title: 'milk', completed: false, notes: '' },
    ]);
  });

  it('splits a typed amount off the name, and shadows what both sides will say', () => {
    const plan = planGroceryReminderSync(
      [item({ id: 'i1', name: 'milk' })],
      [reminder({ id: 'r1', title: '2 gal whole milk' })],
      linked
    );
    const renamed = plan.renameItems[0];
    expect(renamed).toEqual({
      itemId: 'i1', name: 'whole milk', quantity: '2 gal', title: '2 gal whole milk',
    });
    // The shadow is what the *row* will produce next pass, not the raw text, so
    // nothing gets pushed back at a reminder nobody touched.
    expect(plan.links[0].name).toBe(mirrorTitleFor({ name: renamed.name, quantity: renamed.quantity }));
  });
});

describe('planGroceryReminderSync — either side going away', () => {
  const linked = [link({ reminderId: 'r1', itemId: 'i1', name: 'milk' })];

  it('deletes the reminder when the row leaves the list', () => {
    const plan = planGroceryReminderSync(
      [item({ id: 'i1', name: 'milk', onList: false })],
      [reminder({ id: 'r1', title: 'milk' })],
      linked
    );
    expect(plan.deleteReminders).toEqual([{ reminderId: 'r1', link: linked[0] }]);
    expect(plan.links).toEqual([]);
  });

  it('deletes the reminder when the row is deleted outright', () => {
    const plan = planGroceryReminderSync([], [reminder({ id: 'r1', title: 'milk' })], linked);
    expect(plan.deleteReminders).toEqual([{ reminderId: 'r1', link: linked[0] }]);
    expect(plan.addItems).toEqual([]);
  });

  it('takes the row off the list when the reminder is deleted there', () => {
    const plan = planGroceryReminderSync([item({ id: 'i1', name: 'milk' })], [], linked);
    expect(plan.removeItems).toEqual([{ itemId: 'i1' }]);
    expect(plan.createReminders).toEqual([]);
    expect(plan.links).toEqual([]);
  });

  it('forgets a link whose two halves have both gone', () => {
    expect(planGroceryReminderSync([], [], linked)).toMatchObject({
      removeItems: [], deleteReminders: [], links: [],
    });
  });

  // An unconfirmed link says nothing about a missing reminder, so the row is
  // written a fresh one rather than being taken off the list.
  it('re-creates rather than un-lists when the link was never confirmed', () => {
    const plan = planGroceryReminderSync(
      [item({ id: 'i1', name: 'milk' })],
      [],
      [link({ reminderId: 'r1', itemId: 'i1', name: 'milk', seen: false })]
    );
    expect(plan.removeItems).toEqual([]);
    expect(plan.createReminders).toEqual([{ itemId: 'i1', title: 'milk', notes: '' }]);
  });

  it('honours the deletion once the link has been confirmed', () => {
    const plan = planGroceryReminderSync(
      [item({ id: 'i1', name: 'milk' })],
      [],
      [link({ reminderId: 'r1', itemId: 'i1', name: 'milk', seen: true })]
    );
    expect(plan.removeItems).toEqual([{ itemId: 'i1' }]);
    expect(plan.createReminders).toEqual([]);
  });

  it('does not resurrect a row it has just taken off the list', () => {
    const plan = planGroceryReminderSync(
      [item({ id: 'i1', name: 'milk' })],
      [reminder({ id: 'r2', title: 'milk' })],
      [link({ reminderId: 'r1', itemId: 'i1', name: 'milk' })]
    );
    // r1 is gone, so the row is un-listed; r2 names the row we just claimed, so
    // it is left alone rather than adding it straight back.
    expect(plan.removeItems).toEqual([{ itemId: 'i1' }]);
    expect(plan.addItems).toEqual([]);
  });
});

describe('planGroceryReminderSync — notes (#2933)', () => {
  const pair = (itemNote: string, reminderNotes: string, shadowNote: string) =>
    planGroceryReminderSync(
      [item({ id: 'i1', name: 'eggs', note: itemNote })],
      [reminder({ id: 'r1', title: 'eggs', notes: reminderNotes })],
      [link({ reminderId: 'r1', itemId: 'i1', name: 'eggs', note: shadowNote })]
    );

  it('takes a note typed into the reminder onto the row', () => {
    const plan = pair('', 'free range, the blue carton', '');
    expect(plan.setNotes).toEqual([{ itemId: 'i1', note: 'free range, the blue carton' }]);
    expect(plan.updateReminders).toEqual([]);
    expect(plan.links[0].note).toBe('free range, the blue carton');
  });

  it('writes a note edited here out to the reminder, with the rest of it', () => {
    const plan = pair('lactose free', '', '');
    expect(plan.setNotes).toEqual([]);
    expect(plan.updateReminders).toEqual([
      { reminderId: 'r1', itemId: 'i1', title: 'eggs', completed: false, notes: 'lactose free' },
    ]);
  });

  it('carries a note cleared on either side to the other', () => {
    expect(pair('', 'old', 'old').updateReminders[0].notes).toBe('');
    expect(pair('old', '', 'old').setNotes).toEqual([{ itemId: 'i1', note: '' }]);
  });

  it('lets the app win when both sides changed the note', () => {
    const plan = pair('lactose free', 'the big one', 'old');
    expect(plan.setNotes).toEqual([]);
    expect(plan.updateReminders[0].notes).toBe('lactose free');
  });

  it('reads whitespace and a missing note as no change', () => {
    const plan = planGroceryReminderSync(
      [item({ id: 'i1', name: 'eggs', note: 'free range' })],
      [reminder({ id: 'r1', title: 'eggs', notes: '  free range\n' })],
      [link({ reminderId: 'r1', itemId: 'i1', name: 'eggs', note: 'free range' })]
    );
    expect(plan.updateReminders).toEqual([]);
    expect(plan.setNotes).toEqual([]);
  });

  it('carries a note on only one side of an adopted pair to the other', () => {
    // The adoption shadow is empty, so the side with a note reads as the side
    // that wrote it, rather than the empty side winning as "the app".
    const pulled = planGroceryReminderSync(
      [item({ id: 'i1', name: 'eggs' })],
      [reminder({ id: 'r1', title: 'eggs', notes: 'free range' })],
      []
    );
    expect(pulled.setNotes).toEqual([{ itemId: 'i1', note: 'free range' }]);
    expect(pulled.updateReminders).toEqual([]);

    const pushed = planGroceryReminderSync(
      [item({ id: 'i1', name: 'eggs', note: 'free range' })],
      [reminder({ id: 'r1', title: 'eggs' })],
      []
    );
    expect(pushed.updateReminders[0].notes).toBe('free range');
  });

  it('writes a new reminder with the row’s note, and imports a reminder with its own', () => {
    const plan = planGroceryReminderSync(
      [item({ id: 'i1', name: 'milk', note: 'lactose free' })],
      [reminder({ id: 'r1', title: 'eggs', notes: 'free range' })],
      []
    );
    expect(plan.createReminders).toEqual([{ itemId: 'i1', title: 'milk', notes: 'lactose free' }]);
    expect(plan.addItems).toEqual([{ reminderId: 'r1', title: 'eggs', notes: 'free range' }]);
  });
});

describe('planGroceryReminderSync — convergence', () => {
  // Applying a plan and running again must produce nothing: a pass that keeps
  // finding work is a pass that keeps writing to both apps for ever.
  const settle = (items: MirrorItem[], reminders: MirrorReminder[], links: GroceryReminderLink[]) => {
    const plan = planGroceryReminderSync(items, reminders, links);
    const nextItems = items.map(i => {
      const renamed = plan.renameItems.find(r => r.itemId === i.id);
      const checked = plan.setChecked.find(c => c.itemId === i.id);
      const noted = plan.setNotes.find(n => n.itemId === i.id);
      const removed = plan.removeItems.some(r => r.itemId === i.id);
      return {
        ...i,
        ...(renamed ? { name: renamed.name, nameKey: renamed.name, quantity: renamed.quantity } : {}),
        ...(checked ? { checked: checked.checked } : {}),
        ...(noted ? { note: noted.note } : {}),
        ...(removed ? { onList: false, checked: false } : {}),
      };
    });
    const deleted = new Set(plan.deleteReminders.map(d => d.reminderId));
    const nextReminders = reminders
      .filter(r => !deleted.has(r.id))
      .map(r => {
        const update = plan.updateReminders.find(u => u.reminderId === r.id);
        return update ? { ...r, title: update.title, completed: update.completed, notes: update.notes } : r;
      });
    const nextLinks = [...plan.links];
    plan.createReminders.forEach((create, index) => {
      const id = `new-r${index}`;
      nextReminders.push({ id, title: create.title, completed: false, notes: create.notes });
      nextLinks.push({
        reminderId: id, itemId: create.itemId, name: create.title, checked: false, note: create.notes, seen: false,
      });
    });
    plan.addItems.forEach((add, index) => {
      const id = `new-i${index}`;
      const parsed = normalizeMirrorTitle(add.title)!;
      nextItems.push({
        id, name: parsed.name, nameKey: parsed.name, quantity: parsed.quantity,
        onList: true, checked: false, note: add.notes,
      });
      nextLinks.push({
        reminderId: add.reminderId, itemId: id, name: parsed.title, checked: false, note: add.notes, seen: true,
      });
    });
    return { items: nextItems, reminders: nextReminders, links: nextLinks };
  };

  const isQuiet = (plan: ReturnType<typeof planGroceryReminderSync>) =>
    plan.createReminders.length === 0 && plan.updateReminders.length === 0 &&
    plan.deleteReminders.length === 0 && plan.addItems.length === 0 &&
    plan.setChecked.length === 0 && plan.renameItems.length === 0 &&
    plan.setNotes.length === 0 && plan.removeItems.length === 0;

  it('settles within two passes from a cold start on both sides', () => {
    let state = {
      items: [
        item({ id: 'i1', name: 'milk' }),
        item({ id: 'i2', name: 'chicken', quantity: '2 lb' }),
        item({ id: 'i3', name: 'eggs' }),
      ],
      reminders: [reminder({ id: 'r1', title: 'eggs' }), reminder({ id: 'r2', title: 'bread' })],
      links: [] as GroceryReminderLink[],
    };
    state = settle(state.items, state.reminders, state.links);
    state = settle(state.items, state.reminders, state.links);
    expect(isQuiet(planGroceryReminderSync(state.items, state.reminders, state.links))).toBe(true);
    expect(state.items.filter(i => i.onList).map(i => i.name).sort())
      .toEqual(['bread', 'chicken', 'eggs', 'milk']);
    expect(state.reminders.map(r => r.title).sort())
      .toEqual(['2 lb chicken', 'bread', 'eggs', 'milk']);
  });

  it('settles after a note is edited on each side', () => {
    let state = {
      items: [item({ id: 'i1', name: 'milk', note: 'lactose free' }), item({ id: 'i2', name: 'eggs' })],
      reminders: [
        reminder({ id: 'r1', title: 'milk' }),
        reminder({ id: 'r2', title: 'eggs', notes: 'free range, the blue carton' }),
      ],
      links: [
        link({ reminderId: 'r1', itemId: 'i1', name: 'milk' }),
        link({ reminderId: 'r2', itemId: 'i2', name: 'eggs' }),
      ],
    };
    state = settle(state.items, state.reminders, state.links);
    expect(isQuiet(planGroceryReminderSync(state.items, state.reminders, state.links))).toBe(true);
    expect(state.items.map(i => i.note)).toEqual(['lactose free', 'free range, the blue carton']);
    expect(state.reminders.map(r => r.notes)).toEqual(['lactose free', 'free range, the blue carton']);
  });

  it('settles after a rename typed into the Reminders app', () => {
    let state = {
      items: [item({ id: 'i1', name: 'milk' })],
      reminders: [reminder({ id: 'r1', title: '2 gal whole milk' })],
      links: [link({ reminderId: 'r1', itemId: 'i1', name: 'milk' })],
    };
    state = settle(state.items, state.reminders, state.links);
    expect(isQuiet(planGroceryReminderSync(state.items, state.reminders, state.links))).toBe(true);
    expect(state.items[0]).toMatchObject({ name: 'whole milk', quantity: '2 gal' });
    expect(state.reminders[0].title).toBe('2 gal whole milk');
  });
});
