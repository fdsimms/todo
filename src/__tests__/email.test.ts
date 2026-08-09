import { isEmailable, mailtoUrl } from '../utils/email';

describe('mailtoUrl', () => {
  it('builds a mailto: URL from a plain address', () => {
    expect(mailtoUrl('name@example.com')).toBe('mailto:name@example.com');
  });

  it('trims surrounding whitespace', () => {
    expect(mailtoUrl('  name@example.com  ')).toBe('mailto:name@example.com');
  });

  it('percent-encodes characters mailto: needs escaped, but leaves @ alone', () => {
    expect(mailtoUrl('first last@example.com')).toBe('mailto:first%20last@example.com');
  });

  it('returns null when there is nothing to email', () => {
    expect(mailtoUrl(null)).toBeNull();
    expect(mailtoUrl(undefined)).toBeNull();
    expect(mailtoUrl('')).toBeNull();
    expect(mailtoUrl('   ')).toBeNull();
  });
});

describe('isEmailable', () => {
  it('follows mailtoUrl', () => {
    expect(isEmailable('name@example.com')).toBe(true);
    expect(isEmailable('')).toBe(false);
    expect(isEmailable(null)).toBe(false);
  });
});
