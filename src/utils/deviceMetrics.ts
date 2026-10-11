/**
 * The one door to the MetricKit bridge, resolved lazily like the Vision bridge
 * is (`receiptOcr.ts`), so importing this loads nothing native until a call is
 * made and a test never reaches the module. Reading is all it does: the
 * reports come from iOS, nothing is sent anywhere, so there is no switch to
 * gate it behind. Saving what it returns is `perfReport.ts`.
 */
function bridge(): typeof import('todo-metrickit-bridge') {
  return require('todo-metrickit-bridge');
}

/** Starts listening for the daily reports. Safe to call more than once. */
export function startDeviceMetrics(): void {
  bridge().startMetricKit();
}

/** The raw report JSON iOS has delivered, or none where MetricKit isn't linked. */
export function readDevicePayloads(): string[] {
  return bridge().readMetricPayloads();
}
