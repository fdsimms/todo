import { projectDateAnchor, projectDateShortcuts } from '../utils/projectDateShortcuts';

const today = new Date(2026, 5, 1, 9);

describe('projectDateAnchor', () => {
  it("prefers a trip's departure, then the deadline", () => {
    expect(projectDateAnchor({ awayStart: new Date(2026, 5, 20).toISOString(), deadline: new Date(2026, 5, 10).toISOString() }, today)?.label)
      .toBe('Before you leave');
    expect(projectDateAnchor({ awayStart: null, deadline: new Date(2026, 5, 10).toISOString() }, today)?.label)
      .toBe('Before the deadline');
  });

  it('is null for a project with no date, or one that has gone by', () => {
    expect(projectDateAnchor({ awayStart: null, deadline: null }, today)).toBeNull();
    expect(projectDateAnchor({ awayStart: null, deadline: new Date(2026, 4, 1).toISOString() }, today)).toBeNull();
  });
});

describe('projectDateShortcuts', () => {
  it('counts back from the date and leaves out anything already past', () => {
    const anchor = projectDateAnchor({ awayStart: null, deadline: new Date(2026, 5, 10, 12).toISOString() }, today)!;
    expect(projectDateShortcuts(anchor, today).map(s => s.label)).toEqual(['On the day', '1 day', '3 days', '1 week']);
    expect(projectDateShortcuts(anchor, today)[3].date.getDate()).toBe(3);
  });
});
