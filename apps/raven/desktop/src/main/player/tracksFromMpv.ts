import { languageTag, type MediaTracks, SUBTITLE_SOURCES } from '@raven/core'
import { MPV_TRACK_TYPES, type MpvTrack } from '@raven/mpv'

type Subtitle = MediaTracks['subtitles'][number]

const SUBTITLE_ID = /^(embedded|external)-(\d+)$/

/** The one place subtitle ids are numbered: each source counts its own entries in list order. */
const subtitleEntries = (list: readonly MpvTrack[]) => {
  const subs = list.filter((track) => track.type === MPV_TRACK_TYPES.sub)
  return subs.map((track, position) => {
    const source = track.external === true ? SUBTITLE_SOURCES.external : SUBTITLE_SOURCES.embedded
    const sourceIndex = subs
      .slice(0, position)
      .filter(
        (earlier) => (earlier.external === true) === (source === SUBTITLE_SOURCES.external),
      ).length
    return { track, source, id: `${source}-${sourceIndex}` }
  })
}

type TracksFromMpvProps = {
  list: readonly MpvTrack[]
  frameRate: number | null
}

export const tracksFromMpv = ({ list, frameRate }: TracksFromMpvProps): MediaTracks => {
  const audio = list
    .filter((track) => track.type === MPV_TRACK_TYPES.audio)
    .map((track, index) => {
      const channels = track['demux-channel-count'] ?? null
      return {
        index,
        codec: track.codec ?? null,
        channels: channels !== null && channels > 0 ? channels : null,
        language: languageTag(track.lang ?? null),
        title: track.title ?? null,
        default: track.default ?? false,
      }
    })

  const subtitles = subtitleEntries(list).map(({ track, source, id }): Subtitle => ({
    id,
    source,
    codec: track.codec ?? null,
    language: languageTag(track.lang ?? null),
    title: track.title ?? null,
    default: track.default ?? false,
    forced: track.forced ?? false,
    hearingImpaired: track['hearing-impaired'] ?? false,
    supported: true,
  }))

  const flagged = audio.find((track) => track.default)
  return {
    audio,
    subtitles,
    defaultAudio: flagged?.index ?? (audio.length > 0 ? 0 : null),
    frameRate: frameRate !== null && Number.isFinite(frameRate) && frameRate > 0 ? frameRate : null,
  }
}

type AidForProps = { list: readonly MpvTrack[]; index: number }

export const aidFor = ({ list, index }: AidForProps) =>
  list.filter((track) => track.type === MPV_TRACK_TYPES.audio)[index]?.id ?? null

type SidForProps = { list: readonly MpvTrack[]; id: string }

export const sidFor = ({ list, id }: SidForProps) => {
  if (!SUBTITLE_ID.test(id)) return null
  return subtitleEntries(list).find((entry) => entry.id === id)?.track.id ?? null
}
