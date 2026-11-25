import { themeFor } from '@raven/wren'
import { useWrenPrefs } from '@/stores/wrenPrefs'
import { MEDIA_QUERIES, followMedia } from '@/theme/media'
import { systemScheme } from '@/theme/systemScheme'
import { COLOR_TOKEN_NAMES } from '@/theme/tokens'

/** What the theme's ground is told to the browser through, for its own bars around the page. */
const THEME_COLOR_METAS = 'meta[name="theme-color"]'

/** Tells the browser the ground of the theme worn, where the stylesheet has been read. */
const tellGround = (): void => {
  const ground = getComputedStyle(document.documentElement)
    .getPropertyValue(COLOR_TOKEN_NAMES.ground)
    .trim()
  if (ground === '') return
  document.querySelectorAll(THEME_COLOR_METAS).forEach((meta) => {
    meta.setAttribute('content', ground)
  })
}

/** Puts the theme the kept choice and the device ask for on the page, as the root's `data-theme`. */
const wearTheme = (): void => {
  document.documentElement.dataset.theme = themeFor({
    choice: useWrenPrefs.getState(),
    scheme: systemScheme(),
  })
  tellGround()
}

/**
 * Wears the kept theme, then follows every change of it and of the device's scheme. Returns the
 * way to stop.
 */
export const followTheme = (): (() => void) => {
  wearTheme()
  const stopPrefs = useWrenPrefs.subscribe(wearTheme)
  const stopSystem = followMedia({ query: MEDIA_QUERIES.light, onChange: wearTheme })
  return () => {
    stopPrefs()
    stopSystem()
  }
}
