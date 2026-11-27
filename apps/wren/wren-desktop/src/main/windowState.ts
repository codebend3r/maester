/** Where the window was last, as Electron's bounds name it. */
export type WindowBounds = { x: number; y: number; width: number; height: number }

/** The file in Wren's data folder that holds where the window was last. */
export const WINDOW_FILE = 'window.json'

/** A display's work area, the part of the screen a window may take. */
type WorkArea = WindowBounds

/** The window's size the first time Wren opens: room for the sidebar, a page and the player bar. */
export const FIRST_SIZE = { width: 1280, height: 820 } as const

/** The smallest window, as wide as the narrowest page the web app lays out (320px). */
export const MIN_SIZE = { width: 320, height: 480 } as const

const isWholeNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isInteger(value)

/** Whether a saved file holds bounds Wren wrote. */
export const isWindowBounds = (value: unknown): value is WindowBounds =>
  typeof value === 'object' &&
  value !== null &&
  'x' in value &&
  'y' in value &&
  'width' in value &&
  'height' in value &&
  isWholeNumber(value.x) &&
  isWholeNumber(value.y) &&
  isWholeNumber(value.width) &&
  isWholeNumber(value.height) &&
  value.width >= MIN_SIZE.width &&
  value.height >= MIN_SIZE.height

type OverlapsProps = { bounds: WindowBounds; area: WorkArea }

const overlaps = ({ bounds, area }: OverlapsProps): boolean =>
  bounds.x < area.x + area.width &&
  bounds.x + bounds.width > area.x &&
  bounds.y < area.y + area.height &&
  bounds.y + bounds.height > area.y

type PlaceWindowProps = { saved: unknown; areas: readonly WorkArea[] }

/**
 * Where the window opens: where it was last while some display still shows it, else the first
 * size, which Electron centres on the main display.
 */
export const placeWindow = ({
  saved,
  areas,
}: PlaceWindowProps): WindowBounds | typeof FIRST_SIZE => {
  if (!isWindowBounds(saved)) return FIRST_SIZE
  return areas.some((area) => overlaps({ bounds: saved, area })) ? saved : FIRST_SIZE
}
