export const REPOSITORY = 'https://github.com/codebend3r/maester'

export const RELEASES = `${REPOSITORY}/releases`

// No release publishes installers yet, so every download opens the newest
// release, where they will be once one does.
export const LATEST_RELEASE = `${RELEASES}/latest`

/**
 * Where Open web app goes for a server typed in: the address as typed, over
 * this page's own scheme when it names none, and this server's home while
 * the field is blank or holds something that is not a web address.
 */
export const webAppAddress = ({ typed, origin }: { typed: string; origin: string }): string => {
  const home = `${origin}/`
  const trimmed = typed.trim()
  if (trimmed === '') return home
  const withScheme = /^[a-z][a-z\d+.-]*:\/\//i.test(trimmed)
    ? trimmed
    : `${new URL(origin).protocol}//${trimmed}`
  try {
    const address = new URL(withScheme)
    return address.protocol === 'http:' || address.protocol === 'https:' ? address.href : home
  } catch {
    return home
  }
}
