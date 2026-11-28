import { type AudioQuality, qualityChipsOf, qualityRestOf } from '@raven/core'

import { NOW_PLAYING_COPY } from '@/copy/screens'
import { KIT_COPY, factsLineOf } from '@/copy/kit'

/** A lossless file's resolution, "16-bit / 44.1 kHz"; null for a lossy one or one not read yet. */
const resolutionOf = ({ bitDepth, sampleRate }: AudioQuality): string | null =>
  bitDepth !== null && sampleRate !== null
    ? NOW_PLAYING_COPY.resolution({ bitDepth, sampleRate })
    : null

/*
 * The format and quality of what is playing as one sentence: "FLAC · 16-bit / 44.1 kHz · 912 kbps",
 * the transcode's "AAC · 256 kbps", or the download's with "Downloaded" after it.
 */
export const qualityLineOf = (quality: AudioQuality): string =>
  factsLineOf([
    quality.format,
    resolutionOf(quality),
    quality.bitrate,
    quality.isDownloaded ? NOW_PLAYING_COPY.downloaded : null,
  ])

/** The quality of what is playing as both Wrens draw it. */
export type QualityView = {
  /** The format, then a lossless file's bit depth, each a chip. */
  chips: string[]
  /** What follows the chips as quiet words, "44.1 kHz · 912 kbps"; null when nothing does. */
  facts: string | null
  /** What a screen reader says in the chips' and the words' place: "Quality, FLAC · 912 kbps". */
  label: string
}

/** The quality line's chips, its words and its one spoken sentence. */
export const qualityViewOf = (quality: AudioQuality): QualityView => {
  const rest = qualityRestOf(quality)
  return {
    chips: qualityChipsOf(quality),
    facts: rest.length === 0 ? null : KIT_COPY.facts(rest),
    label: KIT_COPY.labelled({ label: NOW_PLAYING_COPY.quality, value: qualityLineOf(quality) }),
  }
}
