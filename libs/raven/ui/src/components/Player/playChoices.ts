import {
  PLAYBACK_MODES,
  type PlaybackMode,
  STREAM_QUALITIES,
  type StreamQuality,
  describeMode,
  formatBitrate,
} from '@raven/core'
import { PLAY_CHOICES_COPY } from '@/components/Player/copy'
import type { Rendition } from '@/components/Player/rendition'

export const PICK_KINDS = { mode: 'mode', size: 'size' } as const

/** What a viewer can ask for: a way of playing the file, or a size to convert it down to. */
export type PlayPick =
  | { kind: typeof PICK_KINDS.mode; mode: PlaybackMode }
  | { kind: typeof PICK_KINDS.size; quality: StreamQuality }

type ChoiceOption = {
  label: string
  /** Set beside the label, or null. */
  details: string | null
  isChecked: boolean
  pick: PlayPick
}

/** `isInline` sets each option's details beside its label, as a size and its bitrate read in a list. */
export type ChoiceGroup = { legend: string; isInline: boolean; options: ChoiceOption[] }

/** The ways this file can play right now as radio groups, and how to pick one. */
export type PlayChoices = {
  /** Empty when there is nothing to choose between. */
  groups: ChoiceGroup[]
  /** Whether a picture subtitle can be shown: the server may convert, which burns it in. */
  canBurn: boolean
  select: (pick: PlayPick) => void
}

type ModeOptionProps = {
  mode: PlaybackMode
  rendition: Rendition
}

const modeOption = ({ mode, rendition }: ModeOptionProps): ChoiceOption => ({
  label: describeMode(mode),
  details: null,
  isChecked: mode === rendition.mode,
  pick: { kind: PICK_KINDS.mode, mode },
})

type ChoiceGroupsProps = {
  modes: readonly PlaybackMode[]
  rendition: Rendition
  qualities: readonly StreamQuality[]
  /** The original file's bitrate and picture, as the first size reads. */
  original: string | null
}

/**
 * Without sizes, the ways to play. With them, Plex's list: the original
 * first, then each size the file can be converted down to; the ways other
 * than a conversion stay under "Play as".
 */
export const choiceGroups = ({
  modes,
  rendition,
  qualities,
  original,
}: ChoiceGroupsProps): ChoiceGroup[] => {
  const asModes = (candidates: readonly PlaybackMode[]): ChoiceGroup[] =>
    candidates.length > 1
      ? [
          {
            legend: PLAY_CHOICES_COPY.playAs,
            isInline: false,
            options: candidates.map((mode) => modeOption({ mode, rendition })),
          },
        ]
      : []
  if (qualities.length === 0) return asModes(modes)

  const isConverting = rendition.mode === PLAYBACK_MODES.transcode
  const [best] = modes
  const sizes: ChoiceGroup = {
    legend: PLAY_CHOICES_COPY.quality,
    isInline: true,
    options: [
      ...(best != null && best !== PLAYBACK_MODES.transcode
        ? [
            {
              label: PLAY_CHOICES_COPY.original,
              details: original,
              isChecked: !isConverting,
              pick: { kind: PICK_KINDS.mode, mode: best },
            } satisfies ChoiceOption,
          ]
        : []),
      // Converted at the size the server's settings give it: a step down or a pick of the way alone.
      ...(isConverting && rendition.quality == null
        ? [
            {
              label: PLAY_CHOICES_COPY.serverSize,
              details: null,
              isChecked: true,
              pick: { kind: PICK_KINDS.mode, mode: PLAYBACK_MODES.transcode },
            } satisfies ChoiceOption,
          ]
        : []),
      ...qualities.map((quality): ChoiceOption => ({
        label: PLAY_CHOICES_COPY.convertTo(STREAM_QUALITIES[quality].label),
        details: formatBitrate(STREAM_QUALITIES[quality].bitrate),
        isChecked: rendition.quality === quality,
        pick: { kind: PICK_KINDS.size, quality },
      })),
    ],
  }
  return [sizes, ...asModes(modes.filter((mode) => mode !== PLAYBACK_MODES.transcode))]
}
