import { beforeEach, describe, expect, it, spyOn } from 'bun:test'
import { fireEvent, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { PlaybackSettingsState } from '@raven/core'
import { MediaCard } from '@/components/MediaCard/MediaCard'
import { api } from '@/lib/api'
import { setBrowserSupport, setStreamSupport } from '@/test/canPlay'
import { mediaItem } from '@/test/fixtures'
import { DEFAULT_PLAYBACK_STATE, renderWithProviders } from '@/test/render'

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

  it('warns before a click when the browser cannot decode the audio', () => {
    renderWithProviders(<MediaCard media={mediaItem({ audioCodec: 'eac3' })} />)
    expect(screen.getByText("Won't play in this browser")).toHaveAttribute(
      'title',
      "Dolby Digital Plus audio isn't supported here.",
    )
  })

  it('says the server converts what the browser cannot decode but can stream', () => {
    setStreamSupport(() => true)
    renderWithProviders(<MediaCard media={mediaItem({ audioCodec: 'eac3' })} />)
    expect(screen.queryByText("Won't play in this browser")).toBeNull()
    expect(screen.getByText('Converted on the server')).toHaveAttribute(
      'title',
      "Dolby Digital Plus audio isn't supported here.",
    )
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
})
