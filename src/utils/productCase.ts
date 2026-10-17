/**
 * Barcode databases hold many names exactly as printed on the package, in
 * capitals ("MILK CHOCOLATE PEANUT BUTTER CUPS"). Used as a list or food log
 * name they read as shouting, so a name or brand with no lowercase letter in it
 * is put into title case.
 *
 * **Only a string that is entirely capitals is touched.** Mixed case is the
 * source's own choice ("iPhone", "McCormick", "Ben & Jerry's") and a rule that
 * "fixed" it would be wrong more often than right. A string with no letters
 * ("12", "7-11") has nothing to fix and comes back as it was.
 */

/** Words left lowercase inside a title ("Mac and Cheese"), except as its first. */
const SMALL_WORDS = new Set(['a', 'an', 'and', 'as', 'at', 'by', 'for', 'in', 'of', 'on', 'or', 'the', 'to', 'with']);

export function readableProductCase(text: string): string {
  if (!/[A-Za-z]/.test(text) || /[a-z]/.test(text)) return text;
  let first = true;
  // A word starts at the string's start or after a space, hyphen, slash,
  // ampersand, parenthesis or period. An apostrophe does not start one, which
  // is what keeps "JUSTIN'S" from becoming "Justin'S".
  return text.toLowerCase().replace(/(^|[\s\-/&(.])([a-z]+)/g, (_, lead: string, word: string) => {
    const keepLower = !first && SMALL_WORDS.has(word);
    first = false;
    return lead + (keepLower ? word : word[0].toUpperCase() + word.slice(1));
  });
}
