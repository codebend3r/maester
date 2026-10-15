const names = (() => {
  try {
    return new Intl.DisplayNames(['en'], { type: 'language' })
  } catch {
    return null
  }
})()

/** "English" for 'en'; the code itself when the browser has no name for it. */
export const languageName = ({
  tag,
  fallback = 'uppercase',
}: {
  tag: string | null
  fallback?: 'uppercase' | 'original'
}): string | null => {
  if (tag == null) return null
  try {
    return names?.of(tag) ?? (fallback === 'original' ? tag : tag.toUpperCase())
  } catch {
    return fallback === 'original' ? tag : tag.toUpperCase()
  }
}
