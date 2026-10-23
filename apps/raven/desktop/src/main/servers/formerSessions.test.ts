import { describe, expect, it } from 'bun:test'
import {
  clearFormerPartitions,
  FORMER_LIST_MS,
  formerPartitions,
} from '@/main/servers/formerSessions'
import { ERROR_CODES } from '@/main/stateStore'
import { fakeTimers } from '@/main/test/playerFakes'

const ID_A = '0f4e2a4c-1b8c-4f9e-9e21-6f1f0f1d2c3a'
const ID_B = '11111111-2222-4333-8444-555555555555'

describe('formerPartitions', () => {
  it('names every server partition on disk', () => {
    expect(formerPartitions({ names: [`server%3A${ID_A}`, `server%3A${ID_B}`] })).toEqual([
      `server%3A${ID_A}`,
      `server%3A${ID_B}`,
    ])
  })

  it('never names anything that is not one of our server partitions', () => {
    expect(
      formerPartitions({
        names: [
          'local',
          'server%3Anot-an-id',
          `server%3A${ID_A.toUpperCase()}`,
          `server%3A${ID_B}%2F..`,
          `remote%3A${ID_B}`,
          `server:${ID_B}`,
          `server%3A${ID_B}x`,
          '..',
        ],
      }),
    ).toEqual([])
  })
})

describe('clearFormerPartitions', () => {
  const DIR = '/data/Partitions'

  /** Lists the partitions and waits for the removals it started. */
  const cleared = async (input: Omit<Parameters<typeof clearFormerPartitions>[0], 'timers'>) => {
    const { removing } = await clearFormerPartitions({ ...input, timers: fakeTimers().timers })
    await removing
  }

  it('removes only the server partitions, inside the partitions folder', async () => {
    const removed: string[] = []
    await cleared({
      dir: DIR,
      fs: {
        readdir: async () => [`server%3A${ID_A}`, `server%3A${ID_B}`, 'other'],
        remove: async (path) => {
          removed.push(path)
        },
      },
      warn: () => {},
    })
    expect(removed).toEqual([`${DIR}/server%3A${ID_A}`, `${DIR}/server%3A${ID_B}`])
  })

  it('a missing partitions folder is nothing to clear', async () => {
    const warnings: string[] = []
    await cleared({
      dir: DIR,
      fs: {
        readdir: () =>
          Promise.reject(Object.assign(new Error('missing'), { code: ERROR_CODES.enoent })),
        remove: async () => {},
      },
      warn: (message) => {
        warnings.push(message)
      },
    })
    expect(warnings).toEqual([])
  })

  it('warns, and goes on, when a folder cannot be read or removed', async () => {
    const warnings: string[] = []
    const removed: string[] = []
    const ID_C = '22222222-3333-4444-8555-666666666666'
    await cleared({
      dir: DIR,
      fs: {
        readdir: async () => [`server%3A${ID_B}`, `server%3A${ID_C}`],
        remove: async (path) => {
          if (path.endsWith(ID_B)) throw new Error('busy')
          removed.push(path)
        },
      },
      warn: (message) => {
        warnings.push(message)
      },
    })
    expect(removed).toEqual([`${DIR}/server%3A${ID_C}`])
    expect(warnings).toHaveLength(1)
    const unreadable: string[] = []
    await cleared({
      dir: DIR,
      fs: { readdir: () => Promise.reject(new Error('denied')), remove: async () => {} },
      warn: (message) => {
        unreadable.push(message)
      },
    })
    expect(unreadable).toHaveLength(1)
  })

  it('answers once the folder is listed, without waiting for the removals', async () => {
    const started: string[] = []
    const { removing } = await clearFormerPartitions({
      dir: DIR,
      fs: {
        readdir: async () => [`server%3A${ID_B}`],
        remove: (path) => {
          started.push(path)
          return new Promise<void>(() => undefined)
        },
      },
      timers: fakeTimers().timers,
      warn: () => {},
    })
    expect(started).toEqual([`${DIR}/server%3A${ID_B}`])
    expect(removing).toBeInstanceOf(Promise)
  })

  it('goes on with nothing to remove when the listing outlasts its budget', async () => {
    const clock = fakeTimers()
    const warnings: string[] = []
    const removed: string[] = []
    const listed: ((names: string[]) => void)[] = []
    const pending = clearFormerPartitions({
      dir: DIR,
      fs: {
        readdir: () =>
          new Promise<string[]>((resolve) => {
            listed.push(resolve)
          }),
        remove: async (path) => {
          removed.push(path)
        },
      },
      timers: clock.timers,
      warn: (message) => {
        warnings.push(message)
      },
    })
    expect([...clock.pending.values()].map(({ ms }) => ms)).toEqual([FORMER_LIST_MS])
    clock.fire()
    await (
      await pending
    ).removing
    listed.forEach((resolve) => resolve([`server%3A${ID_B}`]))
    await Promise.resolve()
    expect(removed).toEqual([])
    expect(warnings).toEqual([
      `Raven did not list its server sessions within ${FORMER_LIST_MS} ms, so it clears none this time`,
    ])
  })
})
