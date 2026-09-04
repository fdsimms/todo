import {
  SETTINGS_GROUPS,
  SETTINGS_ENTRIES,
  settingsGroup,
  visibleSettingsGroups,
  visibleSettingsEntries,
} from '../utils/settingsIndex';
import { AI_FEATURES } from '../utils/aiFeatures';
import {
  GENERATED_KIND_LIST,
  generatedTaskCounts,
  type GeneratedEnabledKey,
} from '../utils/generatedTasks';

describe('settings index', () => {
  it('gives every group at least one entry', () => {
    // A group whose row list is empty is a destination that opens onto
    // nothing — the failure mode when a group is added and never filled in.
    for (const group of SETTINGS_GROUPS) {
      const entries = SETTINGS_ENTRIES.filter(e => e.groupId === group.id);
      expect(entries.length).toBeGreaterThan(0);
    }
  });

  it('has unique entry ids', () => {
    const ids = SETTINGS_ENTRIES.map(e => e.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('has unique group ids', () => {
    const ids = SETTINGS_GROUPS.map(g => g.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('points every entry at a real group', () => {
    for (const entry of SETTINGS_ENTRIES) {
      expect(settingsGroup(entry.groupId)).toBeDefined();
    }
  });

  it('gives every entry a non-empty label and section', () => {
    for (const entry of SETTINGS_ENTRIES) {
      expect(entry.label.trim()).not.toBe('');
      expect(entry.section.trim()).not.toBe('');
    }
  });

  it('never lists a keyword already in its own label', () => {
    // A keyword the label already contains adds nothing and quietly rots when
    // the label is reworded.
    for (const entry of SETTINGS_ENTRIES) {
      for (const keyword of entry.keywords ?? []) {
        expect(entry.label.toLowerCase()).not.toContain(keyword.toLowerCase());
      }
    }
  });

  describe('AI features', () => {
    // PrivacyAiSettings renders this section by mapping over aiFeaturesFor(),
    // so its rows *are* AI_FEATURES. Two of them (substitutes, receiptImport)
    // once had no entry here at all and a third named a label the row had
    // stopped rendering, all three invisible to every structural check above —
    // they need the two lists compared, not each one checked on its own.
    const aiEntries = SETTINGS_ENTRIES.filter(e => e.section === 'AI features');

    it('indexes every feature that gets a row, and nothing else', () => {
      expect(aiEntries.map(e => e.label)).toEqual(AI_FEATURES.map(f => f.label));
    });

    it('files every one of them under Privacy & AI', () => {
      for (const entry of aiEntries) expect(entry.groupId).toBe('privacyAi');
    });

    it('hides a kitchen feature\'s entry exactly when its row goes', () => {
      // aiFeaturesFor drops the kitchen features when the area is off; an
      // entry that disagreed would be a search result opening onto nothing.
      for (const feature of AI_FEATURES) {
        const entry = aiEntries.find(e => e.label === feature.label);
        expect(entry?.kitchen ?? false).toBe(feature.kitchen ?? false);
      }
    });

    it('gives every one of them keywords, since the label is only half a name', () => {
      // "Recipe import" and "Meal ideas" are what the rows say; "paste",
      // "photo" and "dinner" are what someone types looking for them.
      for (const entry of aiEntries) expect(entry.keywords?.length ?? 0).toBeGreaterThan(0);
    });
  });

  describe('generated tasks', () => {
    // GeneratedTasksSection renders its rows by mapping over
    // listedGeneratedKinds(), so its rows *are* the registry — the same
    // arrangement the AI features are in, and so the same failure is available:
    // a generator added to GENERATED_KINDS grows a row on its own and only the
    // index has to be remembered separately. Comparing the two lists is what
    // makes that unrepresentable.
    const toggleEntries = SETTINGS_ENTRIES.filter(e => e.id.startsWith('gen:') && !e.id.endsWith(':category'));

    it('indexes every generator that gets a row, in order, and nothing else', () => {
      expect(toggleEntries.map(e => e.label)).toEqual(GENERATED_KIND_LIST.map(s => s.label));
    });

    it('files every generated row under the group of its own', () => {
      const all = SETTINGS_ENTRIES.filter(e => e.id.startsWith('gen:'));
      for (const entry of all) expect(entry.groupId).toBe('generated');
    });

    it('marks an entry kitchen exactly when its generator is', () => {
      // The bug this replaces: the section sat inside Tasks & projects'
      // kitchenEnabled block, so switching the area off hid all twelve rows
      // while six of the generators behind them carried on writing tasks.
      for (const spec of GENERATED_KIND_LIST) {
        const entry = toggleEntries.find(e => e.label === spec.label);
        expect(entry?.kitchen ?? false).toBe(spec.kitchen);
      }
    });

    it('keeps the non-kitchen generators findable with the area off', () => {
      const off = visibleSettingsEntries('ios', false);
      const survivors = GENERATED_KIND_LIST.filter(s => !s.kitchen);
      // Not a vacuous check — there really are some, and they are the ones
      // whose passes never gated on the kitchen in the first place.
      expect(survivors.length).toBeGreaterThan(0);
      for (const spec of survivors) {
        expect(off.some(e => e.id === `gen:${spec.kind}`)).toBe(true);
      }
    });

    it('gives a "File them under" row only to a generator that has one', () => {
      // Nine rows share that label, so the entry is worthless without its
      // section naming which generator it belongs to.
      for (const spec of GENERATED_KIND_LIST) {
        const entry = SETTINGS_ENTRIES.find(e => e.id === `gen:${spec.kind}:category`);
        expect(entry !== undefined).toBe(spec.categorized);
        if (entry) expect(entry.section).toBe(spec.label);
      }
    });

    it('counts only the generators it would list', () => {
      const allOn = Object.fromEntries(
        GENERATED_KIND_LIST.map(s => [s.enabledKey, true])
      ) as Record<GeneratedEnabledKey, boolean>;
      expect(generatedTaskCounts(allOn, true).total).toBe(GENERATED_KIND_LIST.length);
      expect(generatedTaskCounts(allOn, true).on).toBe(GENERATED_KIND_LIST.length);
      // With the area off the total shrinks to match the rows on screen, so the
      // summary can't read "4 of 12" over a list of six.
      const withoutKitchen = GENERATED_KIND_LIST.filter(s => !s.kitchen).length;
      expect(generatedTaskCounts(allOn, false).total).toBe(withoutKitchen);
      expect(generatedTaskCounts(allOn, false).on).toBe(withoutKitchen);
    });
  });

  describe('platform gating', () => {
    it('drops every iOS-only group off iOS', () => {
      const android = visibleSettingsGroups('android');
      const iosOnly = SETTINGS_GROUPS.filter(g => g.iosOnly);
      // Asserted against the flag rather than a literal list, so a third
      // iOS-only group is covered by being marked rather than by being
      // remembered here.
      expect(iosOnly.length).toBeGreaterThan(1);
      for (const group of iosOnly) {
        expect(android.find(g => g.id === group.id)).toBeUndefined();
      }
      expect(android.length).toBe(SETTINGS_GROUPS.length - iosOnly.length);
    });

    it('keeps every group on iOS', () => {
      expect(visibleSettingsGroups('ios')).toHaveLength(SETTINGS_GROUPS.length);
    });

    it('takes the hidden groups’ entries with them', () => {
      const android = visibleSettingsEntries('android');
      for (const group of SETTINGS_GROUPS.filter(g => g.iosOnly)) {
        expect(android.some(e => e.groupId === group.id)).toBe(false);
      }
      expect(visibleSettingsEntries('ios')).toHaveLength(SETTINGS_ENTRIES.length);
    });
  });

  describe('kitchen gating', () => {
    it('drops every kitchen row when the area is off', () => {
      const off = visibleSettingsEntries('ios', false);
      expect(off.some(e => e.kitchen)).toBe(false);
      // Not a no-op test: the rows it removes are spread over four groups, so
      // a gate wired into only one of them would still pass a spot check.
      const dropped = SETTINGS_ENTRIES.filter(e => e.kitchen);
      expect(new Set(dropped.map(e => e.groupId)).size).toBeGreaterThan(1);
      // The kitchenOnly group takes its own rows too, and those carry no
      // `kitchen` flag of their own — the group gate is their only gate, which
      // is the arrangement the flag's doc comment describes.
      const inKitchenGroup = SETTINGS_ENTRIES.filter(e => e.groupId === 'kitchen' && !e.kitchen);
      expect(inKitchenGroup.length).toBeGreaterThan(0);
      expect(off).toHaveLength(
        SETTINGS_ENTRIES.length - dropped.length - inKitchenGroup.length);
    });

    it('keeps them all when it is on, and by default', () => {
      expect(visibleSettingsEntries('ios', true)).toHaveLength(SETTINGS_ENTRIES.length);
      expect(visibleSettingsEntries('ios')).toHaveLength(SETTINGS_ENTRIES.length);
    });

    it('keeps the master switch itself, which is the way back', () => {
      const off = visibleSettingsEntries('ios', false);
      expect(off.find(e => e.id === 'kitchenEnabled')).toBeDefined();
    });

    it('leaves no kitchen row stranded in a group it emptied', () => {
      // A group left with no visible rows is a destination that opens onto
      // nothing — the same failure the whole-index check above guards against,
      // but reachable here by turning the area off rather than by editing.
      const off = visibleSettingsEntries('ios', false);
      // Against the groups actually on offer with the area off — a group the
      // switch removes outright is not a group left empty, it's gone.
      for (const group of visibleSettingsGroups('ios', false)) {
        expect(off.filter(e => e.groupId === group.id).length).toBeGreaterThan(0);
      }
    });
  });

  describe('simplified-mode gating', () => {
    it('drops every flagged row when the mode is on', () => {
      const on = visibleSettingsEntries('ios', true, true);
      expect(on.some(e => e.simple)).toBe(false);
      // Same reasoning as the kitchen check above: the rows it removes are
      // spread over more than one group, so a gate wired into only one of them
      // would still pass a spot check.
      const dropped = SETTINGS_ENTRIES.filter(e => e.simple);
      expect(dropped.length).toBeGreaterThan(0);
      expect(new Set(dropped.map(e => e.groupId)).size).toBeGreaterThan(1);
      expect(on).toHaveLength(SETTINGS_ENTRIES.length - dropped.length);
    });

    it('keeps them all while the mode is off, and by default', () => {
      expect(visibleSettingsEntries('ios', true, false)).toHaveLength(SETTINGS_ENTRIES.length);
      expect(visibleSettingsEntries('ios', true)).toHaveLength(SETTINGS_ENTRIES.length);
    });

    it('keeps the master switch itself, which is the way back', () => {
      const on = visibleSettingsEntries('ios', true, true);
      expect(on.find(e => e.id === 'simpleMode')).toBeDefined();
    });

    it('composes with the kitchen gate rather than overriding it', () => {
      const both = visibleSettingsEntries('ios', false, true);
      expect(both.some(e => e.kitchen)).toBe(false);
      expect(both.some(e => e.simple)).toBe(false);
      expect(both.find(e => e.id === 'kitchenEnabled')).toBeDefined();
      expect(both.find(e => e.id === 'simpleMode')).toBeDefined();
    });

    // The bug this guards: Focus sessions is rendered behind a single
    // `!simpleMode` gate in TasksProjectsSettings, so the whole section leaves
    // together — but three of its ten rows had no flag, and searching
    // "distraction" or "social media" in simplified mode returned rows that
    // don't render. Section-wide rather than row-by-row because that is how the
    // screen gates it, and the next row added to the section inherits the check.
    it('flags every row in a section simplified mode hides wholesale', () => {
      const focus = SETTINGS_ENTRIES.filter(
        e => e.groupId === 'tasksProjects' && e.section === 'Focus sessions');
      expect(focus.length).toBeGreaterThan(1);
      expect(focus.filter(e => !e.simple)).toEqual([]);
    });

    it('leaves no group emptied by either switch', () => {
      const on = visibleSettingsEntries('ios', false, true);
      for (const group of visibleSettingsGroups('ios', false)) {
        expect(on.filter(e => e.groupId === group.id).length).toBeGreaterThan(0);
      }
    });
  });
});
