/** The stylesheets the build preloads in place of linking them (vite.config.ts's `preloadStylesheets`). */
const PRELOADED_STYLESHEETS = 'link[rel="preload"][as="style"]'

const LINK_RELS = { stylesheet: 'stylesheet' } as const

const LINK_EVENTS = { load: 'load', error: 'error' } as const

type ApplyStylesheetsProps = {
  /** Where the preloads are: the page's document. */
  root: ParentNode
}

const apply = (link: HTMLLinkElement): Promise<void> =>
  new Promise((resolve) => {
    link.addEventListener(LINK_EVENTS.load, () => resolve(), { once: true })
    // An unstyled app beats none at all, so a sheet that fails lets it render anyway.
    link.addEventListener(
      LINK_EVENTS.error,
      () => {
        console.error(`Stylesheet failed to load: ${link.href}`)
        resolve()
      },
      { once: true },
    )
    link.rel = LINK_RELS.stylesheet
  })

/**
 * Makes each preloaded stylesheet a stylesheet and settles once every one has
 * loaded, so the app renders styled while index.html's loader painted
 * without waiting for them. With none preloaded, as in the dev server, it
 * settles at once.
 */
export const applyStylesheets = async ({ root }: ApplyStylesheetsProps): Promise<void> => {
  await Promise.all([...root.querySelectorAll<HTMLLinkElement>(PRELOADED_STYLESHEETS)].map(apply))
}
