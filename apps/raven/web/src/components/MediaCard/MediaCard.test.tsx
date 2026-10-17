import { beforeEach, describe, expect, it, spyOn } from 'bun:test'
import { cleanup, fireEvent, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { type PlaybackSettingsState, mediaLabel } from '@raven/core'
import { MediaCard } from '@/components/MediaCard/MediaCard'
import { api } from '@/lib/api'
import { setBrowserSupport, setStreamSupport } from '@/test/canPlay'
import { mediaItem } from '@/test/fixtures'
import { DEFAULT_PLAYBACK_STATE, renderWithProviders } from '@/test/render'
import { EPISODE_TWO } from '@/test/tv'

describe('MediaCard', () => {
  // Chrome's answers: Matroska and HEVC yes, Dolby audio no.
  beforeEach(() => setBrowserSupport((mime) => !mime.includes('ec-3') && !mime.includes('ac-3')))

  it('links to the player with the title, runtime and resolution', () => {
    renderWithProviders(<MediaCard media={mediaItem()} />)
    expect(screen.getByRole('link', { name: 'Busboys (2026)' })).toHaveAttribute('href', '/watch/7')
    expect(screen.getByText('1h 37m')).toBeInTheDocument()
    expect(screen.getByText('1080p')).toBeInTheDocument()
    expect(screen.queryByText("Won't play in this browser")).toBeNull()
  })

  it('is one link, to the player, for a video with no page of its own', () => {
    renderWithProviders(<MediaCard media={mediaItem()} />)
    expect(screen.getAllByRole('link')).toHaveLength(1)
  })

  it('plays from its picture, and opens the page of the episode it is from its title', () => {
    renderWithProviders(<MediaCard media={EPISODE_TWO} />)
    const label = mediaLabel(EPISODE_TWO)
    expect(screen.getByRole('link', { name: label })).toHaveAttribute(
      'href',
      '/episodes/7?library=2',
    )
    expect(screen.getByRole('link', { name: `Play ${label}` })).toHaveAttribute('href', '/watch/13')
  })

  it('shows the value its listing is sorted by, first', () => {
    renderWithProviders(<MediaCard media={mediaItem()} sort="largest" />)
    expect(screen.getByText('1.6 GB')).toBeInTheDocument()
  })

  it('says how long ago it was added when sorted by when videos were added', () => {
    const addedAt = new Date(Date.now() - 3 * 24 * 3600 * 1000).toISOString()
    renderWithProviders(<MediaCard media={mediaItem({ addedAt })} sort="added" />)
    expect(screen.getByText('Added 3 days ago')).toBeInTheDocument()
  })

  it('names the resolution once when sorted by it', () => {
    renderWithProviders(<MediaCard media={mediaItem()} sort="resolution-high" />)
    expect(screen.getAllByText('1080p')).toHaveLength(1)
  })

  it('warns before a click when the browser cannot decode the audio', () => {
    renderWithProviders(<MediaCard media={mediaItem({ audioCodec: 'eac3' })} />)
    expect(screen.getByText("Won't play in this browser")).toHaveAttribute(
      'title',
      "Dolby Digital Plus audio isn't supported here.",
    )
  })

  it('says nothing of a video the server converts for this browser', () => {
    setStreamSupport(() => true)
    renderWithProviders(<MediaCard media={mediaItem({ audioCodec: 'eac3' })} />)
    expect(screen.queryByText("Won't play in this browser")).toBeNull()
    expect(screen.queryByText('Converted on the server')).toBeNull()
  })

  it('says what the server’s playback settings make of it', () => {
    setStreamSupport(() => true)
    const off: PlaybackSettingsState = {
      ...DEFAULT_PLAYBACK_STATE,
      settings: { ...DEFAULT_PLAYBACK_STATE.settings, transcoding: 'off' },
    }
    renderWithProviders(<MediaCard media={mediaItem({ audioCodec: 'eac3' })} />, {
      playback: off,
    })
    expect(screen.getByText("Won't play in this browser")).toBeInTheDocument()
    expect(screen.queryByText('Converted on the server')).toBeNull()
  })

  it('says nothing about playing until the server’s playback settings are known', () => {
    const settings = spyOn(api, 'getPlaybackSettings').mockImplementation(
      () => new Promise(() => {}),
    )
    renderWithProviders(<MediaCard media={mediaItem({ audioCodec: 'eac3' })} />, {
      playback: null,
    })
    expect(screen.queryByText("Won't play in this browser")).toBeNull()
    expect(settings).toHaveBeenCalledTimes(1)
    settings.mockRestore()
  })

  it('offers Favourite and Delete from its menu', async () => {
    renderWithProviders(<MediaCard media={mediaItem()} />)
    await userEvent.click(screen.getByRole('button', { name: 'Options for Busboys (2026)' }))
    expect(screen.getByRole('menuitem', { name: 'Favourite' })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: 'Delete' })).toBeInTheDocument()
  })

  it('opens the same menu on a right click', () => {
    renderWithProviders(<MediaCard media={mediaItem()} />)
    fireEvent.contextMenu(screen.getByRole('link', { name: 'Busboys (2026)' }))
    expect(screen.getByRole('menu', { name: 'Options for Busboys (2026)' })).toBeInTheDocument()
  })

  it('marks a favourite and offers to remove it', async () => {
    renderWithProviders(<MediaCard media={mediaItem({ favourite: true })} />)
    expect(screen.getByText('Favourite')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Options for Busboys (2026)' }))
    expect(screen.getByRole('menuitem', { name: 'Remove favourite' })).toBeInTheDocument()
  })

  it('shows a placeholder until the thumbnail exists', () => {
    const { container } = renderWithProviders(
      <MediaCard media={mediaItem({ thumbnail: 'pending' })} />,
    )
    expect(container.querySelector('img')).toBeNull()
  })

  it('shows the check for a watched video and not for another', () => {
    renderWithProviders(<MediaCard media={mediaItem({ watched: true })} />)
    expect(screen.getByText('Watched')).toBeInTheDocument()
    cleanup()
    renderWithProviders(<MediaCard media={mediaItem()} />)
    expect(screen.queryByText('Watched')).toBeNull()
  })

  it('badges its resolution and HDR over the picture, and lists its codec and size', () => {
    renderWithProviders(<MediaCard media={mediaItem({ hdr: true })} />)
    expect(screen.getByLabelText('Video resolution: 1080p')).toHaveTextContent('1080p')
    expect(screen.getByLabelText('HDR')).toHaveTextContent('HDR')
    expect(screen.getByText('HEVC')).toBeInTheDocument()
    expect(screen.getByText('1.6 GB')).toBeInTheDocument()
  })

  it('says how long is left of a video partway through, and nothing of one not started', () => {
    renderWithProviders(<MediaCard media={mediaItem({ position: 1500 })} />)
    expect(screen.getByText('72 min left')).toBeInTheDocument()
    expect(screen.getByText('Partly watched')).toBeInTheDocument()
    cleanup()
    renderWithProviders(<MediaCard media={mediaItem()} />)
    expect(screen.queryByText(/min left/)).toBeNull()
  })

  it('draws the heart over the picture and says Favourite once, beside its facts', () => {
    const { container } = renderWithProviders(<MediaCard media={mediaItem({ favourite: true })} />)
    expect(screen.getAllByText('Favourite')).toHaveLength(1)
    const picture = container.querySelector('a[aria-hidden="true"]')
    expect(picture?.querySelector('svg')).not.toBeNull()
  })

  it('shows the check with the resume bar for a rewatch', () => {
    const { container } = renderWithProviders(
      <MediaCard media={mediaItem({ watched: true, position: 30, duration: 120 })} />,
    )
    expect(screen.getByText('Watched')).toBeInTheDocument()
    expect(container.querySelector('[style]')).toHaveStyle({ width: '25%' })
  })
})
