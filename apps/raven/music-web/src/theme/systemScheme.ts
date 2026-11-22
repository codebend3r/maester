import { type ColorScheme, COLOR_SCHEMES } from '@raven/wren'
import { MEDIA_QUERIES, matchesMedia, useMatchesMedia } from '@/theme/media'

type SchemeOfProps = { isLight: boolean }

const schemeOf = ({ isLight }: SchemeOfProps): ColorScheme =>
  isLight ? COLOR_SCHEMES.light : COLOR_SCHEMES.dark

/** The device's scheme now: light when it says so, dark otherwise. */
export const systemScheme = (): ColorScheme =>
  schemeOf({ isLight: matchesMedia({ query: MEDIA_QUERIES.light }) })

/** The device's scheme, followed as it changes: which of Settings' two slots is showing. */
export const useSystemScheme = (): ColorScheme =>
  schemeOf({ isLight: useMatchesMedia({ query: MEDIA_QUERIES.light }) })
