import { describe, expect, it } from 'bun:test'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { useRef } from 'react'
import { useVideoState } from '@/components/Player/useVideoState'

const Probe = () => {
  const videoRef = useRef<HTMLVideoElement>(null)
  const engine = useVideoState({ videoRef, shift: 10, startAt: 20, knownDuration: null })
  return (
    <>
      <video ref={videoRef} data-testid="picture">
        <track kind="captions" />
      </video>
      <output>{JSON.stringify({ state: engine.state, duration: engine.duration })}</output>
      <button onClick={() => engine.seek(500)}>Seek</button>
      <button onClick={engine.refused}>Refused</button>
    </>
  )
}

describe('useVideoState', () => {
  it('follows the file clock, buffered ranges, duration and playback events', () => {
    render(<Probe />)
    const video = screen.getByTestId('picture')
    Object.defineProperties(video, {
      readyState: { value: 1, configurable: true },
      duration: { value: 110, configurable: true },
      buffered: { value: { length: 1, start: () => 15, end: () => 40 }, configurable: true },
      currentTime: { value: 35, writable: true, configurable: true },
    })
    fireEvent.durationChange(video)
    fireEvent.timeUpdate(video)
    expect(screen.getByRole('status')).toHaveTextContent('"time":25')
    expect(screen.getByRole('status')).toHaveTextContent('"buffered":[[5,30]]')
    expect(screen.getByRole('status')).toHaveTextContent('"duration":100')
    fireEvent.progress(video)
    fireEvent.playing(video)
    fireEvent.waiting(video)
    expect(screen.getByRole('status')).toHaveTextContent('"waiting":true')
    fireEvent.pause(video)
    expect(screen.getByRole('status')).toHaveTextContent('"paused":true')
    Object.defineProperty(video, 'playbackRate', { value: 2 })
    fireEvent.rateChange(video)
    expect(screen.getByRole('status')).toHaveTextContent('"rate":2')
    fireEvent.click(screen.getByRole('button', { name: 'Seek' }))
    expect(screen.getByRole('status')).toHaveTextContent('"time":99.5')
    act(() => Object.defineProperty(video, 'duration', { value: Infinity }))
    fireEvent.durationChange(video)
    expect(screen.getByRole('status')).toHaveTextContent('"duration":null')
    fireEvent.click(screen.getByRole('button', { name: 'Refused' }))
  })
})
