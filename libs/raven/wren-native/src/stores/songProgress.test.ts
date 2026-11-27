import { beforeEach, describe, expect, it } from 'bun:test'
import { SONG_PROGRESS_KEY } from '@raven/wren'
import { AIRBAG, LUCKY } from '@raven/wren/testing'
import { create } from 'zustand'
import type { StateStorage } from 'zustand/middleware'

import {
  configureSongProgress,
  forgetSongProgressOnAccountChange,
  useSongProgress,
} from '@/stores/songProgress'

const SERVER = 'home'

type MemoryStorageProps = { entries?: [string, string][] }

const memoryStorage = ({ entries = [] }: MemoryStorageProps = {}) => {
  const items = new Map(entries)
  const storage: StateStorage = {
    getItem: (name) => items.get(name) ?? null,
    setItem: (name, value) => {
      items.set(name, value)
    },
    removeItem: (name) => {
      items.delete(name)
    },
  }
  return { storage, items }
}

const listener = (userId: string) => ({
  accessToken: 'access',
  refreshToken: 'refresh',
  expiresAt: 0,
  userId,
  email: `${userId}@example.com`,
})

type SessionState = { session: ReturnType<typeof listener> | null }

const accountStore = () => create<SessionState>()(() => ({ session: null }))

describe('useSongProgress', () => {
  beforeEach(() => useSongProgress.setState({ songs: [] }))

  it('keeps a song left partway, then finished, and clears', () => {
    const { note, clear } = useSongProgress.getState()
    note({ serverId: SERVER, track: AIRBAG, position: 120 })
    expect(useSongProgress.getState().songs).toEqual([
      expect.objectContaining({
        trackId: AIRBAG.id,
        left: expect.objectContaining({ position: 120 }),
        finishedAt: null,
      }),
    ])
    note({ serverId: SERVER, track: AIRBAG, position: 299 })
    expect(useSongProgress.getState().songs).toEqual([
      expect.objectContaining({ trackId: AIRBAG.id, left: null }),
    ])
    expect(useSongProgress.getState().songs[0]?.finishedAt).not.toBeNull()
    clear()
    expect(useSongProgress.getState().songs).toEqual([])
  })

  it('reads back what the device kept, and what played meanwhile stands over it', async () => {
    const kept = {
      serverId: SERVER,
      trackId: LUCKY.id,
      albumId: LUCKY.albumId,
      libraryId: LUCKY.libraryId,
      left: { position: 30, at: '2026-11-01T00:00:00.000Z' },
      finishedAt: null,
    }
    const { storage, items } = memoryStorage({
      entries: [[SONG_PROGRESS_KEY, JSON.stringify({ state: { songs: [kept, 7] }, version: 0 })]],
    })
    useSongProgress.getState().note({ serverId: SERVER, track: AIRBAG, position: 60 })
    await configureSongProgress({ storage })
    expect(useSongProgress.getState().songs.map(({ trackId }) => trackId)).toEqual([
      AIRBAG.id,
      LUCKY.id,
    ])
    useSongProgress.getState().note({ serverId: SERVER, track: AIRBAG, position: 90 })
    expect(items.get(SONG_PROGRESS_KEY)).toContain('"position":90')
  })
})

describe('forgetSongProgressOnAccountChange', () => {
  beforeEach(() => {
    useSongProgress.setState({ songs: [] })
    useSongProgress.getState().note({ serverId: SERVER, track: AIRBAG, position: 60 })
  })

  it('keeps the progress as an account signs in or its token is renewed', () => {
    const session = accountStore()
    const stop = forgetSongProgressOnAccountChange({ session })
    session.setState({ session: listener('u1') })
    session.setState({ session: { ...listener('u1'), accessToken: 'renewed' } })
    expect(useSongProgress.getState().songs).toHaveLength(1)
    stop()
  })

  it('forgets it as the account signs out or another signs in', () => {
    const session = accountStore()
    const stop = forgetSongProgressOnAccountChange({ session })
    session.setState({ session: listener('u1') })
    session.setState({ session: listener('u2') })
    expect(useSongProgress.getState().songs).toEqual([])
    useSongProgress.getState().note({ serverId: SERVER, track: AIRBAG, position: 60 })
    session.setState({ session: null })
    expect(useSongProgress.getState().songs).toEqual([])
    stop()
  })
})
