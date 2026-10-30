import { describe, expect, it, mock } from 'bun:test'
import type { MediaAccess, PlaybackMode } from '@raven/core'
import { act, render } from '@testing-library/react'
import { useLayoutEffect, useRef } from 'react'
import type { MediaPlane } from '@/components/Player/useMediaPlane'
import { VIDEO_SOURCE_KINDS, sourceFor, useMediaSource } from '@/components/Player/useMediaSource'
import { api } from '@/test/api'
import { mediaItem } from '@/test/fixtures'

const access = (ticket: string): MediaAccess => ({
  origin: { kind: 'lan', url: 'https://raven.home.example' },
  ticket,
})

const planeWith = (granted: MediaAccess | null): MediaPlane => ({
  access: granted,
  refreshTicket: async () => true,
  reportUnreachable: () => {},
})

describe('sourceFor', () => {
  it('plays the file itself directly, and a stream of its type otherwise', () => {
    expect(
      sourceFor({
        api,
        id: 7,
        mode: 'direct',
        audio: null,
        burn: null,
        mime: null,
        access: () => null,
      }),
    ).toEqual({ kind: 'file', url: '/api/media/7/file' })
    const stream = sourceFor({
      api,
      id: 7,
      mode: 'remux',
      audio: 1,
      burn: null,
      mime: 'video/mp4',
      access: () => null,
    })
    expect(stream.kind).toBe(VIDEO_SOURCE_KINDS.stream)
    if (stream.kind !== VIDEO_SOURCE_KINDS.stream) return
    expect(stream.mime).toBe('video/mp4')
    expect(stream.url(30)).toContain('/api/media/7/stream')
  })

  it('reads the access again for each stream request, so a new ticket reaches the next one', () => {
    const tickets = ['abc.def', 'ghi.jkl']
    let asked = 0
    const stream = sourceFor({
      api,
      id: 7,
      mode: 'remux',
      audio: null,
      burn: null,
      mime: 'video/mp4',
      access: () => access(tickets[asked++] ?? 'late'),
    })
    if (stream.kind !== VIDEO_SOURCE_KINDS.stream) throw new Error('expected a stream')
    const first = stream.url(0)
    const second = stream.url(0)
    expect(first).toStartWith('https://raven.home.example/api/media/7/stream')
    expect(first).toContain('t=abc.def')
    expect(second).toContain('t=ghi.jkl')
  })

  it('asks a transcode to burn a picture subtitle in', () => {
    const stream = sourceFor({
      api,
      id: 7,
      mode: 'transcode',
      audio: null,
      burn: 'embedded-2',
      mime: 'video/mp4',
      access: () => access('abc.def'),
    })
    if (stream.kind !== VIDEO_SOURCE_KINDS.stream) throw new Error('expected a stream')
    expect(stream.url(0)).toContain('burn=embedded-2')
  })

  it('reads the access once for the file', () => {
    const read = mock(() => access('abc.def'))
    const file = sourceFor({
      api,
      id: 7,
      mode: 'direct',
      audio: null,
      burn: null,
      mime: null,
      access: read,
    })
    expect(file).toEqual({
      kind: 'file',
      url: 'https://raven.home.example/api/media/7/file?t=abc.def',
    })
    expect(read).toHaveBeenCalledTimes(1)
  })
})

const media = mediaItem()
const ignore = () => {}

type HarnessProps = {
  mode: PlaybackMode
  mediaPlane?: MediaPlane
  onCommit?: (video: HTMLVideoElement | null) => void
  onFailure?: (message: string) => void
}

const Harness = ({ mode, mediaPlane, onCommit = ignore, onFailure = ignore }: HarnessProps) => {
  const videoRef = useRef<HTMLVideoElement>(null)
  const position = useRef(0)
  const playing = useRef(false)
  useMediaSource({
    videoRef,
    source: { kind: 'server', media, api, mediaPlane },
    rendition: { mode, quality: null, burn: null },
    audio: null,
    position,
    playing,
    onRefused: () => {},
    onFailure: (message) => onFailure(`${mode}: ${message}`),
  })
  // After the commit and before the effect that swaps the source: where
  // an event the browser queued for the old source can still land.
  useLayoutEffect(() => {
    onCommit(videoRef.current)
  })
  return (
    <video ref={videoRef} data-testid="video">
      <track kind="captions" />
    </video>
  )
}

const srcOf = (container: HTMLElement): string | null =>
  container.querySelector('video')?.getAttribute('src') ?? null

describe('useMediaSource', () => {
  it('drops an error from the source it is replacing', async () => {
    const reports: string[] = []
    const { rerender } = render(<Harness mode="direct" onFailure={(m) => reports.push(m)} />)
    rerender(
      <Harness
        mode="remux"
        onFailure={(m) => reports.push(m)}
        onCommit={(video) => video?.dispatchEvent(new Event('error'))}
      />,
    )
    await act(async () => {})
    // happy-dom has no MediaSource, so the remux fails on its own account.
    expect(reports).toEqual(["remux: This browser can't play converted video."])
  })

  it('plays the file from the media origin with the ticket in the address', async () => {
    const { container } = render(
      <Harness mode="direct" mediaPlane={planeWith(access('abc.def'))} />,
    )
    await act(async () => {})
    expect(srcOf(container)).toBe('https://raven.home.example/api/media/7/file?t=abc.def')
  })

  it('points the file at a new ticket when the ticket changes', async () => {
    const { container, rerender } = render(
      <Harness mode="direct" mediaPlane={planeWith(access('abc.def'))} />,
    )
    await act(async () => {})
    rerender(<Harness mode="direct" mediaPlane={planeWith(access('ghi.jkl'))} />)
    await act(async () => {})
    expect(srcOf(container)).toBe('https://raven.home.example/api/media/7/file?t=ghi.jkl')
  })

  it('plays the file through the web host when there is no access', async () => {
    const { container } = render(<Harness mode="direct" mediaPlane={planeWith(null)} />)
    await act(async () => {})
    expect(srcOf(container)).toBe('/api/media/7/file')
  })

  it('moves the file to the web host when the access goes away', async () => {
    const { container, rerender } = render(
      <Harness mode="direct" mediaPlane={planeWith(access('abc.def'))} />,
    )
    await act(async () => {})
    rerender(<Harness mode="direct" mediaPlane={planeWith(null)} />)
    await act(async () => {})
    expect(srcOf(container)).toBe('/api/media/7/file')
  })
})
