import React from 'react';
import { useAskClaudeStore } from '../store/useAskClaudeStore';
import { AskClaudeSheet } from './AskClaudeSheet';
import { LazySheet } from './LazySheet';

/**
 * Ask Claude's sheet, mounted once at the app's root: Today's header and the
 * side menu both open it (`useAskClaudeStore.show`), and the conversation
 * survives closing it and opening it again from either. Mounted the first time
 * it opens and kept, so a closed chat costs nothing until it is used.
 */
export function AskClaudeHost() {
  const open = useAskClaudeStore(s => s.open);
  const hide = useAskClaudeStore(s => s.hide);
  return (
    <LazySheet open={open}>
      <AskClaudeSheet visible={open} onClose={hide} />
    </LazySheet>
  );
}
