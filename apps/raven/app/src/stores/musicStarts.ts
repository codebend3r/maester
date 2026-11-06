import { create } from 'zustand'

type MusicStarts = {
  /** How many queues have started playing this run. */
  started: number
  /** The last of them the TV's music strip took the remote for. */
  met: number
  start: () => void
  meet: (count: number) => void
}

/**
 * New queues started, and the last one the TV's strip answered by taking the remote: the strip is
 * drawn afresh after Now Playing, and must not take the remote again for a start it has met.
 */
export const useMusicStarts = create<MusicStarts>()((set) => ({
  started: 0,
  met: 0,
  start: () => set((starts) => ({ started: starts.started + 1 })),
  meet: (count) => set({ met: count }),
}))
