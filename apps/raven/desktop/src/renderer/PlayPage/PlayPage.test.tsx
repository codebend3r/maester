import { describe, expect, it } from 'bun:test'
import { act, fireEvent, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { NavigationType } from 'react-router-dom'
import { fakeClient, renderDesktop } from '@/renderer/test/render'
import type { DesktopReply, DesktopRequest, LocalFile } from '@/shared/protocol'

const A = '11111111-1111-4111-8111-111111111111'
const B = '22222222-2222-4222-8222-222222222222'

const CLIP_A: LocalFile = {
  fileId: A,
  label: 'Clip 01',
  folder: 'Clips',
  resumeAt: 0,
  next: { fileId: B, label: 'Clip 02', queue: [] },
}
const CLIP_B: LocalFile = { fileId: B, label: 'Clip 02', folder: 'Clips', resumeAt: 0, next: null }

const describing =
  (reply: (fileId: string) => DesktopReply) =>
  async (request: DesktopRequest): Promise<DesktopReply> => {
    if (request.type === 'describeFile') return reply(request.fileId)
    if (request.type === 'listRecents') return { type: 'recents', recents: [] }
    return { type: 'done' }
  }

const clips = describing((fileId) => ({ type: 'file', file: fileId === A ? CLIP_A : CLIP_B }))

const videoElement = async () => {
  await screen.findByRole('heading', { name: 'Clip 01' })
  const video = document.querySelector('video')
  if (video === null) throw new Error('no video element')
  return video
}

describe('PlayPage', () => {
  it('plays the granted file through raven-file', async () => {
    renderDesktop({ client: fakeClient({ request: clips }), route: `/play/${A}` })
    const video = await videoElement()
    expect(video.getAttribute('src')).toBe(`raven-file://${A}`)
  })

  it('asks main to describe the file with its queue', async () => {
    const client = fakeClient({ request: clips })
    renderDesktop({ client, route: `/play/${A}` })
    await videoElement()
    expect(client.request).toHaveBeenCalledWith({ type: 'describeFile', fileId: A, queue: [] })
  })

  it('says where it resumed', async () => {
    const client = fakeClient({
      request: describing(() => ({ type: 'file', file: { ...CLIP_A, resumeAt: 65 } })),
    })
    renderDesktop({ client, route: `/play/${A}` })
    await videoElement()
    expect(screen.getByText('Resumed at 1:05')).toBeInTheDocument()
  })

  it('links the next video', async () => {
    renderDesktop({ client: fakeClient({ request: clips }), route: `/play/${A}` })
    await videoElement()
    expect(screen.getByRole('link', { name: 'Next: Clip 02' })).toHaveAttribute(
      'href',
      `/play/${B}`,
    )
  })

  it('goes Home from Back', async () => {
    const { router } = renderDesktop({
      client: fakeClient({ request: clips }),
      route: `/play/${A}`,
    })
    await videoElement()
    await userEvent.click(screen.getByRole('button', { name: 'Back' }))
    await waitFor(() => expect(router.state.location.pathname).toBe('/'))
  })

  it('replaces the entry with the next video when the menu says next', async () => {
    const { router, menu } = renderDesktop({
      client: fakeClient({ request: clips }),
      route: `/play/${A}`,
    })
    await videoElement()
    await act(async () => menu.emit('next'))
    await waitFor(() => expect(router.state.location.pathname).toBe(`/play/${B}`))
    expect(router.state.historyAction).toBe(NavigationType.Replace)
    await screen.findByRole('heading', { name: 'Clip 02' })
  })

  it('does nothing for the menu next when no video follows', async () => {
    const { router, menu } = renderDesktop({
      client: fakeClient({ request: clips }),
      route: `/play/${B}`,
    })
    await screen.findByRole('heading', { name: 'Clip 02' })
    act(() => menu.emit('next'))
    expect(router.state.location.pathname).toBe(`/play/${B}`)
  })

  it('saves the position of the video it leaves before it asks about the next', async () => {
    const client = fakeClient({ request: clips })
    const { router } = renderDesktop({ client, route: `/play/${A}` })
    const video = await videoElement()
    fireEvent(video, new Event('playing'))
    await act(() => router.navigate(`/play/${B}`))
    await screen.findByRole('heading', { name: 'Clip 02' })
    const sent = client.request.mock.calls.map(([request]) => request)
    const saved = sent.findIndex(
      (request) => request.type === 'savePosition' && request.fileId === A,
    )
    const described = sent.findIndex(
      (request) => request.type === 'describeFile' && request.fileId === B,
    )
    expect(saved).toBeGreaterThan(-1)
    expect(described).toBeGreaterThan(saved)
  })

  it('names the page it shows while main describes the file', async () => {
    const pending = Promise.withResolvers<DesktopReply>()
    const client = fakeClient({
      request: async (request) =>
        request.type === 'describeFile' ? pending.promise : { type: 'done' },
    })
    renderDesktop({ client, route: `/play/${A}` })
    const waiting = await screen.findByRole('main', { name: 'Opening video' })
    expect(waiting).toHaveAttribute('aria-busy', 'true')
    await act(async () => pending.resolve({ type: 'file', file: CLIP_A }))
  })

  it('says why a video cannot be opened and goes Home', async () => {
    const client = fakeClient({
      request: describing(() => ({ type: 'refused', message: 'That video is gone.' })),
    })
    const { router } = renderDesktop({ client, route: `/play/${A}` })
    expect(
      await screen.findByRole('heading', { name: "This video can't be opened" }),
    ).toBeInTheDocument()
    expect(screen.getByText('That video is gone.')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Home' }))
    await waitFor(() => expect(router.state.location.pathname).toBe('/'))
  })

  it('asks main with an empty queue when the location state is malformed', async () => {
    const client = fakeClient({ request: clips })
    renderDesktop({ client, route: `/play/${A}`, state: { queue: ['../x'] } })
    await videoElement()
    expect(client.request).toHaveBeenCalledWith({ type: 'describeFile', fileId: A, queue: [] })
  })

  it('refuses an id that is not an opaque id without asking main', async () => {
    const client = fakeClient({ request: clips })
    renderDesktop({ client, route: '/play/not-an-id' })
    expect(
      await screen.findByRole('heading', { name: "This video can't be opened" }),
    ).toBeInTheDocument()
    expect(client.request.mock.calls.some(([request]) => request.type === 'describeFile')).toBe(
      false,
    )
  })
})
