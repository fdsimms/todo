/**
 * Whether the app is running on a Mac, for the code that has to know and can't
 * ask the native side itself.
 *
 * `runningOnMac()` asks the device, which means importing a native module, and
 * the settings store (which decides whether a Mac starts with iPhone Mirroring
 * mode on) is also loaded by the MCP server in plain Node, where no native module
 * exists. So the store reads this flag instead, and the app sets it once at
 * launch, before any store initializes. Anywhere else it is false.
 */
let onMac = false;

export function setDeviceIsMac(value: boolean): void {
  onMac = value;
}

export function deviceIsMac(): boolean {
  return onMac;
}
