import React, { useCallback, useState } from 'react';
import { ActionMenu, type ActionMenuAction } from '../components/ActionMenu';
import type { CardAnchor } from '../components/CardSheet';

export interface ActionMenuSpec {
  title: string;
  message?: string;
  actions: ActionMenuAction[];
  anchor?: CardAnchor | null;
}

/**
 * The in-app replacement for `Alert.alert(title, message, [buttons])` where the
 * buttons are a list of choices. `open(spec)` shows the menu; render `element`
 * once, **inside the sheet's own children when the caller is a sheet** (a
 * sibling Modal would be refused by iOS, see "Two sibling Modals" in
 * CLAUDE.md). The menu mounts on first use and stays, so a list row can call
 * this without every row holding a Modal.
 */
export function useActionMenu() {
  const [spec, setSpec] = useState<ActionMenuSpec | null>(null);
  const [used, setUsed] = useState(false);
  const open = useCallback((next: ActionMenuSpec) => {
    setUsed(true);
    setSpec(next);
  }, []);
  const element = used ? (
    <ActionMenu
      visible={spec !== null}
      title={spec?.title ?? ''}
      message={spec?.message}
      actions={spec?.actions ?? []}
      anchor={spec?.anchor}
      onClose={() => setSpec(null)}
    />
  ) : null;
  return { open, element };
}
