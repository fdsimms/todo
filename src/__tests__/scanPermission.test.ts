import { scanPermissionMessage } from '../utils/scanPermission';

describe('scanPermissionMessage', () => {
  it('points at Settings once the prompt cannot be shown again', () => {
    expect(scanPermissionMessage(false, true)).toBe('Camera access is off. Turn it on in Settings to scan barcodes.');
    // The lookup switch is irrelevant while the camera itself is off.
    expect(scanPermissionMessage(false, false)).toBe(scanPermissionMessage(false, true));
  });

  it('says the barcode number goes online while lookups are on', () => {
    const message = scanPermissionMessage(true, true);
    expect(message).toContain('looked up online');
    expect(message).not.toContain('Everything it reads stays on this device');
  });

  it('claims nothing leaves the device only while lookups are off', () => {
    expect(scanPermissionMessage(true, false)).toBe('Scanning needs the camera. Everything it reads stays on this device.');
  });
});
