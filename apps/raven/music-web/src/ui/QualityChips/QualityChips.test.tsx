import { describe, expect, it } from 'bun:test'
import { AUDIO_BITRATES, TRACK_STREAM_KINDS, type TrackStream, audioQualityOf } from '@raven/core'
import { KIT_COPY, NOW_PLAYING_COPY } from '@raven/wren'
import { render, screen } from '@testing-library/react'
import { AIRBAG } from '@/test/music'
import { QualityChips } from '@/ui/QualityChips/QualityChips'

const FILE: TrackStream = { kind: TRACK_STREAM_KINDS.file }

const TRANSCODE: TrackStream = {
  kind: TRACK_STREAM_KINDS.transcode,
  kbps: AUDIO_BITRATES.standard,
}

const spoken = (line: string) => KIT_COPY.labelled({ label: NOW_PLAYING_COPY.quality, value: line })

describe('QualityChips', () => {
  it("draws a lossless file's format and bit depth as chips, then the rest in words", () => {
    render(<QualityChips quality={audioQualityOf({ track: AIRBAG, stream: FILE })} />)

    expect(screen.getByText('FLAC')).toBeInTheDocument()
    expect(screen.getByText('16-bit')).toBeInTheDocument()
    expect(screen.getByText('44.1 kHz · 900 kbps')).toBeInTheDocument()
  })

  it('is read out once, as one sentence', () => {
    render(<QualityChips quality={audioQualityOf({ track: AIRBAG, stream: FILE })} />)

    expect(
      screen.getByRole('note', { name: spoken('FLAC · 16-bit / 44.1 kHz · 900 kbps') }),
    ).toBeInTheDocument()
  })

  it("draws a transcode's format alone as a chip, with no bit depth", () => {
    render(<QualityChips quality={audioQualityOf({ track: AIRBAG, stream: TRANSCODE })} />)

    expect(screen.getByText('AAC')).toBeInTheDocument()
    expect(screen.queryByText('16-bit')).toBeNull()
    expect(screen.getByText('256 kbps')).toBeInTheDocument()
  })
})
