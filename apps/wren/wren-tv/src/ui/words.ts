/**
 * Words to show, or none where they say nothing: a count line of nothing (`countsLineOf` writes
 * '' for no songs) is left out rather than drawn empty.
 */
export const shownWords = (words: string): string | null => (words === '' ? null : words)
