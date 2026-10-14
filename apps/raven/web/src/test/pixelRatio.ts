// happy-dom keeps `devicePixelRatio` as the window's own accessor, so a stub
// replaces it and the restore puts that accessor back rather than deleting it.
const NATIVE = Object.getOwnPropertyDescriptor(window, 'devicePixelRatio')

/** Makes the screen as dense as `ratio` until `restorePixelRatio`. */
export const atPixelRatio = (ratio: number): void => {
  Object.defineProperty(window, 'devicePixelRatio', { value: ratio, configurable: true })
}

/** Puts the screen's own pixel ratio back; for an `afterEach`. */
export const restorePixelRatio = (): void => {
  if (NATIVE) Object.defineProperty(window, 'devicePixelRatio', NATIVE)
}
