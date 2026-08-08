import {
  BACKUP_FORMAT,
  REDACTED_SETTING_KEYS,
  buildBackup,
  serializeBackup,
  parseBackup,
  redactSettings,
  projectRow,
  backupCounts,
  summarizeBackup,
  backupFileName,
  type Backup,
  type BackupRow,
} from '../utils/backup';

const EXPORTED_AT = new Date(2026, 7, 6, 19, 30, 0); // Thu Aug 6 2026, 7:30 PM

const build = (tables: Record<string, BackupRow[]>): Backup =>
  buildBackup(tables, { appVersion: '1.2.3', exportedAt: EXPORTED_AT });

describe('buildBackup', () => {
  it('stamps the current format, the app version and the time', () => {
    const backup = build({ tasks: [] });
    expect(backup.format).toBe(BACKUP_FORMAT);
    expect(backup.appVersion).toBe('1.2.3');
    expect(backup.exportedAt).toBe(EXPORTED_AT.toISOString());
  });

  it('carries every table through untouched', () => {
    const tasks: BackupRow[] = [{ id: 't1', title: 'Walk the dog', completed: 0, due_date: null }];
    const backup = build({ tasks, projects: [] });
    expect(backup.tables.tasks).toEqual(tasks);
    expect(backup.tables.projects).toEqual([]);
  });

  // The one thing a backup must never contain: it's a file the user is about
  // to send somewhere, and the key is a live billing credential.
  it('strips the API key out of the settings table', () => {
    const backup = build({
      settings: [
        { key: 'themeMode', value: 'dark' },
        { key: 'anthropicApiKey', value: 'sk-ant-secret' },
        { key: 'dayResetTime', value: '02:00' },
      ],
    });
    expect(backup.tables.settings).toEqual([
      { key: 'themeMode', value: 'dark' },
      { key: 'dayResetTime', value: '02:00' },
    ]);
  });

  it('leaves a key of the same name in another table alone', () => {
    // Only `settings` is redacted — a task that happens to be called
    // "anthropicApiKey" is just a task.
    const backup = build({ tasks: [{ id: 't1', key: 'anthropicApiKey' }] });
    expect(backup.tables.tasks).toHaveLength(1);
  });

  it('never serialises a redacted key, whatever the settings order', () => {
    const backup = build({
      settings: REDACTED_SETTING_KEYS.map(key => ({ key, value: 'secret-value' })),
    });
    expect(serializeBackup(backup)).not.toContain('secret-value');
  });
});

describe('redactSettings', () => {
  it('drops every redacted key and keeps the rest', () => {
    const rows: BackupRow[] = [
      { key: 'a', value: '1' },
      ...REDACTED_SETTING_KEYS.map(key => ({ key, value: 'x' })),
      { key: 'b', value: '2' },
    ];
    expect(redactSettings(rows)).toEqual([
      { key: 'a', value: '1' },
      { key: 'b', value: '2' },
    ]);
  });

  it('is a no-op on rows with no key column', () => {
    const rows: BackupRow[] = [{ id: '1' }];
    expect(redactSettings(rows)).toEqual(rows);
  });
});

describe('parseBackup', () => {
  it('round-trips a backup it built', () => {
    const backup = build({
      tasks: [{ id: 't1', title: 'Walk the dog', completed: 0, due_date: null, sort_order: 1.5 }],
      settings: [{ key: 'themeMode', value: 'dark' }],
    });
    const result = parseBackup(serializeBackup(backup));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.backup).toEqual(backup);
  });

  it('rejects text that is not JSON', () => {
    const result = parseBackup('this is not json');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/valid JSON/);
  });

  it('rejects JSON that is not an object', () => {
    for (const text of ['[]', '"a string"', '42', 'null']) {
      expect(parseBackup(text).ok).toBe(false);
    }
  });

  it('rejects an object with no format version', () => {
    expect(parseBackup(JSON.stringify({ tables: { tasks: [] } })).ok).toBe(false);
    expect(parseBackup(JSON.stringify({ format: '1', tables: {} })).ok).toBe(false);
    expect(parseBackup(JSON.stringify({ format: 1.5, tables: {} })).ok).toBe(false);
  });

  // Importing a format we don't understand is worse than refusing it: a future
  // version could mean something different by the same column.
  it('refuses a backup from a newer format, by name', () => {
    const result = parseBackup(JSON.stringify({ format: BACKUP_FORMAT + 1, tables: {} }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/newer version/);
  });

  it('accepts the current format', () => {
    expect(parseBackup(JSON.stringify({ format: BACKUP_FORMAT, tables: {} })).ok).toBe(true);
  });

  it('rejects a missing or non-object tables field', () => {
    expect(parseBackup(JSON.stringify({ format: 1 })).ok).toBe(false);
    expect(parseBackup(JSON.stringify({ format: 1, tables: [] })).ok).toBe(false);
  });

  it('rejects a table whose value is not an array', () => {
    const result = parseBackup(JSON.stringify({ format: 1, tables: { tasks: { id: 't1' } } }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('tasks');
  });

  it('rejects rows that are not objects', () => {
    expect(parseBackup(JSON.stringify({ format: 1, tables: { tasks: ['nope'] } })).ok).toBe(false);
    expect(parseBackup(JSON.stringify({ format: 1, tables: { tasks: [null] } })).ok).toBe(false);
    expect(parseBackup(JSON.stringify({ format: 1, tables: { tasks: [[1, 2]] } })).ok).toBe(false);
  });

  // SQLite columns hold primitives — even the JSON ones are stored as strings —
  // so a nested value is never something the exporter wrote.
  it('rejects rows holding a value SQLite could not have stored', () => {
    const nested = JSON.stringify({ format: 1, tables: { tasks: [{ id: 't1', tags: ['a'] }] } });
    expect(parseBackup(nested).ok).toBe(false);
    const obj = JSON.stringify({ format: 1, tables: { tasks: [{ id: 't1', meta: { a: 1 } }] } });
    expect(parseBackup(obj).ok).toBe(false);
  });

  it('accepts strings, numbers and nulls as cell values', () => {
    const text = JSON.stringify({
      format: 1,
      tables: { tasks: [{ id: 't1', sort_order: 2.5, completed: 0, due_date: null }] },
    });
    expect(parseBackup(text).ok).toBe(true);
  });

  it('tolerates a missing appVersion or exportedAt rather than failing', () => {
    const result = parseBackup(JSON.stringify({ format: 1, tables: { tasks: [] } }));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.backup.appVersion).toBe('unknown');
      expect(result.backup.exportedAt).toBe('');
    }
  });

  it('accepts an older format version', () => {
    expect(parseBackup(JSON.stringify({ format: 0, tables: {} })).ok).toBe(true);
  });
});

describe('projectRow', () => {
  const allowed = ['id', 'title', 'completed'];

  it('keeps the columns the schema has', () => {
    expect(projectRow({ id: 't1', title: 'A', completed: 0 }, allowed)).toEqual({
      id: 't1', title: 'A', completed: 0,
    });
  });

  // A backup from a newer build carries columns this one has never heard of.
  // Inserting them would throw and lose the entire restore.
  it('drops columns the schema does not have', () => {
    expect(projectRow({ id: 't1', title: 'A', invented_later: 'x' }, allowed)).toEqual({
      id: 't1', title: 'A',
    });
  });

  // A backup from an older build is missing columns this one added; leaving
  // them out of the INSERT lets SQLite apply the schema default.
  it('omits columns the row does not have rather than nulling them', () => {
    const out = projectRow({ id: 't1' }, allowed);
    expect(out).toEqual({ id: 't1' });
    expect(Object.prototype.hasOwnProperty.call(out, 'completed')).toBe(false);
  });

  it('keeps an explicit null, which is not the same as absent', () => {
    const out = projectRow({ id: 't1', title: null }, allowed);
    expect(Object.prototype.hasOwnProperty.call(out, 'title')).toBe(true);
    expect(out.title).toBeNull();
  });

  // This is the injection guard: column names come out of a user-supplied file
  // and end up in SQL text, and only names matching a real column survive.
  it('drops a column name carrying SQL', () => {
    const evil = { 'id"); DROP TABLE tasks; --': 'x', id: 't1' };
    expect(projectRow(evil, allowed)).toEqual({ id: 't1' });
  });

  it('returns nothing when no column matches', () => {
    expect(projectRow({ nope: 1, also_nope: 2 }, allowed)).toEqual({});
  });

  it('ignores inherited properties', () => {
    const row = Object.create({ title: 'inherited' }) as BackupRow;
    row.id = 't1';
    expect(projectRow(row, allowed)).toEqual({ id: 't1' });
  });
});

describe('backupCounts', () => {
  it('counts the rows in each table', () => {
    const backup = build({
      tasks: [{ id: '1' }, { id: '2' }, { id: '3' }],
      projects: [{ id: 'p1' }],
      templates: [],
    });
    expect(backupCounts(backup)).toEqual({ tasks: 3, projects: 1, templates: 0 });
  });
});

describe('summarizeBackup', () => {
  it('names a single table', () => {
    expect(summarizeBackup(build({ tasks: [{ id: '1' }, { id: '2' }] }))).toBe('2 tasks');
  });

  it('singularises a count of one', () => {
    expect(summarizeBackup(build({ tasks: [{ id: '1' }] }))).toBe('1 task');
    expect(summarizeBackup(build({ categories: [{ id: '1' }] }))).toBe('1 category');
  });

  it('names grocery items', () => {
    expect(summarizeBackup(build({ grocery_items: [{ id: '1' }] }))).toBe('1 grocery item');
    expect(summarizeBackup(build({ meal_plan_entries: [{ id: '1' }] }))).toBe('1 planned meal');
    expect(summarizeBackup(build({ meal_plan_entries: [{ id: '1' }, { id: '2' }] }))).toBe('2 planned meals');
    expect(summarizeBackup(build({ grocery_items: [{ id: '1' }, { id: '2' }] }))).toBe('2 grocery items');
  });

  it('joins several with commas and a trailing "and"', () => {
    const backup = build({
      tasks: [{ id: '1' }, { id: '2' }],
      projects: [{ id: 'p1' }],
      task_groups: [{ id: 'g1' }, { id: 'g2' }],
    });
    expect(summarizeBackup(backup)).toBe('2 tasks, 1 project and 2 stacks');
  });

  // A fresh install's backup shouldn't read as a wall of zeroes.
  it('leaves empty tables out entirely', () => {
    const backup = build({ tasks: [{ id: '1' }], projects: [], templates: [] });
    expect(summarizeBackup(backup)).toBe('1 task');
  });

  it('says so when there is nothing in it', () => {
    expect(summarizeBackup(build({ tasks: [], projects: [] }))).toBe('no tasks or projects');
  });

  it('uses the user-facing word for a stack, not the code word', () => {
    const summary = summarizeBackup(build({ task_groups: [{ id: 'g1' }] }));
    expect(summary).toBe('1 stack');
    expect(summary).not.toContain('group');
  });
});

describe('backupFileName', () => {
  it('builds a chronologically sortable name', () => {
    expect(backupFileName(EXPORTED_AT)).toBe('todo-backup-2026-08-06-1930.json');
  });

  it('zero-pads every field', () => {
    expect(backupFileName(new Date(2026, 0, 2, 3, 4, 0))).toBe('todo-backup-2026-01-02-0304.json');
  });

  // Colons are legal on iOS but get mangled the moment the file reaches
  // iCloud Drive or a Windows share — which is where a backup goes.
  it('contains no character a filesystem would object to', () => {
    expect(backupFileName(EXPORTED_AT)).not.toMatch(/[:/\\?*|"<>]/);
  });

  it('sorts lexicographically in chronological order', () => {
    const names = [
      backupFileName(new Date(2026, 7, 6, 9, 5, 0)),
      backupFileName(new Date(2026, 7, 6, 19, 30, 0)),
      backupFileName(new Date(2026, 11, 1, 0, 0, 0)),
      backupFileName(new Date(2027, 0, 1, 0, 0, 0)),
    ];
    expect([...names].sort()).toEqual(names);
  });
});
