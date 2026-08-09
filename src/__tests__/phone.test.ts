import { isDialable, looksLikePhoneNumber, phoneDigits, smsUrl, telUrl } from '../utils/phone';

describe('telUrl', () => {
  it('strips presentation characters', () => {
    expect(telUrl('(555) 123-4567')).toBe('tel:5551234567');
    expect(telUrl('555.123.4567')).toBe('tel:5551234567');
    expect(telUrl('020 7946 0018')).toBe('tel:02079460018');
  });

  it('keeps a leading + for international numbers', () => {
    expect(telUrl('+44 20 7946 0018')).toBe('tel:+442079460018');
    expect(telUrl('  +1 555 123 4567 ')).toBe('tel:+15551234567');
  });

  it('drops a + that is not leading — it is a typo, not a country code', () => {
    expect(telUrl('555+1234567')).toBe('tel:5551234567');
  });

  it('keeps pause and DTMF characters, so extensions survive', () => {
    expect(telUrl('555-123-4567,,890')).toBe('tel:5551234567,,890');
    expect(telUrl('+1 555 123 4567;123#')).toBe('tel:+15551234567;123#');
  });

  it('returns null when there is nothing to dial', () => {
    expect(telUrl(null)).toBeNull();
    expect(telUrl(undefined)).toBeNull();
    expect(telUrl('')).toBeNull();
    expect(telUrl('   ')).toBeNull();
    expect(telUrl('+')).toBeNull();
    expect(telUrl('call me')).toBeNull();
  });
});

describe('smsUrl', () => {
  it('strips presentation characters', () => {
    expect(smsUrl('(555) 123-4567')).toBe('sms:5551234567');
    expect(smsUrl('555.123.4567')).toBe('sms:5551234567');
    expect(smsUrl('020 7946 0018')).toBe('sms:02079460018');
  });

  it('keeps a leading + for international numbers', () => {
    expect(smsUrl('+44 20 7946 0018')).toBe('sms:+442079460018');
    expect(smsUrl('  +1 555 123 4567 ')).toBe('sms:+15551234567');
  });

  it('drops a + that is not leading — it is a typo, not a country code', () => {
    expect(smsUrl('555+1234567')).toBe('sms:5551234567');
  });

  it('returns null when there is nothing to text', () => {
    expect(smsUrl(null)).toBeNull();
    expect(smsUrl(undefined)).toBeNull();
    expect(smsUrl('')).toBeNull();
    expect(smsUrl('   ')).toBeNull();
    expect(smsUrl('+')).toBeNull();
    expect(smsUrl('call me')).toBeNull();
  });
});

describe('isDialable', () => {
  it('follows telUrl', () => {
    expect(isDialable('555-1234')).toBe(true);
    expect(isDialable('')).toBe(false);
    expect(isDialable(null)).toBe(false);
  });
});

describe('phoneDigits', () => {
  it('counts only digits', () => {
    expect(phoneDigits('+1 (555) 123-4567')).toBe('15551234567');
    expect(phoneDigits('no digits here')).toBe('');
  });
});

describe('looksLikePhoneNumber', () => {
  it('accepts the shapes people actually write', () => {
    expect(looksLikePhoneNumber('555-123-4567')).toBe(true);
    expect(looksLikePhoneNumber('(555) 123 4567')).toBe(true);
    expect(looksLikePhoneNumber('5551234567')).toBe(true);
    expect(looksLikePhoneNumber('+44 20 7946 0018')).toBe(true);
    expect(looksLikePhoneNumber('+15551234567')).toBe(true);
    expect(looksLikePhoneNumber('+44 7700 900123')).toBe(true);
  });

  it('rejects quantities, years and prices', () => {
    expect(looksLikePhoneNumber('2026')).toBe(false);
    expect(looksLikePhoneNumber('1500')).toBe(false);
    expect(looksLikePhoneNumber('10000')).toBe(false);
    expect(looksLikePhoneNumber('12.50')).toBe(false);
    // Seven digits and a separator, and not a phone number — which is why the
    // local-number shape doesn't qualify without a country code.
    expect(looksLikePhoneNumber('1000-2000')).toBe(false);
  });

  it('rejects a long run of small groups — that is a list, not a number', () => {
    expect(looksLikePhoneNumber('10 15 20 25 30 35')).toBe(false);
  });

  it('rejects a seven-digit local number — too easy to confuse with a range', () => {
    expect(looksLikePhoneNumber('5551234')).toBe(false);
    expect(looksLikePhoneNumber('555-1234')).toBe(false);
  });

  it('rejects anything carrying letters', () => {
    expect(looksLikePhoneNumber('call 555-123-4567')).toBe(false);
    expect(looksLikePhoneNumber('')).toBe(false);
  });
});
