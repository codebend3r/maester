import { create } from 'zustand'

import { type ShelfViewport, farHeightOf } from '@/layouts/shelfScroll'

/** The keys of Home's bands that are no library shelf, and so carry no shelf key of their own. */
export const HOME_BANDS = { hero: 'hero', binge: 'binge' } as const

/** Where a shelf stands in its screen's scrolling content: its top and its height. */
export type ShelfBand = { top: number; height: number }

type ShelfBandsState = {
  screens: Readonly<Record<string, Readonly<Record<string, ShelfBand>>>>
  /** How far each screen's shelves are scrolled and how tall their view is, once measured. */
  views: Readonly<Record<string, ShelfViewport>>
}

const UNMEASURED: ShelfViewport = { offset: 0, viewport: 0 }

/**
 * Where each shelf of a TV screen stands, by the screen's route key and the shelf's key, as the
 * shelves measure themselves, and where the screen's view of them stands. The screen's layout
 * reads them to bring the shelf of a card taking the focus back into view, and each shelf to
 * know whether it is near enough to the view to draw; it lives here since the layout and every
 * shelf on it share it.
 */
const useShelfBands = create<ShelfBandsState>()(() => ({ screens: {}, views: {} }))

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

type ViewShelvesProps = { screen: string; view: Partial<ShelfViewport> }

/** The screen's shelves have scrolled, or their view has been laid out. */
export const viewShelves = ({ screen, view }: ViewShelvesProps): void =>
  useShelfBands.setState((state) => ({
    views: { ...state.views, [screen]: { ...(state.views[screen] ?? UNMEASURED), ...view } },
  }))

type ShelfViewOfProps = { screen: string }

/** Where the screen's view of its shelves stands now. */
export const shelfViewOf = ({ screen }: ShelfViewOfProps): ShelfViewport =>
  useShelfBands.getState().views[screen] ?? UNMEASURED

/** The screen's shelves have gone, and their view with them. */
export const forgetShelfView = ({ screen }: ShelfViewOfProps): void =>
  useShelfBands.setState((state) => {
    const { [screen]: gone, ...kept } = state.views
    return gone === undefined ? state : { views: kept }
  })

/**
 * The height the shelf stands in as while it is far from its screen's view, or null while it is
 * drawn. A number, so a shelf draws again only as it turns far or near, never on every scroll.
 */
export const useFarShelfHeight = ({ screen, shelf }: ShelfBandOfProps): number | null =>
  useShelfBands((state) =>
    farHeightOf({
      band: state.screens[screen]?.[shelf] ?? null,
      ...(state.views[screen] ?? UNMEASURED),
    }),
  )
