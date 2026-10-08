// The wire admits 500 characters per text field (`syncRowSchema`); a row
// recorded longer could never be sent.
export const RECORD_TEXT_MAX = 500;

/** Cuts to `RECORD_TEXT_MAX` code points, never splitting a surrogate pair. */
export function clampForRecord(text: string): string {
  let count = 0;
  let index = 0;
  while (index < text.length && count < RECORD_TEXT_MAX) {
    const code = text.codePointAt(index)!;
    index += code > 0xffff ? 2 : 1;
    count += 1;
  }
  return text.slice(0, index);
}
