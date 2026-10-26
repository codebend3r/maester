import { describe, expect, it } from 'bun:test'
import type { MediaOrigin, MediaOriginKind } from '@/contract'
import { type OriginProbe, pickOrigin } from '@/mediaOrigins'

const origin = (kind: MediaOriginKind): MediaOrigin => ({ kind, url: `https://${kind}.example` })

type ProbeProps = {
  kind: MediaOriginKind
  bytesPerSecond: number
  firstByteMs?: number
}

// A probe answers instantly unless said, so its score is exactly its bytesPerSecond: the
// 256 KiB body is so small that even 10 ms to first byte would weigh as much as the transfer.
const probe = ({ kind, bytesPerSecond, firstByteMs = 0 }: ProbeProps): OriginProbe => ({
  origin: origin(kind),
  firstByteMs,
  bytesPerSecond,
})

describe('pickOrigin', () => {
  it('takes the fastest when the others are more than 20% slower', () => {
    expect(
      pickOrigin([
        probe({ kind: 'lan', bytesPerSecond: 70e6 }),
        probe({ kind: 'public', bytesPerSecond: 100e6 }),
      ]),
    ).toEqual(origin('public'))
  })

  it('prefers lan over tailnet over public within the band', () => {
    expect(
      pickOrigin([
        probe({ kind: 'public', bytesPerSecond: 100e6 }),
        probe({ kind: 'tailnet', bytesPerSecond: 100e6 }),
        probe({ kind: 'lan', bytesPerSecond: 85e6 }),
      ]),
    ).toEqual(origin('lan'))
    expect(
      pickOrigin([
        probe({ kind: 'public', bytesPerSecond: 100e6 }),
        probe({ kind: 'tailnet', bytesPerSecond: 85e6 }),
      ]),
    ).toEqual(origin('tailnet'))
  })

  it('counts latency: a slow first byte pulls a fast link down', () => {
    expect(
      pickOrigin([
        probe({ kind: 'lan', bytesPerSecond: 100e6, firstByteMs: 2000 }),
        probe({ kind: 'public', bytesPerSecond: 50e6 }),
      ]),
    ).toEqual(origin('public'))
  })

  it('breaks a tie in kind by time to first byte', () => {
    const slow = { kind: 'lan', url: 'https://lan-a.example' } as const
    const quick = { kind: 'lan', url: 'https://lan-b.example' } as const
    expect(
      pickOrigin([
        { origin: slow, firstByteMs: 30, bytesPerSecond: 100e6 },
        { origin: quick, firstByteMs: 5, bytesPerSecond: 100e6 },
      ]),
    ).toEqual(quick)
  })

  it('keeps the first of two identical probes', () => {
    const first = { kind: 'lan', url: 'https://lan-a.example' } as const
    const second = { kind: 'lan', url: 'https://lan-b.example' } as const
    expect(
      pickOrigin([
        { origin: first, firstByteMs: 10, bytesPerSecond: 100e6 },
        { origin: second, firstByteMs: 10, bytesPerSecond: 100e6 },
      ]),
    ).toEqual(first)
  })

  it('scores a dead or nonsensical rate as zero', () => {
    expect(
      pickOrigin([
        probe({ kind: 'lan', bytesPerSecond: 0 }),
        probe({ kind: 'public', bytesPerSecond: 1e6 }),
      ]),
    ).toEqual(origin('public'))
    expect(
      pickOrigin([
        probe({ kind: 'lan', bytesPerSecond: Number.NaN }),
        probe({ kind: 'tailnet', bytesPerSecond: -5 }),
        probe({ kind: 'public', bytesPerSecond: 1e6 }),
      ]),
    ).toEqual(origin('public'))
  })

  it('is null when every probe is dead', () => {
    expect(
      pickOrigin([
        probe({ kind: 'lan', bytesPerSecond: 0 }),
        probe({ kind: 'public', bytesPerSecond: Number.NaN }),
      ]),
    ).toBeNull()
  })

  it('counts a non-finite score as zero, so one NaN probe cannot null the pick', () => {
    expect(
      pickOrigin([
        probe({ kind: 'lan', bytesPerSecond: 100e6, firstByteMs: Number.NaN }),
        probe({ kind: 'public', bytesPerSecond: 1e6 }),
      ]),
    ).toEqual(origin('public'))
  })

  it('is null with nothing answered', () => {
    expect(pickOrigin([])).toBeNull()
  })
})
