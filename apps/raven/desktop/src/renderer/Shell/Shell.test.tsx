import { describe, expect, it, jest, mock } from 'bun:test'
import { act, screen } from '@testing-library/react'
import { fakeClient, renderDesktop, STUB_ROUTES } from '@/renderer/test/render'

const ID_A = '11111111-1111-4111-8111-111111111111'
const ID_B = '22222222-2222-4222-8222-222222222222'
const ID_C = '33333333-3333-4333-8333-333333333333'

const dropOnWindow = (files: File[]) => {
  const event = new Event('drop', { cancelable: true })
  Object.defineProperty(event, 'dataTransfer', { value: { files } })
  act(() => {
    window.dispatchEvent(event)
  })
  return event
}

describe('Shell', () => {
  it('subscribes to events, then says it is ready', () => {
    const client = fakeClient()
    renderDesktop({ client, routes: STUB_ROUTES })
    expect(client.request).toHaveBeenCalledWith({ type: 'ready' })
    const subscribed = client.subscribe.mock.invocationCallOrder[0] ?? Infinity
    const readyAt = client.request.mock.calls.findIndex(([request]) => request.type === 'ready')
    const asked = client.request.mock.invocationCallOrder[readyAt] ?? 0
    expect(subscribed).toBeLessThan(asked)
  })

  it('plays what main opens, with its queue in the route state', async () => {
    const client = fakeClient()
    const { router } = renderDesktop({ client, routes: STUB_ROUTES })
    await client.emit({ type: 'play', target: { fileId: ID_A, queue: [] } })
    expect(router.state.location.pathname).toBe(`/play/${ID_A}`)
    expect(router.state.location.state).toEqual({ queue: [] })
  })

  it('replaces the play route when one is already playing, so Back returns Home', async () => {
    const client = fakeClient()
    const { router } = renderDesktop({ client, routes: STUB_ROUTES })
    await client.emit({ type: 'play', target: { fileId: ID_A, queue: [] } })
    await client.emit({ type: 'play', target: { fileId: ID_B, queue: [ID_C] } })
    expect(router.state.location.pathname).toBe(`/play/${ID_B}`)
    expect(router.state.location.state).toEqual({ queue: [ID_C] })
    await act(async () => {
      await router.navigate(-1)
    })
    expect(router.state.location.pathname).toBe('/')
  })

  it('goes where a navigate event says', async () => {
    const client = fakeClient()
    const { router } = renderDesktop({ client, routes: STUB_ROUTES })
    await client.emit({ type: 'navigate', to: 'settings' })
    expect(router.state.location.pathname).toBe('/settings')
    await client.emit({ type: 'navigate', to: 'home' })
    expect(router.state.location.pathname).toBe('/')
  })

  it('hands a menu action to the menu hub', async () => {
    const client = fakeClient()
    const { menu } = renderDesktop({ client, routes: STUB_ROUTES })
    const heard = mock(() => undefined)
    menu.subscribe(heard)
    await client.emit({ type: 'player', action: 'togglePlay' })
    expect(heard).toHaveBeenCalledWith('togglePlay')
  })

  it('shows a notice in a status region, then clears it after six seconds', async () => {
    jest.useFakeTimers()
    try {
      const client = fakeClient()
      renderDesktop({ client, routes: STUB_ROUTES })
      await client.emit({ type: 'notice', message: 'Opened from a link.' })
      expect(screen.getByRole('status')).toHaveTextContent('Opened from a link.')
      act(() => {
        jest.advanceTimersByTime(5999)
      })
      expect(screen.getByRole('status')).toBeInTheDocument()
      act(() => {
        jest.advanceTimersByTime(1)
      })
      expect(screen.queryByRole('status')).not.toBeInTheDocument()
    } finally {
      jest.useRealTimers()
    }
  })

  it('refetches the recents when they change', async () => {
    const client = fakeClient()
    const { queryClient } = renderDesktop({ client, routes: STUB_ROUTES })
    const invalidate = mock(queryClient.invalidateQueries.bind(queryClient))
    queryClient.invalidateQueries = invalidate
    await client.emit({ type: 'recentsChanged' })
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['desktop', 'recents'] })
  })

  it('sends dropped files in the order dropped and plays the reply', async () => {
    const dropFiles = mock(async (_files: readonly File[]) => ({
      type: 'play' as const,
      target: { fileId: ID_A, queue: [ID_B] },
    }))
    const client = fakeClient({ dropFiles })
    const { router } = renderDesktop({ client, routes: STUB_ROUTES })
    const first = new File(['1'], 'one.mkv')
    const second = new File(['2'], 'two.mkv')
    const event = dropOnWindow([first, second])
    expect(event.defaultPrevented).toBe(true)
    expect(dropFiles.mock.calls[0]?.[0]).toEqual([first, second])
    await act(async () => {})
    expect(router.state.location.pathname).toBe(`/play/${ID_A}`)
    expect(router.state.location.state).toEqual({ queue: [ID_B] })
  })

  it('shows a refused drop as a notice', async () => {
    const client = fakeClient({
      dropFiles: async () => ({ type: 'refused', message: 'Drop a video file to play it.' }),
    })
    renderDesktop({ client, routes: STUB_ROUTES })
    dropOnWindow([new File(['1'], 'notes.txt')])
    expect(await screen.findByRole('status')).toHaveTextContent('Drop a video file to play it.')
  })

  it('refuses the browser default for dragover', () => {
    renderDesktop({ client: fakeClient(), routes: STUB_ROUTES })
    const over = new Event('dragover', { cancelable: true })
    act(() => {
      window.dispatchEvent(over)
    })
    expect(over.defaultPrevented).toBe(true)
  })
})
