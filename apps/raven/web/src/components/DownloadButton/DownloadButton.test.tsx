import { afterEach, describe, expect, it, spyOn } from 'bun:test'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { DOWNLOAD_TARGET_KINDS } from '@raven/core'
import { usePlayerPrefs } from '@raven/ui/headless'
import { DownloadButton } from '@/components/DownloadButton/DownloadButton'
import { ravenPlayer } from '@/lib/ravenPlayer'

describe('DownloadButton', () => {
  const open = spyOn(ravenPlayer, 'open').mockImplementation(() => {})

  afterEach(() => {
    open.mockClear()
  })

  it('renders nothing while this browser does not open videos in raven player', () => {
    const { container } = render(
      <DownloadButton target={{ kind: DOWNLOAD_TARGET_KINDS.saga, libraryId: 2, tmdbId: '119' }} />,
    )
    expect(container).toBeEmptyDOMElement()
  })

  it('marks itself wide, so the header makes room for its label', () => {
    usePlayerPrefs.setState({ opensInRavenPlayer: true })
    render(
      <DownloadButton target={{ kind: DOWNLOAD_TARGET_KINDS.saga, libraryId: 2, tmdbId: '119' }} />,
    )
    expect(screen.getByRole('button', { name: 'Download to raven player' })).toHaveAttribute(
      'data-wide',
    )
  })

  it('opens the saga download link in raven player when pressed', async () => {
    usePlayerPrefs.setState({ opensInRavenPlayer: true })
    render(
      <DownloadButton target={{ kind: DOWNLOAD_TARGET_KINDS.saga, libraryId: 2, tmdbId: '119' }} />,
    )
    await userEvent.click(screen.getByRole('button', { name: 'Download to raven player' }))
    expect(open).toHaveBeenCalledTimes(1)
    expect(open).toHaveBeenCalledWith(
      `raven://download?server=${encodeURIComponent(window.location.origin)}&saga=2%3A119`,
    )
  })
})
