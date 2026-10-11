/**
 * Leaving for another site (Plex, or the app that sent the friend here) is a
 * full navigation, not a router change. It sits behind an object so tests
 * can watch it instead of navigating the test DOM.
 */
export const browser = {
  goTo: (url: string): void => {
    window.location.assign(url)
  },
}
