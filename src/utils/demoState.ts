// Whether demo mode is currently active, split out from useDemoStore so a
// leaf module like notifications.ts can check it without an import cycle
// (useDemoStore -> useTaskStore -> notifications -> useDemoStore).
let active = false;

export function isDemoModeActive(): boolean {
  return active;
}

export function setDemoModeActive(value: boolean): void {
  active = value;
}
