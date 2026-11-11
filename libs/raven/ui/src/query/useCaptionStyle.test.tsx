import { describe, expect, it, spyOn } from 'bun:test'
import { QueryClient } from '@tanstack/react-query'
import { act, waitFor } from '@testing-library/react'
import {
  CAPTION_COLOURS,
  CAPTION_SIZES,
  type CaptionStyle,
  DEFAULT_CAPTION_STYLE,
  type FetchInit,
  createApiClient,
  isCaptionStyle,
} from '@raven/core'
import { queryKeys } from '@/query/queryClient'
import { useCaptionStyle } from '@/query/useCaptionStyle'
import { usePlayerPrefs } from '@/stores/playerPrefs'
import { renderQueryHook } from '@/test/renderQueryHook'

const LARGE_YELLOW: CaptionStyle = { size: CAPTION_SIZES.large, colour: CAPTION_COLOURS.yellow }

const PUT = 'PUT'

type Call = { url: string; init?: FetchInit }

type ServerProps = {
  /** What the account's look is on the server. */
  held?: CaptionStyle
  /** The status a read answers with. */
  readStatus?: number
  /** The status a save answers with. */
  saveStatus?: number
  /** What a read waits on before it answers. */
  readGate?: Promise<void>
}

/** A server keeping one account's look, which records every call made to it. */
const serverWith = ({
  held = LARGE_YELLOW,
  readStatus = 200,
  saveStatus = 200,
  readGate = Promise.resolve(),
}: ServerProps = {}) => {
  const calls: Call[] = []
  const state = { held }
  const answer = (status: number) => ({
    ok: status === 200,
    status,
    statusText: String(status),
    json: async () => state.held,
    text: async () => JSON.stringify(state.held),
  })
  const api = createApiClient({
    fetch: async (url, init) => {
      calls.push({ url, init })
      if (init?.method !== PUT) return readGate.then(() => answer(readStatus))
      const sent: unknown = JSON.parse(init.body ?? 'null')
      if (saveStatus === 200 && isCaptionStyle(sent)) state.held = sent
      return answer(saveStatus)
    },
  })
  const saves = () => calls.filter(({ init }) => init?.method === PUT)
  return { api, calls, saves }
}

type MountProps = { api: ReturnType<typeof serverWith>['api'] | null }

const mount = ({ api }: MountProps) => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const { result } = renderQueryHook({ client, hook: () => useCaptionStyle(api) })
  return { client, result }
}

describe('useCaptionStyle', () => {
  it("draws the stored look first, then the account's, and keeps that for next time", async () => {
    const { api } = serverWith()
    const { result } = mount({ api })
    expect(result.current.style).toEqual(DEFAULT_CAPTION_STYLE)
    await waitFor(() => expect(result.current.style).toEqual(LARGE_YELLOW))
    expect(usePlayerPrefs.getState().captionStyle).toEqual(LARGE_YELLOW)
  })

  it('draws the stored look when the server cannot be read', async () => {
    usePlayerPrefs.getState().setCaptionStyle(LARGE_YELLOW)
    const { api, calls } = serverWith({ readStatus: 500 })
    const { client, result } = mount({ api })
    await waitFor(() => expect(client.getQueryState(queryKeys.captionStyle)?.status).toBe('error'))
    expect(calls).toHaveLength(1)
    expect(result.current.style).toEqual(LARGE_YELLOW)
  })

  it('asks nothing without a server, and keeps a change on this device', async () => {
    usePlayerPrefs.getState().setCaptionStyle(LARGE_YELLOW)
    const { client, result } = mount({ api: null })
    expect(result.current.style).toEqual(LARGE_YELLOW)
    expect(client.getQueryState(queryKeys.captionStyle)?.fetchStatus).toBe('idle')
    act(() => result.current.change({ size: CAPTION_SIZES.small }))
    const changed = { ...LARGE_YELLOW, size: CAPTION_SIZES.small }
    await waitFor(() => expect(result.current.style).toEqual(changed))
    expect(usePlayerPrefs.getState().captionStyle).toEqual(changed)
  })

  it('saves a change merged into the look, shown before the server answers', async () => {
    const { api, saves } = serverWith()
    const { client, result } = mount({ api })
    await waitFor(() => expect(result.current.style).toEqual(LARGE_YELLOW))
    act(() => result.current.change({ colour: CAPTION_COLOURS.cyan }))
    const changed = { ...LARGE_YELLOW, colour: CAPTION_COLOURS.cyan }
    await waitFor(() => expect(result.current.style).toEqual(changed))
    await waitFor(() => expect(saves()).toHaveLength(1))
    expect(saves()[0]?.url).toBe('/api/caption-style')
    expect(JSON.parse(saves()[0]?.init?.body ?? 'null')).toEqual(changed)
    await waitFor(() => expect(client.isMutating()).toBe(0))
    expect(result.current.style).toEqual(changed)
    expect(usePlayerPrefs.getState().captionStyle).toEqual(changed)
  })

  it('shows and saves a change made before the first read answers', async () => {
    const gate = Promise.withResolvers<void>()
    const { api, calls, saves } = serverWith({ readGate: gate.promise })
    const { client, result } = mount({ api })
    await waitFor(() => expect(calls).toHaveLength(1))
    act(() => result.current.change({ colour: CAPTION_COLOURS.cyan }))
    const changed = { ...DEFAULT_CAPTION_STYLE, colour: CAPTION_COLOURS.cyan }
    await waitFor(() => expect(result.current.style).toEqual(changed))
    await waitFor(() => expect(saves()).toHaveLength(1))
    expect(JSON.parse(saves()[0]?.init?.body ?? 'null')).toEqual(changed)
    gate.resolve()
    await waitFor(() => expect(client.isMutating()).toBe(0))
    await waitFor(() => expect(client.isFetching()).toBe(0))
    expect(result.current.style).toEqual(changed)
    expect(usePlayerPrefs.getState().captionStyle).toEqual(changed)
  })

  it('shows a change made with the server out of reach, then puts the look back', async () => {
    usePlayerPrefs.getState().setCaptionStyle(LARGE_YELLOW)
    const { api } = serverWith({ readStatus: 500 })
    const { client, result } = mount({ api })
    await waitFor(() => expect(client.getQueryState(queryKeys.captionStyle)?.status).toBe('error'))
    const gate = Promise.withResolvers<void>()
    const held = spyOn(api, 'setCaptionStyle').mockImplementation(async () => {
      await gate.promise
      throw new Error('The server is away.')
    })
    act(() => result.current.change({ size: CAPTION_SIZES.small }))
    await waitFor(() =>
      expect(result.current.style).toEqual({ ...LARGE_YELLOW, size: CAPTION_SIZES.small }),
    )
    gate.resolve()
    await waitFor(() => expect(client.isMutating()).toBe(0))
    await waitFor(() => expect(result.current.style).toEqual(LARGE_YELLOW))
    expect(usePlayerPrefs.getState().captionStyle).toEqual(LARGE_YELLOW)
    held.mockRestore()
  })

  it('puts the look back when the server refuses the change', async () => {
    const { api, saves } = serverWith({ saveStatus: 500 })
    const { client, result } = mount({ api })
    await waitFor(() => expect(result.current.style).toEqual(LARGE_YELLOW))
    act(() => result.current.change({ size: CAPTION_SIZES.largest }))
    await waitFor(() => expect(saves()).toHaveLength(1))
    await waitFor(() => expect(client.isMutating()).toBe(0))
    await waitFor(() => expect(result.current.style).toEqual(LARGE_YELLOW))
    expect(usePlayerPrefs.getState().captionStyle).toEqual(LARGE_YELLOW)
  })
})
