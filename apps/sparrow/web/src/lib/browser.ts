/**
 * Leaving for rookery's sign-in is a full navigation. It sits behind an
 * object so tests can watch it instead of navigating the test DOM.
 */
export const browser = {
  goTo: (url: string): void => {
    window.location.assign(url)
  },
}
