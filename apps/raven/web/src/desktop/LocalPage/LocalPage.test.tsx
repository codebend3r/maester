import { describe, expect, it } from 'bun:test'
import { DESKTOP_REPLIES, DESKTOP_REQUESTS, type DesktopReply, type RecentView } from '@raven/core'
import { Toaster } from '@raven/ui'
import { act, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Route, Routes } from 'react-router-dom'
import { LocalPage } from '@/desktop/LocalPage/LocalPage'
import { useDragging } from '@/stores/dragging'
import { Where, where } from '@/test/authPage'
import { asDesktop, fakeClient, FILE_ID, RECENT_ID, sentOfType } from '@/test/desktop'
import { renderWithProviders } from '@/test/render'

const RECENT: RecentView = {
  recentId: RECENT_ID,
  label: 'Holiday.mkv',
  from: 'Movies',
  watched: 0.25,
}

const PLAY: DesktopReply = { type: DESKTOP_REPLIES.play, target: { fileId: FILE_ID, queue: [] } }

/** Main with `recents` until they are cleared or removed, and `answers` for the rest. */
const localMain = ({
  recents = [RECENT],
  answers = {},
}: {
  recents?: RecentView[]
  answers?: Partial<Record<string, DesktopReply>>
} = {}) => {
  const state = { recents }
  return fakeClient({
    request: async (request) => {
      const answer = answers[request.type]
      if (answer !== undefined) return answer
      switch (request.type) {
        case DESKTOP_REQUESTS.listRecents:
          return { type: DESKTOP_REPLIES.recents, recents: state.recents }
        case DESKTOP_REQUESTS.removeRecent:
        case DESKTOP_REQUESTS.clearRecents:
          state.recents = []
          return { type: DESKTOP_REPLIES.done }
        default:
          return PLAY
      }
    },
  })
}

const renderPage = (client = localMain()) => {
  asDesktop(client)
  renderWithProviders({
    route: '/local',
    ui: (
      <>
        <Routes>
          <Route path="/local" element={<LocalPage />} />
          <Route path="*" element={<Where />} />
        </Routes>
        <Toaster />
      </>
    ),
  })
  return client
}

describe('LocalPage', () => {
  it('plays a video chosen from this Mac', async () => {
    const client = renderPage()
    await userEvent.click(screen.getByRole('button', { name: 'Choose a video' }))
    await waitFor(() => expect(where()).toBe(`/play/${FILE_ID}`))
    expect(sentOfType({ client, type: DESKTOP_REQUESTS.openDialog })).toHaveLength(1)
  })

  it('shows where to drop a video, and lights up while one is dragged over', () => {
    renderPage()
    expect(
      screen.getByRole('heading', { name: 'Drop a video anywhere in this window' }),
    ).toBeInTheDocument()
    act(() => useDragging.setState({ isDragging: true }))
    expect(screen.getByRole('heading', { name: 'Drop to play' })).toBeInTheDocument()
  })

  it('lists the recent videos with how far they were watched, and plays one', async () => {
    const client = renderPage()
    expect(await screen.findByRole('progressbar', { name: '25% watched' })).toBeInTheDocument()
    expect(screen.getByText('Movies')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /^Holiday\.mkv/ }))
    await waitFor(() => expect(where()).toBe(`/play/${FILE_ID}`))
    expect(sentOfType({ client, type: DESKTOP_REQUESTS.openRecent })).toEqual([
      { type: DESKTOP_REQUESTS.openRecent, recentId: RECENT_ID },
    ])
  })

  it('removes one recent, or clears them all', async () => {
    renderPage()
    await userEvent.click(
      await screen.findByRole('button', { name: 'Remove Holiday.mkv from recents' }),
    )
    expect(await screen.findByText('Nothing opened yet.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Clear recents' })).toBeNull()
  })

  it('clears the recents and says so', async () => {
    renderPage()
    await userEvent.click(await screen.findByRole('button', { name: 'Clear recents' }))
    expect(await screen.findByText('Recents cleared.')).toBeInTheDocument()
    expect(screen.getByText('Nothing opened yet.')).toBeInTheDocument()
  })

  it("says main's refusals", async () => {
    renderPage(
      localMain({
        answers: {
          clearRecents: { type: DESKTOP_REPLIES.refused, message: 'Could not clear.' },
          openRecent: { type: DESKTOP_REPLIES.refused, message: 'That file is gone.' },
        },
      }),
    )
    await userEvent.click(await screen.findByRole('button', { name: 'Clear recents' }))
    expect(await screen.findByText('Could not clear.')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /^Holiday\.mkv/ }))
    expect(await screen.findByText('That file is gone.')).toBeInTheDocument()
  })

  it('says why the recents could not be listed', async () => {
    renderPage(localMain({ answers: { listRecents: { type: DESKTOP_REPLIES.done } } }))
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'raven player could not list your recent videos.',
    )
  })
})
