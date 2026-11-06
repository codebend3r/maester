import { create } from 'zustand'
import { createJSONStorage, devtools, persist } from 'zustand/middleware'
import { STORE_KEYS } from '@/stores/storage'

export const SEASON_VIEWS = { grid: 'grid', table: 'table' } as const

export type SeasonView = (typeof SEASON_VIEWS)[keyof typeof SEASON_VIEWS]

type SeasonViewState = {
  view: SeasonView
  setView: (view: SeasonView) => void
}

/** How a show's page lays out its seasons, kept across shows and visits. */
export const useSeasonView = create<SeasonViewState>()(
  devtools(
    persist(
      (set): SeasonViewState => ({
        view: SEASON_VIEWS.grid,
        setView: (view) => set({ view }),
      }),
      {
        name: STORE_KEYS.seasonView,
        storage: createJSONStorage(() => window.localStorage),
        partialize: ({ view }) => ({ view }),
      },
    ),
    { name: 'raven/seasonView' },
  ),
)
