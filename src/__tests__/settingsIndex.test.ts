import {
  SETTINGS_GROUPS,
  SETTINGS_ENTRIES,
  settingsGroup,
  visibleSettingsGroups,
  visibleSettingsEntries,
} from '../utils/settingsIndex';
import { AI_FEATURES } from '../utils/aiFeatures';

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

  describe('platform gating', () => {
    it('drops the iOS-only group off iOS', () => {
      const android = visibleSettingsGroups('android');
      expect(android.find(g => g.id === 'capture')).toBeUndefined();
      expect(android.length).toBe(SETTINGS_GROUPS.length - 1);
    });

    it('keeps every group on iOS', () => {
      expect(visibleSettingsGroups('ios')).toHaveLength(SETTINGS_GROUPS.length);
    });

    it('takes the hidden group’s entries with it', () => {
      const android = visibleSettingsEntries('android');
      expect(android.some(e => e.groupId === 'capture')).toBe(false);
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
      expect(off).toHaveLength(SETTINGS_ENTRIES.length - dropped.length);
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
      for (const group of visibleSettingsGroups('ios')) {
        expect(off.filter(e => e.groupId === group.id).length).toBeGreaterThan(0);
      }
    });
  });
});
