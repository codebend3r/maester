import { type AudioTrack, SUBTITLE_SOURCES, type SubtitleTrack } from '@/contract'
import { formatChannels } from '@/format'
import { languageName } from '@/languageName'
import { codecLabel } from '@/playback'
import { PICTURE_SUBTITLES, type PictureSubtitles, isPictureSubtitle } from '@/subtitles'

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

/** What a picture track's label says, by how the player shows it. */
const PICTURE_DETAILS = {
  [PICTURE_SUBTITLES.hidden]: "Picture subtitles, can't be shown",
  [PICTURE_SUBTITLES.drawn]: 'Picture subtitles',
  [PICTURE_SUBTITLES.burned]: 'Picture subtitles, burned in',
} as const satisfies Record<PictureSubtitles, string>

type SubtitleLabelProps = {
  track: SubtitleTrack
  /** How the player shows a picture track now; a label that names no picture track leaves it out. */
  pictures?: PictureSubtitles
}

export const subtitleLabel = ({
  track,
  pictures = PICTURE_SUBTITLES.hidden,
}: SubtitleLabelProps): TrackLabel => ({
  name: languageName({ tag: track.language }) ?? 'Unknown language',
  details: joined([
    track.title,
    track.forced && 'Forced',
    track.hearingImpaired && 'SDH',
    track.source === SUBTITLE_SOURCES.external && 'File',
    isPictureSubtitle(track) && PICTURE_DETAILS[pictures],
  ]),
})
