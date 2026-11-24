import { describe, expect, it } from 'bun:test'
import { QueryClient } from '@tanstack/react-query'
import { act, waitFor } from '@testing-library/react'
import { type LibraryPin, PINS_CAP, type ServerId } from '@raven/core'
import { libraryPinsQuery } from '@/query/accountQueries'
import { type PinChange, usePinToggle } from '@/query/usePinToggle'
import { MELEYS } from '@/test/fixtures'
import { renderQueryHook } from '@/test/renderQueryHook'

const USER_ID = 'viewer'
const PINNED_AT = '2026-11-01T00:00:00.000Z'
const FILMS: LibraryPin = { serverId: MELEYS.serverId, libraryId: 1, pinnedAt: PINNED_AT }

type SetUpProps = {
  pins: readonly LibraryPin[]
  libraryId: number
  userId?: string | null
  serverId?: ServerId | null
  setPin?: (change: PinChange) => Promise<unknown>
}

/** The toggle for one library over a cache holding the account's pins, and what it wrote. */
const setUp = ({
  pins,
  libraryId,
  userId = USER_ID,
  serverId = MELEYS.serverId,
  setPin = async () => undefined,
}: SetUpProps) => {
  const client = new QueryClient()
  const { queryKey } = libraryPinsQuery({ client: null, userId: USER_ID })
  client.setQueryData(queryKey, [...pins])
  const written: PinChange[] = []
  const { result } = renderQueryHook({
    client,
    hook: () =>
      usePinToggle({
        userId,
        serverId,
        libraryId,
        pins: client.getQueryData(queryKey) ?? [],
        setPin: (change) => {
          written.push(change)
          return setPin(change)
        },
      }),
  })
  const held = () => (client.getQueryData(queryKey) ?? []).map((pin) => pin.libraryId)
  return { result, written, held }
}

describe('usePinToggle', () => {
  it('says whether the library is pinned on its server, and pins it at once when pressed', async () => {
    const answer = Promise.withResolvers<undefined>()
    const { result, written, held } = setUp({
      pins: [FILMS],
      libraryId: 2,
      setPin: () => answer.promise,
    })
    expect(result.current).toMatchObject({ isPinned: false, isFull: false })
    act(() => result.current?.toggle())
    await waitFor(() => expect(held()).toEqual([1, 2]))
    expect(written).toEqual([{ serverId: MELEYS.serverId, libraryId: 2, shouldPin: true }])
    answer.resolve(undefined)
  })

  it('unpins a pinned library, and puts the pin back when the database refuses', async () => {
    const { result, written, held } = setUp({
      pins: [FILMS],
      libraryId: 1,
      setPin: async () => {
        throw new Error('The database is away.')
      },
    })
    expect(result.current?.isPinned ?? null).toBe(true)
    act(() => result.current?.toggle())
    await waitFor(() =>
      expect(written).toEqual([{ serverId: MELEYS.serverId, libraryId: 1, shouldPin: false }]),
    )
    await waitFor(() => expect(held()).toEqual([1]))
  })

  it('is full for an unpinned library once the account holds every pin it may', () => {
    const pins = Array.from({ length: PINS_CAP }, (_, index) => ({
      ...FILMS,
      libraryId: index + 1,
    }))
    expect(setUp({ pins, libraryId: PINS_CAP + 1 }).result.current?.isFull ?? null).toBe(true)
    expect(setUp({ pins, libraryId: 1 }).result.current?.isFull ?? null).toBe(false)
  })

  it('is null where the account cannot pin: no one signed in, or a server with no id', () => {
    expect(setUp({ pins: [], libraryId: 1, userId: null }).result.current).toBeNull()
    expect(setUp({ pins: [], libraryId: 1, serverId: null }).result.current).toBeNull()
  })
})
