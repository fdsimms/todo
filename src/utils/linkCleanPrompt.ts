import { Alert } from 'react-native';
import { cleanLinkUrl, trackingParamNames } from './linkClean';
import { isChipUrl, type SavedLink } from './savedLinks';

/**
 * Asks whether to remove the tracking codes from a link the person typed or
 * pasted, before it is stored (the dialog behind `cleanLinkUrl`).
 *
 * A field commits on blur, on Enter and on Save, so one link reaches this more
 * than once. The answer is remembered by the exact text, which is what keeps a
 * second commit from asking again, and what lets a Save that arrives before the
 * field's own commit read the answer synchronously (`settledLink`).
 *
 * Never asked when the link has nothing to strip, is already a saved chip or
 * an app link, or is the link the field already held (reopening a task whose
 * link the person chose to keep must not ask again).
 */
const answers = new Map<string, string>();
const pending = new Map<string, Promise<string>>();
const MAX_REMEMBERED = 50;

function remember(url: string, chosen: string): void {
  if (answers.size >= MAX_REMEMBERED) answers.delete(answers.keys().next().value as string);
  answers.set(url, chosen);
}

/** Whether this text still needs an answer before it can be stored. */
export function linkNeedsAnswer(links: readonly SavedLink[], typed: string, current?: string | null): boolean {
  const url = typed.trim();
  return !!url && url !== current && !answers.has(url) && !isChipUrl(links, url) && cleanLinkUrl(url) !== url;
}

/** A link that is already stored is never asked about again: a field that opens with one calls this. */
export function acceptExistingLink(url: string | null | undefined): void {
  const trimmed = url?.trim();
  if (trimmed) remember(trimmed, trimmed);
}

/** The typed text as it is to be stored: trimmed, and with the person's answer applied if they gave one. */
export function settledLink(typed: string): string {
  const url = typed.trim();
  return answers.get(url) ?? url;
}

/** Shows the dialog and resolves with the link to store. Two callers asking about one link share one dialog. */
export function askAboutLink(url: string): Promise<string> {
  const known = answers.get(url);
  if (known !== undefined) return Promise.resolve(known);
  const open = pending.get(url);
  if (open) return open;
  const names = trackingParamNames(url).join(', ');
  const asked = new Promise<string>(resolve => {
    const settle = (chosen: string) => { remember(url, chosen); pending.delete(url); resolve(chosen); };
    Alert.alert(
      'Remove tracking codes?',
      `This link has ${names}. The page is the same without them.`,
      [
        { text: 'Keep', style: 'cancel', onPress: () => settle(url) },
        { text: 'Remove', onPress: () => settle(cleanLinkUrl(url)) },
      ],
      { cancelable: false },
    );
  });
  pending.set(url, asked);
  return asked;
}

/**
 * For a save that reads the link synchronously: when the link still needs an
 * answer, asks and runs `retry` once it has one (the retry reads it through
 * `settledLink`) and returns true, so the caller stops there.
 */
export function deferForLinkAnswer(
  links: readonly SavedLink[],
  typed: string,
  current: string | null | undefined,
  retry: () => void,
): boolean {
  if (!linkNeedsAnswer(links, typed, current)) return false;
  void askAboutLink(typed.trim()).then(retry);
  return true;
}
