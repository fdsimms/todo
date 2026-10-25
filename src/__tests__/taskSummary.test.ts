import { buildTaskSummary, inSentence, type SummaryPart } from '../utils/taskSummary';

const text = (parts: SummaryPart[]) => parts.map(p => p.text).join('');
const values = (parts: SummaryPart[]) => parts.filter(p => p.key).map(p => [p.key, p.text]);

describe('inSentence', () => {
  it('lowercases a word the app wrote', () => {
    expect(inSentence('Today')).toBe('today');
    expect(inSentence('Every week on Sun')).toBe('every week on Sun');
    expect(inSentence('When it becomes visible')).toBe('when it becomes visible');
  });

  it('keeps a weekday, a month, a number or an acronym', () => {
    expect(inSentence('Sunday')).toBe('Sunday');
    expect(inSentence('Oct 26 at 9:00 AM')).toBe('Oct 26 at 9:00 AM');
    expect(inSentence('2 days before due, 9:00 AM')).toBe('2 days before due, 9:00 AM');
    expect(inSentence('AM')).toBe('AM');
  });
});

describe('buildTaskSummary', () => {
  it('says nothing for a task with nothing set', () => {
    expect(buildTaskSummary({})).toEqual([]);
  });

  it('reads a simple repeating task as sentences, in the order of the cards', () => {
    const parts = buildTaskSummary({
      date: 'Today', timesOfDay: ['morning'], reminder: 'On due date, 9:00 AM',
      repeat: 'Every week on Sun', streak: 6, priority: 'Medium',
      category: 'Home', tags: ['chores'],
    });
    expect(text(parts)).toBe(
      'Shows up today in the morning. Reminds you on due date, 9:00 AM. '
      + 'Repeats every week on Sun, on a streak of 6. Medium priority. Filed in Home, tagged chores.',
    );
  });

  it('tags each value with the row it came from', () => {
    expect(values(buildTaskSummary({ date: 'Sunday', timesOfDay: ['evening'], category: 'Home' }))).toEqual([
      ['date', 'Sunday'], ['timeOfDay', 'evening'], ['category', 'Home'],
    ]);
  });

  it('keeps the words between values as single runs', () => {
    const parts = buildTaskSummary({ date: 'Today', repeat: 'Every day' });
    expect(parts.map(p => p.key ?? '·')).toEqual(['·', 'date', '·', 'repeat', '·']);
  });

  it('never changes the case of a name the user chose', () => {
    expect(text(buildTaskSummary({ category: 'iPhone stuff', people: 'Sam' }))).toBe('Filed in iPhone stuff. With Sam.');
  });

  it('capitalizes a sentence that opens on a value', () => {
    expect(text(buildTaskSummary({ priority: 'High', pinned: true }))).toBe('High priority, pinned to Today.');
    expect(text(buildTaskSummary({ pinned: true }))).toBe('Pinned to Today.');
  });

  describe('when', () => {
    it('spells out a date already gone by', () => {
      expect(text(buildTaskSummary({ date: '3d ago' }))).toBe('Showed up 3 days ago.');
      expect(text(buildTaskSummary({ date: '1d ago' }))).toBe('Showed up 1 day ago.');
      expect(text(buildTaskSummary({ date: 'Yesterday' }))).toBe('Showed up yesterday.');
    });

    it('joins several times of day with "or"', () => {
      expect(text(buildTaskSummary({ timesOfDay: ['morning', 'afternoon', 'evening'] })))
        .toBe('Shows up in the morning, afternoon or evening.');
    });

    it('says either end of a time window, or both', () => {
      expect(text(buildTaskSummary({ date: 'Today', windowStart: '9:00 AM', windowEnd: '11:00 AM' })))
        .toBe('Shows up today between 9:00 AM and 11:00 AM.');
      expect(text(buildTaskSummary({ windowStart: 'Sunrise' }))).toBe('Shows up from sunrise.');
      expect(text(buildTaskSummary({ windowEnd: '5:00 PM' }))).toBe('Shows up until 5:00 PM.');
    });

    it('says a deadline, and an overdue one as how long ago it passed', () => {
      expect(text(buildTaskSummary({ deadline: 'Nov 15' }))).toBe('Due by Nov 15.');
      expect(text(buildTaskSummary({ deadline: 'Tomorrow 5:00 PM' }))).toBe('Due by tomorrow 5:00 PM.');
      expect(text(buildTaskSummary({ deadline: '1d overdue' }))).toBe('Overdue by 1 day.');
    });
  });

  describe('a template item', () => {
    it('reads its offsets where a task has days', () => {
      expect(text(buildTaskSummary({
        date: '3 days before start date', hiddenUntil: '1 day before start date', deadline: 'The day you leave',
      }))).toBe('Shows up 3 days before start date. Hidden until 1 day before start date. Due by the day you leave.');
    });

    it('drops an offset’s own "On" after "until" and "by", and keeps it after "shows up"', () => {
      expect(text(buildTaskSummary({ date: 'On start date', hiddenUntil: 'On start date', deadline: 'On end date' })))
        .toBe('Shows up on start date. Hidden until start date. Due by end date.');
    });

    it('says first that it starts unchecked, and links that to its row', () => {
      const parts = buildTaskSummary({ optional: true, date: 'On start date' });
      expect(text(parts)).toBe('Starts unchecked when the template is applied. Shows up on start date.');
      expect(values(parts)[0]).toEqual(['optional', 'Starts unchecked']);
    });
  });

  it('leaves out a streak of nothing, and a streak on a task that doesn’t repeat', () => {
    expect(text(buildTaskSummary({ repeat: 'Every day', streak: 0 }))).toBe('Repeats every day.');
    expect(text(buildTaskSummary({ streak: 4 }))).toBe('');
  });

  it('files under a project and a stack', () => {
    expect(text(buildTaskSummary({ project: 'Garden', stack: 'Sunday chores', tags: ['outside', 'weekly'] })))
      .toBe('Part of Garden, in the Sunday chores stack, tagged outside, weekly.');
  });

  it('waits for a task and a person in one sentence', () => {
    expect(text(buildTaskSummary({ waitingOn: 'Get passport photos', waitingOnPerson: 'Sam' })))
      .toBe('Waits for Get passport photos and Sam.');
    expect(text(buildTaskSummary({ waitingOnPerson: 'Sam' }))).toBe('Waits for Sam.');
  });

  it('says who and where together', () => {
    expect(text(buildTaskSummary({ people: 'Sam', location: 'Back porch' }))).toBe('With Sam at Back porch.');
    expect(text(buildTaskSummary({ location: 'Back porch' }))).toBe('At Back porch.');
  });

  it('lists what the task opens', () => {
    expect(text(buildTaskSummary({ workout: 'Stretching', link: 'Duolingo', phone: '555-0100', email: 'sam@example.com' })))
      .toBe('Starts Stretching, opens Duolingo, calls 555-0100, emails sam@example.com.');
  });

  it('says what checking it off asks for', () => {
    expect(text(buildTaskSummary({ asks: 'date' }))).toBe('Asks for a date when you check it off.');
    expect(text(buildTaskSummary({ asks: 'yesno' }))).toBe('Asks for yes or no when you check it off.');
    expect(text(buildTaskSummary({ pushups: 20 }))).toBe('Takes 20 pushups to check off.');
    expect(text(buildTaskSummary({ pushups: 1 }))).toBe('Takes 1 pushup to check off.');
    expect(text(buildTaskSummary({ pushups: 20, asks: 'date' }))).toBe('Takes 20 pushups and asks for a date when you check it off.');
  });
});

describe('a task that waits if the day is full', () => {
  it('says so after its date, as a tappable value', () => {
    const parts = buildTaskSummary({ date: 'Friday', waitsIfFull: true });
    expect(text(parts)).toBe('Shows up Friday, or later if that day is full.');
    expect(values(parts)).toContainEqual(['slotIn', 'later if that day is full']);
  });

  it('says nothing without a date', () => {
    expect(buildTaskSummary({ waitsIfFull: true })).toEqual([]);
  });
});

describe('the place reminder clause', () => {
  const text = (parts: { text: string }[]) => parts.map(p => p.text).join('');

  it('says where it rings on its own', () => {
    expect(text(buildTaskSummary({ placeReminder: 'Arriving at Home' }))).toBe('Reminds you when arriving at Home.');
  });

  it('follows a timed reminder as a second clause, opening its own row', () => {
    const parts = buildTaskSummary({ reminder: 'At 9:00 AM', placeReminder: 'Leaving Office' });
    expect(text(parts)).toBe('Reminds you at 9:00 AM, and again when leaving Office.');
    expect(parts.find(p => p.key === 'remindAtPlace')?.text).toBe('leaving Office');
  });
});
