import { beforeEach, describe, expect, it, spyOn } from 'bun:test'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Player } from '@/components/Player/Player'
import { api } from '@/lib/api'
import { setBrowserSupport } from '@/test/canPlay'
import { mediaItem } from '@/test/fixtures'
import { renderWithProviders } from '@/test/render'

describe('Player', () => {
  // Safari's answer to Matroska: no.
  beforeEach(() => setBrowserSupport((mime) => !mime.startsWith('video/x-matroska')))

  it('goes straight to the video when the browser can play the file', () => {
    const { container } = renderWithProviders(
      <Player media={mediaItem({ container: 'mp4' })} backTo="/libraries/2" />,
    )
    const video = container.querySelector('video')
    expect(video).toHaveAttribute('src', '/api/media/7/file')
    expect(video).toHaveAttribute('autoplay')
    expect(document.activeElement).toBe(video)
  })

  it('explains why a file cannot play instead of loading it', () => {
    const { container } = renderWithProviders(<Player media={mediaItem()} backTo="/libraries/2" />)
    expect(container.querySelector('video')).toBeNull()
    expect(screen.getByText("This video can't play in this browser.")).toBeInTheDocument()
    expect(screen.getByText("The MKV container isn't supported here.")).toBeInTheDocument()
  })

  it('lets the viewer try anyway', async () => {
    const { container } = renderWithProviders(<Player media={mediaItem()} backTo="/libraries/2" />)
    await userEvent.click(screen.getByRole('button', { name: 'Try playing anyway' }))
    expect(container.querySelector('video')).toHaveAttribute('src', '/api/media/7/file')
  })
})

describe('Player progress', () => {
  it('does not overwrite the saved position when the video never started', async () => {
    const saveSpy = spyOn(api, 'saveProgress').mockImplementation(async () => undefined)
    const { container, unmount } = renderWithProviders(
      <Player media={mediaItem({ container: 'mp4', position: 600 })} backTo="/libraries/2" />,
    )
    container.querySelector('video')?.dispatchEvent(new Event('pause'))
    unmount()
    const saved = [...saveSpy.mock.calls]
    saveSpy.mockRestore()
    expect(saved).toEqual([])
  })
})
