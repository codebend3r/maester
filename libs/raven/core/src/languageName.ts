const names = (() => {
  try {
    return new Intl.DisplayNames(['en'], { type: 'language' })
  } catch {
    return null
  }
})()

/** What `languageName` gives for a code it has no name for: the code uppercased, or as it came. */
export const LANGUAGE_FALLBACKS = { uppercase: 'uppercase', original: 'original' } as const

type LanguageFallback = (typeof LANGUAGE_FALLBACKS)[keyof typeof LANGUAGE_FALLBACKS]

type LanguageNameProps = {
  tag: string | null
  fallback?: LanguageFallback
}

/** "English" for 'en'; the code itself when the browser has no name for it. */
export const languageName = ({
  tag,
  fallback = LANGUAGE_FALLBACKS.uppercase,
}: LanguageNameProps): string | null => {
  if (tag == null) return null
  try {
    return names?.of(tag) ?? (fallback === LANGUAGE_FALLBACKS.original ? tag : tag.toUpperCase())
  } catch {
    return fallback === LANGUAGE_FALLBACKS.original ? tag : tag.toUpperCase()
  }
}
