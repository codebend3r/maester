import { create } from 'zustand'

/** The keys of Home's bands that are no library shelf, and so carry no shelf key of their own. */
export const HOME_BANDS = { hero: 'hero', binge: 'binge' } as const

/** Where a shelf stands in its screen's scrolling content: its top and its height. */
export type ShelfBand = { top: number; height: number }

type ShelfBandsState = { screens: Readonly<Record<string, Readonly<Record<string, ShelfBand>>>> }

/**
 * Where each shelf of a TV screen stands, by the screen's route key and the shelf's key, as the
 * shelves measure themselves. The screen's layout reads them to bring the shelf of a card
 * taking the focus back into view; it lives here since the layout and every shelf on it share it.
 */
const useShelfBands = create<ShelfBandsState>()(() => ({ screens: {} }))

type PlaceShelfProps = { screen: string; shelf: string; band: ShelfBand }

/** The shelf `shelf` of the screen `screen` is laid out at `band`. */
export const placeShelf = ({ screen, shelf, band }: PlaceShelfProps): void =>
  useShelfBands.setState((state) => ({
    screens: { ...state.screens, [screen]: { ...state.screens[screen], [shelf]: band } },
  }))

type ForgetShelfProps = { screen: string; shelf: string }

/** The shelf has gone. */
export const forgetShelf = ({ screen, shelf }: ForgetShelfProps): void =>
  useShelfBands.setState((state) => {
    const { [shelf]: gone, ...kept } = state.screens[screen] ?? {}
    return gone === undefined ? state : { screens: { ...state.screens, [screen]: kept } }
  })

type ShelfBandOfProps = { screen: string; shelf: string }

/** Where the shelf stands now, or null while it is not laid out. */
export const shelfBandOf = ({ screen, shelf }: ShelfBandOfProps): ShelfBand | null =>
  useShelfBands.getState().screens[screen]?.[shelf] ?? null
