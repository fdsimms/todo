import React, { useCallback, useLayoutEffect, useRef } from 'react';
import {
  StyleSheet,
  TextInput,
  codegenNativeCommands,
  type HostComponent,
  type NativeSyntheticEvent,
  type TextInputChangeEventData,
  type TextInputProps,
} from 'react-native';
import { fieldChanged, initialFieldSync, nextFieldSync, styleKeyOf, type FieldSync } from '../utils/textFieldSync';

/**
 * **Every text field that takes a `value` is this, never a bare `TextInput`.**
 * Same props, same ref (it is the `TextInput`'s own), so swapping one for the
 * other is the whole migration. `noControlledTextInput.test.ts` fails the
 * build on a `TextInput` given `value=`.
 *
 * What it changes is invisible until it matters: the native field is the only
 * thing that writes while someone types. A plain controlled `TextInput` echoes
 * every keystroke back into the field, and on iOS that echo replaces the text
 * mid-edit and can drop the caret somewhere else ("rutabaga" typed as
 * "utabagar"). Here React's copy of the text holds still, and `value` reaches
 * the field only when it differs from what the field last reported — sent as
 * one `setTextAndSelection` command, the same one RN's own controlled sync
 * uses, guarded by the same event count so a write that's already stale (the
 * person typed again first) is dropped rather than overwriting them.
 * `src/utils/textFieldSync.ts` has the rules and the full mechanism.
 *
 * `selection` works as it does on `TextInput`, and is applied the same way: by
 * the command, never by re-render. That matters because `TextInput` pushes its
 * `selection` alongside its own idea of the text, which here is deliberately
 * stale.
 */

type SetTextAndSelectionCommands = {
  setTextAndSelection: (
    viewRef: React.ElementRef<HostComponent<unknown>>,
    mostRecentEventCount: number,
    value: string | null,
    start: number,
    end: number,
  ) => void;
};

// Dispatched by name, so one set serves the single-line and multiline views
// (and Android's) alike.
const Commands = codegenNativeCommands<SetTextAndSelectionCommands>({
  supportedCommands: ['setTextAndSelection'],
});

export type TextFieldProps = TextInputProps & { ref?: React.Ref<TextInput> };

export function TextField({ ref, value, defaultValue, selection, onChange, style, ...rest }: TextFieldProps) {
  const inputRef = useRef<TextInput | null>(null);
  const setRef = useCallback(
    (instance: TextInput | null) => {
      inputRef.current = instance;
      if (typeof ref === 'function') ref(instance);
      else if (ref) (ref as React.RefObject<TextInput | null>).current = instance;
    },
    [ref],
  );

  const text = value ?? defaultValue ?? '';
  const styleKey = styleKeyOf(StyleSheet.flatten(style), rest.allowFontScaling, rest.maxFontSizeMultiplier);

  const sync = useRef<FieldSync | null>(null);
  // The event count of the field's last change, which the command must match.
  const eventCount = useRef(0);
  // Survives a render that's thrown away before it commits, so the commit
  // after it still sends the write that render noticed.
  const pending = useRef<{ text: string | null; selection: { start: number; end?: number } | null }>({
    text: null,
    selection: null,
  });

  if (sync.current == null) {
    sync.current = initialFieldSync(text, styleKey);
  } else {
    const next = nextFieldSync(sync.current, text, styleKey);
    sync.current = next.sync;
    if (next.write != null) pending.current.text = next.write;
  }

  // Starts unset so a `selection` passed at mount is applied too.
  const lastSelection = useRef<TextInputProps['selection']>(undefined);
  if (selection !== lastSelection.current) {
    lastSelection.current = selection;
    if (selection) pending.current.selection = selection;
  }

  useLayoutEffect(() => {
    const { text: write, selection: sel } = pending.current;
    if (write == null && sel == null) return;
    pending.current = { text: null, selection: null };
    const node = inputRef.current;
    if (node == null) return;
    Commands.setTextAndSelection(
      node as unknown as React.ElementRef<HostComponent<unknown>>,
      eventCount.current,
      write,
      sel ? sel.start : -1,
      sel ? (sel.end ?? sel.start) : -1,
    );
  });

  const handleChange = useCallback(
    (e: NativeSyntheticEvent<TextInputChangeEventData>) => {
      eventCount.current = e.nativeEvent.eventCount;
      if (sync.current) sync.current = fieldChanged(sync.current, e.nativeEvent.text);
      onChange?.(e);
    },
    [onChange],
  );

  return (
    <TextInput
      {...rest}
      ref={setRef}
      style={style}
      defaultValue={sync.current.tree}
      onChange={handleChange}
    />
  );
}
