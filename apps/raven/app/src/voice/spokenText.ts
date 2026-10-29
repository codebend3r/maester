type TypedFromProps = { heard: string; isEmail: boolean }

/**
 * What a field takes from what the recognizer heard. A spoken address comes back as words
 * ("pat at example dot com") or with spaces round its parts, and a spoken password or PIN with a
 * space between the pieces said, none of which the account has, so every space goes.
 */
export const typedFrom = ({ heard, isEmail }: TypedFromProps): string => {
  const spelled = isEmail
    ? heard
        .toLowerCase()
        .replace(/\s+at\s+/g, '@')
        .replace(/\s+dot\s+/g, '.')
    : heard
  return spelled.replace(/\s+/g, '')
}
