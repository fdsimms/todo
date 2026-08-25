import type { ExistingContact } from 'expo-contacts/legacy';

let mockPlatform = 'ios';
jest.mock('react-native', () => ({
  Platform: { get OS() { return mockPlatform; } },
}));

let mockDemoActive = false;
jest.mock('../utils/demoState', () => ({
  isDemoModeActive: () => mockDemoActive,
}));

const mockGetPermissions = jest.fn();
const mockRequestPermissions = jest.fn();
const mockGetContacts = jest.fn();
jest.mock('expo-contacts/legacy', () => ({
  getPermissionsAsync: (...a: unknown[]) => mockGetPermissions(...a),
  requestPermissionsAsync: (...a: unknown[]) => mockRequestPermissions(...a),
  getContactsAsync: (...a: unknown[]) => mockGetContacts(...a),
  Fields: { Name: 'name', PhoneNumbers: 'phoneNumbers', Emails: 'emails', Birthday: 'birthday' },
}), { virtual: true });

import {
  getContactsPermission,
  requestContactsPermission,
  searchContacts,
  toCandidate,
} from '../utils/contactsAccess';

function contact(over: Partial<ExistingContact> = {}): ExistingContact {
  return {
    id: 'c1',
    name: 'Dustin Reyes',
    contactType: 'person',
    ...over,
  } as ExistingContact;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockPlatform = 'ios';
  mockDemoActive = false;
  mockGetPermissions.mockResolvedValue({ granted: true, status: 'granted', canAskAgain: true });
  mockGetContacts.mockResolvedValue({ data: [] });
});

describe('getContactsPermission', () => {
  it('reports granted', async () => {
    await expect(getContactsPermission()).resolves.toBe('granted');
  });

  it('reports undetermined while it can still ask', async () => {
    mockGetPermissions.mockResolvedValue({ granted: false, status: 'denied', canAskAgain: true });
    await expect(getContactsPermission()).resolves.toBe('undetermined');
  });

  it('reports denied once it cannot', async () => {
    mockGetPermissions.mockResolvedValue({ granted: false, status: 'denied', canAskAgain: false });
    await expect(getContactsPermission()).resolves.toBe('denied');
  });

  it('reports unsupported off iOS, without asking the module', async () => {
    mockPlatform = 'android';
    await expect(getContactsPermission()).resolves.toBe('unsupported');
    expect(mockGetPermissions).not.toHaveBeenCalled();
  });

  it('reports unsupported rather than throwing when the module is missing', async () => {
    mockGetPermissions.mockRejectedValue(new Error('no native module'));
    await expect(getContactsPermission()).resolves.toBe('unsupported');
  });
});

describe('requestContactsPermission', () => {
  it('does not re-ask when it already has access', async () => {
    await expect(requestContactsPermission()).resolves.toBe(true);
    expect(mockRequestPermissions).not.toHaveBeenCalled();
  });

  it('asks when it does not', async () => {
    mockGetPermissions.mockResolvedValue({ granted: false, status: 'undetermined', canAskAgain: true });
    mockRequestPermissions.mockResolvedValue({ granted: true });
    await expect(requestContactsPermission()).resolves.toBe(true);
    expect(mockRequestPermissions).toHaveBeenCalled();
  });

  it('is false rather than throwing when the ask fails', async () => {
    mockGetPermissions.mockResolvedValue({ granted: false, status: 'undetermined', canAskAgain: true });
    mockRequestPermissions.mockRejectedValue(new Error('nope'));
    await expect(requestContactsPermission()).resolves.toBe(false);
  });
});

describe('searchContacts', () => {
  // A picker offering the real address book inside a demo would put real names
  // on a screen handed to somebody else.
  it('reads nothing in demo mode', async () => {
    mockDemoActive = true;
    await expect(searchContacts('dustin')).resolves.toEqual([]);
    expect(mockGetContacts).not.toHaveBeenCalled();
    expect(mockGetPermissions).not.toHaveBeenCalled();
  });

  // The rule made structural: an unqueried picker doesn't merely hide the book,
  // it never reads it.
  it('reads nothing for a query too short to search', async () => {
    await expect(searchContacts('d')).resolves.toEqual([]);
    await expect(searchContacts('   ')).resolves.toEqual([]);
    expect(mockGetContacts).not.toHaveBeenCalled();
  });

  it('reads nothing without permission', async () => {
    mockGetPermissions.mockResolvedValue({ granted: false, status: 'denied', canAskAgain: false });
    await expect(searchContacts('dustin')).resolves.toEqual([]);
    expect(mockGetContacts).not.toHaveBeenCalled();
  });

  it('passes the name to the native query rather than filtering afterwards', async () => {
    await searchContacts('  dustin  ');
    expect(mockGetContacts).toHaveBeenCalledWith(expect.objectContaining({ name: 'dustin' }));
  });

  it('asks for a bounded page, so a slack query cannot pull a book into memory', async () => {
    await searchContacts('dustin');
    const options = mockGetContacts.mock.calls[0][0] as { pageSize: number };
    expect(options.pageSize).toBeGreaterThan(0);
    expect(options.pageSize).toBeLessThanOrEqual(100);
  });

  it('flattens what comes back', async () => {
    mockGetContacts.mockResolvedValue({
      data: [contact({
        phoneNumbers: [{ number: '555 0148' }],
        emails: [{ email: 'd@example.com' }],
        birthday: { month: 2, day: 14 },
      } as Partial<ExistingContact>)],
    });
    await expect(searchContacts('dustin')).resolves.toEqual([{
      id: 'c1',
      name: 'Dustin Reyes',
      phoneNumber: '555 0148',
      email: 'd@example.com',
      birthdayMonth: 3,
      birthdayDay: 14,
    }]);
  });

  it('is empty rather than throwing when the read fails', async () => {
    mockGetContacts.mockRejectedValue(new Error('boom'));
    await expect(searchContacts('dustin')).resolves.toEqual([]);
  });

  it('reads nothing off iOS', async () => {
    mockPlatform = 'android';
    await expect(searchContacts('dustin')).resolves.toEqual([]);
  });
});

describe('toCandidate', () => {
  it('takes the first number and email it finds', () => {
    const c = toCandidate(contact({
      phoneNumbers: [{ number: undefined }, { number: '555 0148' }],
      emails: [{ email: 'd@example.com' }],
    } as Partial<ExistingContact>))!;
    expect(c.phoneNumber).toBe('555 0148');
    expect(c.email).toBe('d@example.com');
  });

  it('is null for a contact with no name, or no id', () => {
    expect(toCandidate(contact({ name: '  ' }))).toBeNull();
    expect(toCandidate(contact({ id: '' }))).toBeNull();
  });

  it('leaves the number and email null when there are none', () => {
    const c = toCandidate(contact())!;
    expect(c.phoneNumber).toBeNull();
    expect(c.email).toBeNull();
  });
});
