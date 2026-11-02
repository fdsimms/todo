/**
 * What the food log's one camera can be pointed at.
 *
 * Package covers both things printed on a packet: a barcode (read live, no
 * tap) and the nutrition label (photographed). Meal is a photo of a plate,
 * sent for an estimate. They are two modes rather than one because they cost
 * differently: a label is read on the device for free and a meal is a billed
 * request, so the person picks which one a photo is and nothing guesses.
 */
export type CaptureMode = 'package' | 'meal';

/**
 * The modes a caller can honor, in the order the switch shows them. A caller
 * with nowhere to send a barcode or a label (`package`) or no estimate route
 * (`meal`) leaves that mode out, and a single mode needs no switch.
 */
export function captureModes(offered: { package: boolean; meal: boolean }): CaptureMode[] {
  const modes: CaptureMode[] = [];
  if (offered.package) modes.push('package');
  if (offered.meal) modes.push('meal');
  return modes;
}

/** The line over the viewfinder, saying what the camera is looking for. */
export function captureHint(mode: CaptureMode): string {
  return mode === 'package'
    ? 'Scan a barcode or photograph a label'
    : 'Photograph your meal to estimate it';
}

/** The switch's labels. */
export const CAPTURE_MODE_LABEL: Record<CaptureMode, string> = {
  package: 'Package',
  meal: 'Meal',
};

/**
 * Whether a mode is one the camera can still be in once the set of offered
 * modes changes under it (a feature switched off while the sheet is open).
 */
export function resolveCaptureMode(current: CaptureMode, modes: readonly CaptureMode[]): CaptureMode {
  return modes.includes(current) ? current : modes[0] ?? 'package';
}
