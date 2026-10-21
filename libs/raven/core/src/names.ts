/** The longest name a person may give a server, in code points. */
export const NAME_MAX = 80

// Control and format characters: a bidi control can reorder what is shown around it, and a
// zero width space hides between letters. The joiners (ZWNJ, ZWJ) and the tag characters
// stay: Persian spelling and emoji sequences, subdivision flags among them, need them, and
// none of them can reorder text.
const HIDDEN = /(?!\u200c|\u200d|[\u{E0020}-\u{E007F}])[\p{Cc}\p{Cf}]/u
const HIDDEN_ALL = /(?!\u200c|\u200d|[\u{E0020}-\u{E007F}])[\p{Cc}\p{Cf}]/gu
const WHITESPACE = /\s+/gu

/** Text from outside tidied for showing: whitespace collapsed, hidden characters dropped, trimmed. */
const tidy = (text: string): string =>
  text.replace(WHITESPACE, ' ').replace(HIDDEN_ALL, '').replace(WHITESPACE, ' ').trim()

/** `text` tidied and cut to `max` code points, so a cut never splits a surrogate pair. */
export const tidyText = ({ text, max }: { text: string; max: number }): string =>
  Array.from(tidy(text)).slice(0, max).join('').trim()

/**
 * A name a person typed, tidied; null when it is empty, past `NAME_MAX` code points (as
 * `tidyText` cuts) or holds a control or format character other than a joiner or a tag.
 */
export const cleanName = (name: string): string | null => {
  const cleaned = name.replace(WHITESPACE, ' ').trim()
  if (cleaned === '' || Array.from(cleaned).length > NAME_MAX) return null
  if (HIDDEN.test(cleaned)) return null
  return cleaned
}
