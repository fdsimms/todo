import {
  anchorsForRun,
  linkedTaskCounts,
  linkedTasksNote,
  runTemplateLabel,
  templateLinkState,
} from '../utils/templateLink';
import type { TaskTemplate } from '../types';

const packing = { id: 'tpl1', name: 'Packing List' } as TaskTemplate;

describe('templateLinkState', () => {
  const base = { completed: false, archived: false };

  it('is none without a link', () => {
    expect(templateLinkState({ ...base, templateId: null }, [packing])).toEqual({ kind: 'none' });
    expect(templateLinkState({ ...base }, [packing])).toEqual({ kind: 'none' });
  });

  it('is ready when the template exists', () => {
    expect(templateLinkState({ ...base, templateId: 'tpl1' }, [packing])).toEqual({ kind: 'ready', template: packing });
  });

  it('is missing, not none, when the template was deleted', () => {
    expect(templateLinkState({ ...base, templateId: 'gone' }, [packing])).toEqual({ kind: 'missing' });
  });

  it('shows nothing on a finished or archived task', () => {
    expect(templateLinkState({ templateId: 'tpl1', completed: true, archived: false }, [packing])).toEqual({ kind: 'none' });
    expect(templateLinkState({ templateId: 'gone', completed: false, archived: true }, [])).toEqual({ kind: 'none' });
  });
});

describe('linkedTaskCounts', () => {
  const t = (templateId: string | null, over = {}) => ({ templateId, completed: false, archived: false, parentId: null, ...over });

  it('counts open tasks per template and ignores finished, archived and other templates', () => {
    const counts = linkedTaskCounts(
      [t('a'), t('a'), t('b'), t('a', { completed: true }), t('a', { archived: true }), t(null), t('c')],
      ['a', 'b'],
    );
    expect(counts.get('a')).toBe(2);
    expect(counts.get('b')).toBe(1);
    expect(counts.has('c')).toBe(false);
  });
});

describe('linkedTasksNote', () => {
  it('is empty for none', () => {
    expect(linkedTasksNote(0)).toBe('');
  });

  it('agrees with the count and carries no em dash', () => {
    expect(linkedTasksNote(1)).toContain('1 task runs this template from its row');
    expect(linkedTasksNote(3)).toContain('3 tasks run this template from their row');
    expect(linkedTasksNote(3, 2)).toContain('3 tasks run these templates from their row');
    expect(linkedTasksNote(3)).not.toMatch(/—/);
    expect(linkedTasksNote(3)).toContain('Template deleted');
  });
});

describe('runTemplateLabel', () => {
  it('names the template', () => {
    expect(runTemplateLabel(packing)).toBe('Run Packing List');
  });
});

describe('anchorsForRun', () => {
  it('has nothing without a project or an event date', () => {
    expect(anchorsForRun(null)).toBeUndefined();
    expect(anchorsForRun({ awayStart: null, eventDate: null })).toBeUndefined();
  });

  it('leaves a trip span to the sheet', () => {
    expect(anchorsForRun({ awayStart: '2026-12-11T17:00:00.000Z', eventDate: '2026-12-12T17:00:00.000Z' })).toBeUndefined();
  });

  it('starts and ends on the event day otherwise', () => {
    const a = anchorsForRun({ awayStart: null, eventDate: '2026-12-12T17:00:00.000Z' });
    expect(a?.start?.getTime()).toBe(new Date('2026-12-12T17:00:00.000Z').getTime());
    expect(a?.end).toBe(a?.start);
  });
});
