import { describe, expect, it, jest, mock, spyOn } from 'bun:test'
import { act, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { NavigationType } from 'react-router-dom'
import { fakeClient, renderDesktop, STUB_ROUTES } from '@/renderer/test/render'

const ID_A = '11111111-1111-4111-8111-111111111111'
const ID_B = '22222222-2222-4222-8222-222222222222'
const ID_C = '33333333-3333-4333-8333-333333333333'

// Home lists the recents as soon as it mounts; wait for that, so no update lands after the test.
const settled = () => screen.findByText('Nothing opened yet.')

const dropOnWindow = (files: File[]) => {
  const event = new Event('drop', { cancelable: true })
  Object.defineProperty(event, 'dataTransfer', { value: { files } })
  act(() => {
    window.dispatchEvent(event)
  })
  return event
}

describe('Shell', () => {
  it('subscribes to events, then says it is ready', async () => {
    const client = fakeClient()
    renderDesktop({ client, routes: STUB_ROUTES })
    await settled()
    expect(client.request).toHaveBeenCalledWith({ type: 'ready' })
    const subscribed = client.subscribe.mock.invocationCallOrder[0] ?? Infinity
    const readyAt = client.request.mock.calls.findIndex(([request]) => request.type === 'ready')
    const asked = client.request.mock.invocationCallOrder[readyAt] ?? 0
    expect(subscribed).toBeLessThan(asked)
  })

  it('says ready once, even when StrictMode runs its effects twice', async () => {
    const client = fakeClient()
    renderDesktop({ client, routes: STUB_ROUTES, isStrict: true })
    await settled()
    const ready = client.request.mock.calls.filter(([request]) => request.type === 'ready')
    expect(ready).toHaveLength(1)
    expect(client.subscribe).toHaveBeenCalledTimes(2)
  })

  it('plays what main opens, with its queue in the route state', async () => {
    const client = fakeClient()
    const { router } = renderDesktop({ client, routes: STUB_ROUTES })
    await settled()
    await client.emit({ type: 'play', target: { fileId: ID_A, queue: [] } })
    expect(router.state.location.pathname).toBe(`/play/${ID_A}`)
    expect(router.state.location.state).toEqual({ queue: [] })
  })

  it('replaces the play route when one is already playing, so Back returns Home', async () => {
    const client = fakeClient()
    const { router } = renderDesktop({ client, routes: STUB_ROUTES })
    await settled()
    await client.emit({ type: 'play', target: { fileId: ID_A, queue: [] } })
    await client.emit({ type: 'play', target: { fileId: ID_B, queue: [ID_C] } })
    expect(router.state.location.pathname).toBe(`/play/${ID_B}`)
    expect(router.state.location.state).toEqual({ queue: [ID_C] })
    await act(async () => {
      await router.navigate(-1)
    })
    expect(router.state.location.pathname).toBe('/')
  })

  it('plays a server title main opens, with its start and queue in the route state', async () => {
    const client = fakeClient()
    const { router } = renderDesktop({ client, routes: STUB_ROUTES })
    await settled()
    await client.emit({
      type: 'playServer',
      target: { serverId: ID_A, mediaId: 7, at: 30, next: [8, 9] },
    })
    expect(router.state.location.pathname).toBe(`/server/${ID_A}/7`)
    expect(router.state.location.state).toEqual({ at: 30, next: [8, 9] })
  })

  it('replaces whatever plays with a server title, and a server title with a file, so Back returns Home', async () => {
    const client = fakeClient()
    const { router } = renderDesktop({ client, routes: STUB_ROUTES })
    await settled()
    await client.emit({ type: 'play', target: { fileId: ID_A, queue: [] } })
    await client.emit({
      type: 'playServer',
      target: { serverId: ID_B, mediaId: 7, at: 0, next: [] },
    })
    await client.emit({
      type: 'playServer',
      target: { serverId: ID_B, mediaId: 8, at: 0, next: [] },
    })
    expect(router.state.location.pathname).toBe(`/server/${ID_B}/8`)
    await client.emit({ type: 'play', target: { fileId: ID_C, queue: [] } })
    expect(router.state.location.pathname).toBe(`/play/${ID_C}`)
    await act(async () => {
      await router.navigate(-1)
    })
    expect(router.state.location.pathname).toBe('/')
  })

  it('replaces a playing file with a server title, its start and next in the route state', async () => {
    const client = fakeClient()
    const { router } = renderDesktop({
      client,
      routes: STUB_ROUTES,
      route: `/play/${ID_A}`,
      state: { queue: [] },
    })
    await screen.findByText('Playing')
    await client.emit({
      type: 'playServer',
      target: { serverId: ID_C, mediaId: 7, at: 30, next: [8] },
    })
    expect(router.state.location.pathname).toBe(`/server/${ID_C}/7`)
    expect(router.state.location.state).toEqual({ at: 30, next: [8] })
    expect(router.state.historyAction).toBe(NavigationType.Replace)
  })

  it('plays a server title from a reply main gives a drop', async () => {
    const client = fakeClient({
      dropFiles: async () => ({
        type: 'playServer',
        target: { serverId: ID_A, mediaId: 7, at: 0, next: [] },
      }),
    })
    const { router } = renderDesktop({ client, routes: STUB_ROUTES })
    await settled()
    dropOnWindow([new File(['1'], 'one.mkv')])
    await act(async () => {})
    expect(router.state.location.pathname).toBe(`/server/${ID_A}/7`)
    expect(router.state.location.state).toEqual({ at: 0, next: [] })
  })

  it('goes where a navigate event says', async () => {
    const client = fakeClient()
    const { router } = renderDesktop({ client, routes: STUB_ROUTES })
    await settled()
    await client.emit({ type: 'navigate', to: 'settings' })
    expect(router.state.location.pathname).toBe('/settings')
  })

  it('hands a menu action to the menu hub', async () => {
    const client = fakeClient()
    const { menu } = renderDesktop({ client, routes: STUB_ROUTES })
    await settled()
    const heard = mock(() => undefined)
    menu.subscribe(heard)
    await client.emit({ type: 'player', action: 'togglePlay' })
    expect(heard).toHaveBeenCalledWith('togglePlay')
  })

  it('shows a notice in a status region, then clears it after six seconds', async () => {
    const client = fakeClient()
    renderDesktop({ client, routes: STUB_ROUTES })
    await settled()
    expect(screen.getByRole('status')).toBeEmptyDOMElement()
    jest.useFakeTimers()
    try {
      await client.emit({ type: 'notice', message: 'Opened from a link.' })
      expect(screen.getByRole('status')).toHaveTextContent('Opened from a link.')
      act(() => {
        jest.advanceTimersByTime(5999)
      })
      expect(screen.getByRole('status')).toBeInTheDocument()
      act(() => {
        jest.advanceTimersByTime(1)
      })
      expect(screen.getByRole('status')).toBeEmptyDOMElement()
    } finally {
      jest.useRealTimers()
    }
  })

  it('sends dropped files in the order dropped and plays the reply', async () => {
    const dropFiles = mock(async (_files: readonly File[]) => ({
      type: 'play' as const,
      target: { fileId: ID_A, queue: [ID_B] },
    }))
    const client = fakeClient({ dropFiles })
    const { router } = renderDesktop({ client, routes: STUB_ROUTES })
    await settled()
    const first = new File(['1'], 'one.mkv')
    const second = new File(['2'], 'two.mkv')
    const event = dropOnWindow([first, second])
    expect(event.defaultPrevented).toBe(true)
    expect(dropFiles.mock.calls[0]![0]).toEqual([first, second])
    await act(async () => {})
    expect(router.state.location.pathname).toBe(`/play/${ID_A}`)
    expect(router.state.location.state).toEqual({ queue: [ID_B] })
  })

  it('shows a refused drop as a notice', async () => {
    const client = fakeClient({
      dropFiles: async () => ({ type: 'refused', message: 'Drop a video file to play it.' }),
    })
    renderDesktop({ client, routes: STUB_ROUTES })
    await settled()
    dropOnWindow([new File(['1'], 'notes.txt')])
    expect(await screen.findByRole('status')).toHaveTextContent('Drop a video file to play it.')
  })

  describe('the update notice', () => {
    const update = () => screen.queryByRole('complementary', { name: 'Update' })

    it('shows a newer release on Home', async () => {
      const client = fakeClient()
      renderDesktop({ client, routes: STUB_ROUTES })
      await settled()
      expect(update()).toBeNull()
      await client.emit({ type: 'updateAvailable', version: '0.6.0' })
      expect(update()).toHaveTextContent('raven player 0.6.0 is out.')
    })

    it('waits on a watch route and shows on returning Home', async () => {
      const client = fakeClient()
      const { router } = renderDesktop({ client, routes: STUB_ROUTES, route: '/play/f1' })
      await screen.findByText('Playing')
      await client.emit({ type: 'updateAvailable', version: '0.6.0' })
      expect(update()).toBeNull()
      await act(async () => {
        await router.navigate('/')
      })
      await settled()
      expect(update()).toHaveTextContent('raven player 0.6.0 is out.')
    })

    it('shows on Settings too', async () => {
      const client = fakeClient()
      renderDesktop({ client, routes: STUB_ROUTES, route: '/settings' })
      await screen.findByText('Settings page')
      await client.emit({ type: 'updateAvailable', version: '0.6.0' })
      expect(update()).toHaveTextContent('raven player 0.6.0 is out.')
    })

    it('stays hidden for the session once dismissed', async () => {
      const client = fakeClient()
      const { router } = renderDesktop({ client, routes: STUB_ROUTES })
      await settled()
      await client.emit({ type: 'updateAvailable', version: '0.6.0' })
      const notice = update()
      if (notice === null) throw new Error('no update notice')
      await userEvent.click(within(notice).getByRole('button', { name: 'Dismiss' }))
      expect(update()).toBeNull()
      expect(screen.getByRole('heading', { name: 'raven player' })).toHaveFocus()
      await act(async () => {
        await router.navigate('/settings')
      })
      await act(async () => {
        await router.navigate('/')
      })
      await settled()
      expect(update()).toBeNull()
    })

    it("sends openRelease and hides on See what's new", async () => {
      const client = fakeClient()
      renderDesktop({ client, routes: STUB_ROUTES })
      await settled()
      await client.emit({ type: 'updateAvailable', version: '0.6.0' })
      const notice = update()
      if (notice === null) throw new Error('no update notice')
      await userEvent.click(within(notice).getByRole('button', { name: "See what's new" }))
      expect(client.request).toHaveBeenCalledWith({ type: 'openRelease' })
      await waitFor(() => expect(update()).toBeNull())
      expect(screen.getByRole('heading', { name: 'raven player' })).toHaveFocus()
    })

    it('comes after the page, in a row of its own', async () => {
      const client = fakeClient()
      renderDesktop({ client, routes: STUB_ROUTES })
      await settled()
      await client.emit({ type: 'updateAvailable', version: '0.6.0' })
      const notice = update()
      if (notice === null) throw new Error('no update notice')
      const home = screen.getByRole('main', { name: 'raven player' })
      expect(home.compareDocumentPosition(notice) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
      expect(home.contains(notice)).toBe(false)
    })

    it('pads the scroll by its height while shown, so Tab never lands behind it', async () => {
      const observers: Array<{ resize: () => void; isLive: boolean }> = []
      class FakeResizeObserver implements ResizeObserver {
        readonly #entry: { resize: () => void; isLive: boolean }
        constructor(callback: ResizeObserverCallback) {
          this.#entry = { resize: () => callback([], this), isLive: true }
          observers.push(this.#entry)
        }
        observe() {}
        unobserve() {}
        disconnect() {
          this.#entry.isLive = false
        }
      }
      const original = globalThis.ResizeObserver
      globalThis.ResizeObserver = FakeResizeObserver
      const root = document.documentElement
      const resize = () =>
        act(() => {
          observers.filter(({ isLive }) => isLive).forEach((observer) => observer.resize())
        })
      try {
        const client = fakeClient()
        renderDesktop({ client, routes: STUB_ROUTES })
        await settled()
        expect(root.style.scrollPaddingBlockEnd).toBe('')
        await client.emit({ type: 'updateAvailable', version: '0.6.0' })
        const layer = update()?.parentElement ?? null
        if (layer === null) throw new Error('no update layer')
        const height = { now: 96 }
        spyOn(layer, 'getBoundingClientRect').mockImplementation(
          () => new DOMRect(0, 0, 320, height.now),
        )
        resize()
        expect(root.style.scrollPaddingBlockEnd).toBe('96px')
        height.now = 140
        resize()
        expect(root.style.scrollPaddingBlockEnd).toBe('140px')
        const notice = update()
        if (notice === null) throw new Error('no update notice')
        await userEvent.click(within(notice).getByRole('button', { name: 'Dismiss' }))
        expect(root.style.scrollPaddingBlockEnd).toBe('')
        expect(observers.filter(({ isLive }) => isLive)).toHaveLength(0)
      } finally {
        globalThis.ResizeObserver = original
        root.style.scrollPaddingBlockEnd = ''
      }
    })

    it('says why main could not open the release page', async () => {
      const client = fakeClient({
        request: async (asked) => {
          if (asked.type === 'listRecents') return { type: 'recents', recents: [] }
          if (asked.type === 'openRelease') {
            return { type: 'refused', message: 'raven player has not found a newer release.' }
          }
          return { type: 'done' }
        },
      })
      renderDesktop({ client, routes: STUB_ROUTES })
      await settled()
      await client.emit({ type: 'updateAvailable', version: '0.6.0' })
      const notice = update()
      if (notice === null) throw new Error('no update notice')
      await userEvent.click(within(notice).getByRole('button', { name: "See what's new" }))
      await waitFor(() =>
        expect(screen.getByRole('status')).toHaveTextContent(
          'raven player has not found a newer release.',
        ),
      )
    })
  })

  it('refuses the browser default for dragover', async () => {
    renderDesktop({ client: fakeClient(), routes: STUB_ROUTES })
    await settled()
    const over = new Event('dragover', { cancelable: true })
    act(() => {
      window.dispatchEvent(over)
    })
    expect(over.defaultPrevented).toBe(true)
  })
})
