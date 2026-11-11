import { create } from 'zustand'

type Watching = {
  /** Whether the video player is on screen, saving its own spot as it plays. */
  isWatching: boolean
  setWatching: (isWatching: boolean) => void
}

/**
 * Whether a video plays on this device now. While one does, the server's word that the
 * account's viewing changed is this player's own save coming back, and the screens under the
 * player are read again once it closes, so the event stream lets those pass (`useAppQueries`).
 */
export const useWatching = create<Watching>()((set) => ({
  isWatching: false,
  setWatching: (isWatching) => set({ isWatching }),
}))
