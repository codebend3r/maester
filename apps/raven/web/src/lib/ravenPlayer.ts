/**
 * Hands a `raven://` link to raven player. An object, so tests spy on `open`:
 * a browser without the app does nothing (Chrome) or shows an error (Safari).
 */
export const ravenPlayer = {
  open: (link: string): void => window.location.assign(link),
}
