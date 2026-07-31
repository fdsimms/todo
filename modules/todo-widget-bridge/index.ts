import { requireNativeModule } from 'expo-modules-core';

interface TodoWidgetBridgeNativeModule {
  writeSnapshot(jsonString: string): void;
}

const TodoWidgetBridge = requireNativeModule<TodoWidgetBridgeNativeModule>('TodoWidgetBridge');

export function writeWidgetSnapshot(jsonString: string): void {
  TodoWidgetBridge.writeSnapshot(jsonString);
}
