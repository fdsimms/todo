import { kindFields, kindSwitchFields, LIST_KIND_FIELDS, projectKindFields } from '../utils/projectKind';

describe('kindFields', () => {
  it('gives a list no finish line and no nudges', () => {
    expect(kindFields('list', 14)).toEqual({ ongoing: true, nudgeOptIn: false, nudgeCadenceDays: 0 });
  });

  it('gives a project the Settings default for nudges', () => {
    expect(kindFields('project', 0)).toEqual({ ongoing: false, nudgeOptIn: true, nudgeCadenceDays: 0 });
    expect(kindFields('project', 14)).toEqual({ ongoing: false, nudgeOptIn: true, nudgeCadenceDays: 14 });
  });
});

describe('kindSwitchFields', () => {
  it('is empty when the kind is not changing', () => {
    expect(kindSwitchFields('list', { title: 'x' }, 0)).toEqual({});
    expect(kindSwitchFields('list', { kind: 'list' }, 0)).toEqual({});
  });

  it('brings the new kind\'s defaults', () => {
    expect(kindSwitchFields('project', { kind: 'list' }, 0)).toEqual(LIST_KIND_FIELDS);
    expect(kindSwitchFields('list', { kind: 'project' }, 7)).toEqual(projectKindFields(7));
  });

  it('defers to a field the patch names itself', () => {
    expect(kindSwitchFields('project', { kind: 'list', ongoing: false }, 0))
      .toEqual({ nudgeOptIn: false, nudgeCadenceDays: 0 });
  });
});
