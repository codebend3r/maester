import { type AudioTrack, SUBTITLE_SOURCES, type SubtitleTrack } from '@/contract'
import { formatChannels } from '@/format'
import { languageName } from '@/languageName'
import { codecLabel } from '@/playback'

/** How a track reads in a menu: a name, then the details in a quieter line. */
export type TrackLabel = { name: string; details: string }

const joined = (parts: ReadonlyArray<string | null | false>): string =>
  parts.filter((part): part is string => !!part).join(' · ')

export const audioLabel = (track: AudioTrack): TrackLabel => ({
  name: languageName({ tag: track.language }) ?? `Track ${track.index + 1}`,
  details: joined([
    track.title,
    track.codec == null ? null : codecLabel(track.codec),
    formatChannels(track.channels),
  ]),
})

type SubtitleLabelProps = {
  track: SubtitleTrack
  /** Whether a picture track can still be shown, by burning it into the picture. */
  canBurn?: boolean
}

export const subtitleLabel = ({ track, canBurn = false }: SubtitleLabelProps): TrackLabel => ({
  name: languageName({ tag: track.language }) ?? 'Unknown language',
  details: joined([
    track.title,
    track.forced && 'Forced',
    track.hearingImpaired && 'SDH',
    track.source === SUBTITLE_SOURCES.external && 'File',
    !track.supported &&
      (canBurn ? 'Picture subtitles, burned in' : "Picture subtitles, can't be shown"),
  ]),
})
