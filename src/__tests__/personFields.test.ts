import { blankPerson } from '../store/usePersonStore';
import {
  filledPersonFields, addablePersonFields, personFieldValue, personFieldPatch, describeBirthday,
} from '../utils/personFields';

jest.mock('../db/database', () => ({}));

describe('personFields', () => {
  it('lists only the name for a person with nothing filled in', () => {
    const p = blankPerson('therapist', 1);
    expect(filledPersonFields(p).map(f => f.key)).toEqual(['name']);
    expect(addablePersonFields(p).map(f => f.key))
      .toEqual(['nickname', 'phoneNumber', 'email', 'address', 'birthday']);
  });

  it('moves a field from the add menu to the card once it has a value', () => {
    const p = { ...blankPerson('Tess', 1), phoneNumber: '(718) 555-0142', address: '  ' };
    expect(filledPersonFields(p).map(f => f.key)).toEqual(['name', 'phoneNumber']);
    expect(addablePersonFields(p).map(f => f.key)).toContain('address');
    expect(addablePersonFields(p).map(f => f.key)).not.toContain('phoneNumber');
  });

  it('does not offer a birthday to a business, but still lists one already set', () => {
    const biz = { ...blankPerson('Spring Health', 1), kind: 'business' as const };
    expect(addablePersonFields(biz).map(f => f.key)).not.toContain('birthday');
    const set = { ...biz, birthdayMonth: 3, birthdayDay: 14 };
    expect(filledPersonFields(set).map(f => f.key)).toContain('birthday');
  });

  it('reads a birthday back with the year only when one is on file', () => {
    expect(describeBirthday(null, 14, null)).toBeUndefined();
    expect(describeBirthday(3, 14, null)).toMatch(/14/);
    expect(describeBirthday(3, 14, null)).not.toMatch(/1992/);
    expect(describeBirthday(3, 14, 1992)).toMatch(/1992/);
    const p = { ...blankPerson('Tess', 1), birthdayMonth: 3, birthdayDay: 14 };
    expect(personFieldValue(p, 'birthday')).toBe(describeBirthday(3, 14, null));
  });

  it('clears an optional field when saved empty, and trims what it keeps', () => {
    expect(personFieldPatch('email', '  ')).toEqual({ email: null });
    expect(personFieldPatch('address', ' 214 Union St ')).toEqual({ address: '214 Union St' });
    expect(personFieldPatch('nickname', '')).toEqual({ nickname: '' });
    expect(personFieldPatch('name', ' Tess ')).toEqual({ name: 'Tess' });
  });

  it('formats a phone the way the person sheet does', () => {
    expect(personFieldPatch('phoneNumber', '7185550142')).toEqual({ phoneNumber: '(718) 555-0142' });
    expect(personFieldPatch('phoneNumber', '')).toEqual({ phoneNumber: null });
  });
});
