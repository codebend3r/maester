import { describe, expect, it, mock } from 'bun:test'
import { PLAYER_COPY } from '@raven/wren'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MiniPlayer } from '@/ui/MiniPlayer/MiniPlayer'

type RenderMiniProps = { isPlaying?: boolean; error?: string | null }

const renderMini = ({ isPlaying = true, error = null }: RenderMiniProps = {}) => {
  const presses = { onOpen: mock(), onToggle: mock(), onNext: mock() }
  render(
    <MiniPlayer
      artists="Radiohead"
      cover={null}
      error={error}
      isPlaying={isPlaying}
      progress={0.25}
      title="Airbag"
      {...presses}
    />,
  )
  return presses
}

const OPEN = PLAYER_COPY.open({ title: 'Airbag', artists: 'Radiohead' })

describe('MiniPlayer', () => {
  it('shows what plays, and opens Now Playing when pressed', async () => {
    const { onOpen, onToggle, onNext } = renderMini()

    expect(screen.getByText('Airbag')).toBeInTheDocument()
    expect(screen.getByText('Radiohead')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: OPEN }))

    expect(onOpen).toHaveBeenCalledTimes(1)
    expect(onToggle).not.toHaveBeenCalled()
    expect(onNext).not.toHaveBeenCalled()
  })

  it('offers Pause while it plays and Play while it is paused, and Next, without opening', async () => {
    const playing = renderMini()

    await userEvent.click(screen.getByRole('button', { name: PLAYER_COPY.pause }))
    await userEvent.click(screen.getByRole('button', { name: PLAYER_COPY.next }))

    expect(playing.onToggle).toHaveBeenCalledTimes(1)
    expect(playing.onNext).toHaveBeenCalledTimes(1)
    expect(playing.onOpen).not.toHaveBeenCalled()
    expect(screen.queryByRole('button', { name: PLAYER_COPY.play })).toBeNull()
  })

  it('offers Play while it is paused', () => {
    renderMini({ isPlaying: false })

    expect(screen.getByRole('button', { name: PLAYER_COPY.play })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: PLAYER_COPY.pause })).toBeNull()
  })

  it("says what went wrong playing in the artists' place", () => {
    renderMini({ error: 'This track cannot be played' })

    expect(screen.getByText('This track cannot be played')).toBeInTheDocument()
    expect(screen.queryByText('Radiohead')).toBeNull()
  })
})
