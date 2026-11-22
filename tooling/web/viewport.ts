/** What happy-dom's window adds for a test to size the window. */
type HappyDomViewport = { setViewport: (size: WindowSize) => void }

/** A window's width and height, in pixels. */
type WindowSize = { width: number; height: number }

const isHappyDomViewport = (value: unknown): value is HappyDomViewport =>
  typeof value === 'object' &&
  value !== null &&
  'setViewport' in value &&
  typeof value.setViewport === 'function'

/**
 * Makes happy-dom's window `width` by `height`, so media queries answer as a window that size
 * would. happy-dom lays nothing out, so a test of a width checks what renders and what the
 * queries say; the layout itself is checked in a browser.
 */
export const sizeWindow = ({ width, height }: WindowSize): void => {
  const happyDom: unknown = Reflect.get(window, 'happyDOM')
  if (!isHappyDomViewport(happyDom)) throw new Error('happy-dom cannot size this window')
  happyDom.setViewport({ width, height })
}
