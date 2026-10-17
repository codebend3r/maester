import { afterEach, describe, expect, it, spyOn } from 'bun:test'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { usePlayerPrefs } from '@raven/ui'
import { DownloadButton } from '@/components/DownloadButton/DownloadButton'
import { ravenPlayer } from '@/lib/ravenPlayer'

describe('DownloadButton', () => {
  const open = spyOn(ravenPlayer, 'open').mockImplementation(() => {})

  afterEach(() => {
    open.mockClear()
    usePlayerPrefs.setState({ opensInRavenPlayer: false })
  })

  it('renders nothing while this browser does not open videos in raven player', () => {
    const { container } = render(
      <DownloadButton target={{ kind: 'saga', libraryId: 2, tmdbId: '119' }} />,
    )
    expect(container).toBeEmptyDOMElement()
  })

  it('takes the class that gives it a whole row where the header breaks its actions into cells', () => {
    usePlayerPrefs.setState({ opensInRavenPlayer: true })
    render(<DownloadButton target={{ kind: 'saga', libraryId: 2, tmdbId: '119' }} />)
    expect(screen.getByRole('button', { name: 'Download to raven player' }).className).toMatch(
      /download/u,
    )
  })

  it('opens the saga download link in raven player when pressed', async () => {
    usePlayerPrefs.setState({ opensInRavenPlayer: true })
    render(<DownloadButton target={{ kind: 'saga', libraryId: 2, tmdbId: '119' }} />)
    await userEvent.click(screen.getByRole('button', { name: 'Download to raven player' }))
    expect(open).toHaveBeenCalledTimes(1)
    expect(open).toHaveBeenCalledWith(
      `raven://download?server=${encodeURIComponent(window.location.origin)}&saga=2%3A119`,
    )
  })
})
