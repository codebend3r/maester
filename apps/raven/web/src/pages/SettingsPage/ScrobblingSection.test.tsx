import { afterEach, describe, expect, it, mock, spyOn } from 'bun:test'
import { cleanup, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ApiError, SCROBBLE_RETURNS, SCROBBLE_SERVICES, type ScrobbleStatus } from '@raven/core'
import { Route, Routes, useLocation } from 'react-router-dom'
import { api } from '@/lib/api'
import { ScrobblingSection } from '@/pages/SettingsPage/ScrobblingSection'
import { readyConfig } from '@/test/authClient'
import { renderWithProviders } from '@/test/render'

type StatusesProps = { listenBrainz?: string | null; isLastFmAvailable?: boolean }

const statuses = ({
  listenBrainz = null,
  isLastFmAvailable = true,
}: StatusesProps = {}): ScrobbleStatus[] => [
  { service: SCROBBLE_SERVICES.listenBrainz, isAvailable: true, username: listenBrainz },
  { service: SCROBBLE_SERVICES.lastFm, isAvailable: isLastFmAvailable, username: null },
]

/** Where the page now is, so a test sees the query cleared. */
const Address = () => {
  const location = useLocation()
  return <p data-testid="address">{`${location.pathname}${location.search}`}</p>
}

type RenderSectionProps = { route?: string }

const renderSection = ({ route = '/settings' }: RenderSectionProps = {}) =>
  renderWithProviders({
    ui: (
      <Routes>
        <Route
          path="/settings"
          element={
            <>
              <ScrobblingSection />
              <Address />
            </>
          }
        />
      </Routes>
    ),
    route,
    authConfig: readyConfig,
  })

const region = () => screen.getByRole('region', { name: 'Scrobbling' })

describe('ScrobblingSection', () => {
  afterEach(() => {
    cleanup()
    mock.restore()
  })

  it("says Last.fm isn't set up when the server has no Last.fm keys", async () => {
    spyOn(api, 'getScrobbling').mockResolvedValue(statuses({ isLastFmAvailable: false }))
    renderSection()
    expect(await screen.findByText("Last.fm isn't set up on this server")).toBeInTheDocument()
    expect(within(region()).queryByRole('button', { name: 'Connect' })).toBeNull()
  })

  it('shows a linked ListenBrainz by its username, and unlinks it', async () => {
    spyOn(api, 'getScrobbling').mockResolvedValue(statuses({ listenBrainz: 'rob' }))
    const unlink = spyOn(api, 'unlinkScrobbling').mockResolvedValue(statuses())
    renderSection()
    expect(await screen.findByText('Linked as rob')).toBeInTheDocument()
    expect(screen.queryByLabelText('User token')).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: 'Unlink ListenBrainz' }))
    expect(unlink).toHaveBeenCalledWith({ service: SCROBBLE_SERVICES.listenBrainz })
    expect(await screen.findByLabelText('User token')).toBeInTheDocument()
  })

  it('links ListenBrainz with a token it never shows, clearing the field after', async () => {
    spyOn(api, 'getScrobbling').mockResolvedValue(statuses())
    const link = spyOn(api, 'linkListenBrainz').mockResolvedValue(statuses({ listenBrainz: 'rob' }))
    const { client } = renderSection()
    const token = await screen.findByLabelText('User token')
    expect(token).toHaveAttribute('type', 'password')
    await userEvent.type(token, 'abc-123')
    await userEvent.click(screen.getByRole('button', { name: 'Link' }))
    expect(link).toHaveBeenCalledWith({ token: 'abc-123' })
    expect(await screen.findByText('Linked as rob')).toBeInTheDocument()
    expect(screen.queryByDisplayValue('abc-123')).toBeNull()
    await waitFor(() => expect(client.getMutationCache().getAll()).toEqual([]))
  })

  it("shows the server's reason when a token is refused, and clears the field", async () => {
    spyOn(api, 'getScrobbling').mockResolvedValue(statuses())
    spyOn(api, 'linkListenBrainz').mockRejectedValue(
      new ApiError({ status: 400, message: 'ListenBrainz does not know this token.' }),
    )
    renderSection()
    const token = await screen.findByLabelText('User token')
    await userEvent.type(token, 'nope')
    await userEvent.click(screen.getByRole('button', { name: 'Link' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Could not link: ListenBrainz does not know this token.',
    )
    expect(token).toHaveValue('')
  })

  it("starts Last.fm's sign-in, coming back to the web's Settings the server knows", async () => {
    spyOn(api, 'getScrobbling').mockResolvedValue(statuses())
    const start = spyOn(api, 'startLastFm').mockResolvedValue({
      url: 'https://www.last.fm/api/auth?api_key=k',
    })
    const assign = spyOn(window.location, 'assign').mockImplementation(() => undefined)
    renderSection()
    await userEvent.click(await screen.findByRole('button', { name: 'Connect' }))
    expect(start).toHaveBeenCalledWith({ returnTo: SCROBBLE_RETURNS.web })
    await waitFor(() =>
      expect(assign).toHaveBeenCalledWith('https://www.last.fm/api/auth?api_key=k'),
    )
  })

  it('says how the Last.fm sign-in went, then clears it from the address', async () => {
    spyOn(api, 'getScrobbling').mockResolvedValue(statuses())
    renderSection({ route: '/settings?scrobbling=linked' })
    expect(await screen.findByRole('status')).toHaveTextContent('Last.fm is linked.')
    await waitFor(() => expect(screen.getByTestId('address')).toHaveTextContent(/^\/settings$/))
    expect(screen.getByRole('status')).toHaveTextContent('Last.fm is linked.')
  })

  it('says when the Last.fm sign-in failed', async () => {
    spyOn(api, 'getScrobbling').mockResolvedValue(statuses())
    renderSection({ route: '/settings?scrobbling=failed' })
    expect(await screen.findByRole('status')).toHaveTextContent(
      'Last.fm could not be linked. Try again.',
    )
  })
})
