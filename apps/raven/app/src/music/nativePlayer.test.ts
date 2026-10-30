import { describe, expect, it } from 'bun:test'
import type { AudioItem } from '@raven/audio'
import type { Track } from '@raven/core'

import { nativePlayerOf } from '@/music/nativePlayer'

const track = (id: number): Track => ({
  id,
  libraryId: 1,
  albumId: 7,
  title: `Track ${id}`,
  disc: 1,
  number: id,
  duration: 200,
  artists: [{ id: 1, name: 'Radiohead' }],
  container: 'flac',
  codec: 'flac',
  bitrate: 900000,
  sampleRate: 44100,
  bitDepth: 16,
  isLossless: true,
  mbid: null,
  addedAt: '2026-01-01T00:00:00Z',
  album: { title: 'OK Computer', coverVersion: 'v1' },
})

const itemFor = ({ id, title }: Track): AudioItem => ({
  id,
  uri: `https://raven.example/api/media/${id}/file`,
  headers: {},
  title,
  artist: 'Radiohead',
  album: 'OK Computer',
  artworkUri: null,
  duration: 200,
})

/** One turn of the event loop, so a step that was queued has started. */
const tick = () => new Promise((resolve) => setTimeout(resolve, 0))

type HarnessProps = {
  /** The tracks whose ticket waits until `release` is called. */
  held?: readonly number[]
  /** The tracks the server refuses. */
  refused?: readonly number[]
}

/** A player whose calls are written down, over tickets a test can hold back or refuse. */
const harness = ({ held = [], refused = [] }: HarnessProps = {}) => {
  const calls: string[] = []
  const waiting: (() => void)[] = []
  const nameOf = (item: AudioItem | null) => (item === null ? '-' : String(item.id))
  const player = nativePlayerOf({
    audio: {
      setWindow: async ({ playing, next, shouldPlay, start }) => {
        const from = start > 0 ? ` from ${start}` : ''
        calls.push(
          `window ${playing.id} ${nameOf(next)} ${shouldPlay ? 'playing' : 'paused'}${from}`,
        )
      },
      setNext: async (next) => {
        calls.push(`next ${nameOf(next)}`)
      },
      play: async () => undefined,
      pause: async () => undefined,
      seekTo: async () => undefined,
      setVolume: async () => undefined,
      stop: async () => {
        calls.push('stop')
      },
    },
    itemOf: async (asked) => {
      if (held.includes(asked.id)) await new Promise<void>((resolve) => waiting.push(resolve))
      if (refused.includes(asked.id)) throw new Error('Sign in to the server again.')
      return itemFor(asked)
    },
  })
  /** Lets the held tickets through, once the steps that wait on them have started. */
  const release = async () => {
    await tick()
    waiting.splice(0).forEach((resolve) => resolve())
  }
  return { calls, player, release }
}

describe('nativePlayerOf', () => {
  it('drops a load the queue moved past while its ticket was on its way', async () => {
    const { calls, player, release } = harness({ held: [1] })
    const first = player.load({ playing: track(1), next: track(2), start: 0 })
    await tick()
    const second = player.load({ playing: track(3), next: null, start: 0 })
    await release()
    await Promise.all([first, second])
    expect(calls).toEqual(['window 3 - playing'])
  })

  it('changes the next track only after the window it follows is in place', async () => {
    const { calls, player, release } = harness({ held: [1] })
    const load = player.load({ playing: track(1), next: track(2), start: 0 })
    const next = player.queueNext(track(3))
    await release()
    await Promise.all([load, next])
    expect(calls).toEqual(['window 1 2 playing', 'next 3'])
  })

  it('opens the window paused when the queue was paused, and says why a ticket was refused', async () => {
    const { calls, player } = harness({ refused: [5] })
    await player.setPlaying({ shouldPlay: false })
    await player.load({ playing: track(1), next: track(5), start: 0 })
    expect(calls).toEqual(['window 1 - paused'])
    await expect(player.load({ playing: track(5), next: null, start: 0 })).rejects.toThrow(
      'Sign in to the server again.',
    )
  })

  it("opens an audiobook's window at its saved spot", async () => {
    const { calls, player } = harness()
    await player.load({ playing: track(1), next: track(2), start: 754.5 })
    expect(calls).toEqual(['window 1 2 playing from 754.5'])
  })

  it('lets a stop overtake a load still waiting for its ticket', async () => {
    const { calls, player, release } = harness({ held: [1] })
    const load = player.load({ playing: track(1), next: null, start: 0 })
    await tick()
    const stop = player.stop()
    await release()
    await Promise.all([load, stop])
    expect(calls).toEqual(['stop'])
  })
})
