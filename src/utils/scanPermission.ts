/**
 * What a barcode scanner says in place of its viewfinder while the camera
 * isn't allowed. Two sheets show it (`BarcodeScanSheet`,
 * `NutritionBarcodeScanSheet`), so the wording lives here once.
 *
 * `canAskAgain` is expo-camera's: false once the system prompt has been
 * answered "Don't Allow", after which iOS never shows it again and
 * `requestPermission` does nothing. The only way forward is the Settings app,
 * so that state says so and the sheet offers a button there instead of an
 * "Allow camera" that cannot work.
 *
 * `lookupOnline` is `productLookupEnabled`. The picture never leaves the
 * device either way, but a scanned number goes to a product database while
 * lookups are on, so the privacy line says that rather than claiming
 * everything stays put.
 */
export function scanPermissionMessage(canAskAgain: boolean, lookupOnline: boolean): string {
  if (!canAskAgain) return 'Camera access is off. Turn it on in Settings to scan barcodes.';
  return lookupOnline
    ? 'Scanning needs the camera. The picture stays on this device, and the barcode number is looked up online.'
    : 'Scanning needs the camera. Everything it reads stays on this device.';
}
