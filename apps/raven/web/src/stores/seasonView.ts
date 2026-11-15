import { create } from 'zustand'
import { keptInStorage, STORE_KEYS } from '@/stores/storage'

export const SEASON_VIEWS = { grid: 'grid', table: 'table' } as const

export type SeasonView = (typeof SEASON_VIEWS)[keyof typeof SEASON_VIEWS]

type SeasonViewState = {
  view: SeasonView
  setView: (view: SeasonView) => void
}

/** How a show's page lays out its seasons, kept across shows and visits. */
export const useSeasonView = create<SeasonViewState>()(
  keptInStorage({
    key: STORE_KEYS.seasonView,
    name: 'raven/seasonView',
    state: (set) => ({
      view: SEASON_VIEWS.grid,
      setView: (view) => set({ view }),
    }),
    keep: ({ view }) => ({ view }),
  }),
)
