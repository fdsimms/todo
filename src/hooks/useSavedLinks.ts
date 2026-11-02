import { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert } from 'react-native';
import { BUTTON_LABEL } from '../copy/shared';
import { haptics } from '../utils/haptics';
import { animateLayout } from '../utils/layoutAnimation';
import {
  addSavedLink,
  canSaveLink,
  isChipUrl,
  linkChips,
  readSavedLinks,
  removeSavedLink,
  renameSavedLink,
  suggestLinkName,
  writeSavedLinks,
  type LinkChip,
  type SavedLink,
} from '../utils/savedLinks';

/**
 * The Link picker's chips: the built-in apps and the links the person saved,
 * plus saving, renaming and removing one. Every picker (the task editor, quick
 * add, a chain step, a title rule, a reward) calls this rather than reading
 * `KNOWN_LINK_APPS`, so a saved link is offered everywhere a link is chosen.
 *
 * The list is re-read each time the picker opens (`open`), since another sheet
 * or another device may have changed it; it is a plain setting, not a store.
 * The name is asked with `Alert.prompt` rather than a sheet of its own: a
 * second Modal raised from a picker that is itself in a Modal is the case
 * `SheetModal`'s notes warn about.
 */
export function useSavedLinks(kitchenEnabled: boolean, open: boolean) {
  const [saved, setSaved] = useState<SavedLink[]>(readSavedLinks);

  useEffect(() => {
    if (open) setSaved(readSavedLinks());
  }, [open]);

  const commit = useCallback((next: SavedLink[]) => {
    animateLayout();
    writeSavedLinks(next);
    setSaved(next);
  }, []);

  const chips = useMemo(() => linkChips(saved, kitchenEnabled), [saved, kitchenEnabled]);

  /** Whether the text in the field is a link worth offering to save. */
  const canSave = useCallback((typed: string | null | undefined) => canSaveLink(saved, typed), [saved]);

  /** Asks for a name, then saves the link as a chip. `onSaved` runs once it is. */
  const offerSave = useCallback((url: string, onSaved?: () => void) => {
    const trimmed = url.trim();
    if (!canSaveLink(saved, trimmed)) return;
    Alert.prompt(
      'Name this link',
      'It will show with the other apps when you pick a link.',
      [
        { text: BUTTON_LABEL.cancel, style: 'cancel' },
        {
          text: BUTTON_LABEL.save,
          onPress: (text?: string) => {
            const name = (text ?? '').trim();
            if (!name) return;
            // Read again rather than trusting `saved`: another picker may have
            // saved a link since this one opened, and writing the stale list
            // back would drop it.
            const current = readSavedLinks();
            const next = addSavedLink(current, { name, url: trimmed });
            if (next.length === current.length) return;
            haptics.success();
            commit(next);
            onSaved?.();
          },
        },
      ],
      'plain-text',
      suggestLinkName(trimmed),
    );
  }, [saved, commit]);

  /** The long-press menu on a saved chip: rename it, or take it off the picker. */
  const manage = useCallback((chip: LinkChip) => {
    if (!chip.saved || !chip.savedId) return;
    const id = chip.savedId;
    haptics.tap();
    Alert.alert(chip.name, chip.scheme, [
      {
        text: 'Rename',
        onPress: () => Alert.prompt(
          'Rename link',
          undefined,
          [
            { text: BUTTON_LABEL.cancel, style: 'cancel' },
            { text: BUTTON_LABEL.save, onPress: (text?: string) => commit(renameSavedLink(readSavedLinks(), id, text ?? '')) },
          ],
          'plain-text',
          chip.name,
        ),
      },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: () => { haptics.warning(); commit(removeSavedLink(readSavedLinks(), id)); },
      },
      { text: BUTTON_LABEL.cancel, style: 'cancel' },
    ]);
  }, [commit]);

  /**
   * True when `url` is a chip in a picker, built in or saved. Reads the setting
   * rather than `saved`: it is asked as a picker opens, before the re-read above
   * has landed.
   */
  const isChip = useCallback((url: string | null | undefined) => isChipUrl(readSavedLinks(), url), []);

  return { saved, chips, canSave, offerSave, manage, isChip };
}

export type SavedLinks = ReturnType<typeof useSavedLinks>;
