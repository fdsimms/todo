import React, { useState } from 'react';
import { CookwarePicker, type CookwarePickerProps } from './CookwarePicker';
import { CookwareSheet } from './CookwareSheet';

/**
 * `CookwarePicker` plus the sheet its "Add cookware" / "Edit cookware" row opens.
 * Every host inside the navigation container uses this one. The pieces are
 * split because `CookwareSheet` is an `EditorSheet`, which needs a navigation
 * object: a host rendered outside the container (`LogMealPrompt`) uses the
 * picker alone, without the manage row.
 */
export function CookwareWeighIn(props: Omit<CookwarePickerProps, 'onManage'>) {
  const [sheetOpen, setSheetOpen] = useState(false);
  return (
    <>
      <CookwarePicker {...props} onManage={() => setSheetOpen(true)} />
      <CookwareSheet visible={sheetOpen} onClose={() => setSheetOpen(false)} />
    </>
  );
}
