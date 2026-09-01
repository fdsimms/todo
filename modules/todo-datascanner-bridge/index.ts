import { requireNativeModule, requireNativeViewManager } from 'expo-modules-core';
import { Platform } from 'react-native';
import type { ComponentType } from 'react';
import type { ViewProps } from 'react-native';

/** One text run in frame when a barcode was recognised. Normalised 0..1, origin top left. */
export interface ScannedText {
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

/** A barcode the scanner has just picked up, with the text that was in frame with it. */
export interface DataScannerScan {
  /** The code's payload, exactly as read. Normalised and check-digit tested in JS. */
  value: string;
  x: number;
  y: number;
  width: number;
  height: number;
  texts: ScannedText[];
}

export interface DataScannerViewProps extends ViewProps {
  onScan?: (event: { nativeEvent: DataScannerScan }) => void;
}

interface TodoDataScannerNativeModule {
  isAvailable(): boolean;
}

// Same lazy resolve the other two bridges use — requireNativeModule throws
// outright when the module isn't linked, so resolving once here lets the
// exports below degrade to "unavailable" instead of throwing at a call site
// that has no branch for it.
let nativeModule: TodoDataScannerNativeModule | null = null;
if (Platform.OS === 'ios') {
  try {
    nativeModule = requireNativeModule<TodoDataScannerNativeModule>('TodoDataScanner');
  } catch {
    nativeModule = null;
  }
}

/**
 * Whether this device can read a barcode and its shelf price in one pass.
 *
 * False on everything but an iOS 16+ device with the hardware for it, which is
 * why `BarcodeScanSheet` keeps its expo-camera view rather than replacing it:
 * this is an upgrade to scanning where it exists, not a new requirement for it.
 */
export function isDataScannerAvailable(): boolean {
  if (!nativeModule) return false;
  try {
    return nativeModule.isAvailable() === true;
  } catch (error) {
    console.warn('[todo-datascanner-bridge] isAvailable failed; treating the scanner as unavailable', error);
    return false;
  }
}

/**
 * The live scanner view. Only mount it behind `isDataScannerAvailable()` —
 * resolving the native view throws where the module isn't linked, and unlike a
 * function call there is no return value to degrade into.
 */
export function getDataScannerView(): ComponentType<DataScannerViewProps> | null {
  if (!nativeModule) return null;
  try {
    return requireNativeViewManager<DataScannerViewProps>('TodoDataScanner');
  } catch (error) {
    console.warn('[todo-datascanner-bridge] view is not registered; falling back', error);
    return null;
  }
}
