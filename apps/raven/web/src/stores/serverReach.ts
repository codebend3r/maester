import { create } from 'zustand'

type ServerReach = {
  /**
   * Whether raven player could not reach its server when it asked for the account config. It
   * holds through every retry, so the offline frame stays put while one is under way, and goes
   * once the server answers.
   */
  isOffline: boolean
}

export const useServerReach = create<ServerReach>()(() => ({ isOffline: false }))
