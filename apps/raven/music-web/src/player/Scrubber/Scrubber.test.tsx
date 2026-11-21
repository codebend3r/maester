import { describe, expect, it } from 'bun:test'
import { formatDuration } from '@raven/core'
import { useAudioQueue } from '@raven/ui/headless'
import { PLAYER_COPY, remainingTextOf, scrubTextOf } from '@raven/wren'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { SCRUBBERS, Scrubber } from '@/player/Scrubber/Scrubber'
import { AIRBAG } from '@/test/music'

const LENGTH = 300

/** A track queued and `position` seconds in. */
const playedTo = (position: number) =>
  act(() => {
    useAudioQueue.getState().playTracks({ tracks: [AIRBAG] })
    useAudioQueue.getState().engine.time({ position, duration: LENGTH })
  })

const line = () => screen.getByRole('slider', { name: PLAYER_COPY.position })

const soughtTo = () => useAudioQueue.getState().seek?.seconds ?? null

describe('Scrubber', () => {
  it('reads out where the track stands and how long it is', () => {
    playedTo(62)
    render(<Scrubber kind={SCRUBBERS.player} length={LENGTH} />)

    expect(line()).toHaveValue('62')
    expect(line()).toHaveAttribute('max', String(LENGTH))
    expect(line()).toHaveAttribute('aria-valuetext', scrubTextOf({ position: 62, length: LENGTH }))
  })

  it("shows how far in it is and how long is left under Now Playing's line", () => {
    playedTo(62)
    render(<Scrubber kind={SCRUBBERS.player} length={LENGTH} />)

    expect(screen.getByText(formatDuration(62))).toBeInTheDocument()
    expect(screen.getByText(remainingTextOf({ position: 62, length: LENGTH }))).toBeInTheDocument()
  })

  it("shows how far in it is and the track's length beside the player bar's line", () => {
    playedTo(62)
    render(<Scrubber kind={SCRUBBERS.bar} length={LENGTH} />)

    expect(screen.getByText(formatDuration(62))).toBeInTheDocument()
    expect(screen.getByText(formatDuration(LENGTH))).toBeInTheDocument()
  })

  it('draws the line alone where its place holds no words', () => {
    playedTo(62)
    render(<Scrubber kind={SCRUBBERS.bare} length={LENGTH} />)

    expect(line()).toBeInTheDocument()
    expect(screen.queryByText(formatDuration(62))).toBeNull()
  })

  it('seeks at once to where a key moves it', () => {
    playedTo(62)
    render(<Scrubber kind={SCRUBBERS.player} length={LENGTH} />)

    fireEvent.change(line(), { target: { value: '77' } })

    expect(soughtTo()).toBe(77)
  })

  it('shows a slide as it goes and seeks once, where the pointer lets go', () => {
    playedTo(62)
    render(<Scrubber kind={SCRUBBERS.player} length={LENGTH} />)

    fireEvent.pointerDown(line())
    fireEvent.change(line(), { target: { value: '120' } })
    fireEvent.change(line(), { target: { value: '200' } })

    expect(line()).toHaveValue('200')
    expect(line()).toHaveAttribute('aria-valuetext', scrubTextOf({ position: 200, length: LENGTH }))
    expect(soughtTo()).toBeNull()

    fireEvent.pointerUp(line())

    expect(soughtTo()).toBe(200)
  })
})
