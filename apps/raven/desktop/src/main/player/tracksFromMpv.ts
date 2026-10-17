import { languageTag, type MediaTracks } from '@raven/core'
import type { MpvTrack } from '@raven/mpv'

type Subtitle = MediaTracks['subtitles'][number]

const SUBTITLE_ID = /^(embedded|external)-(\d+)$/

/** The one place subtitle ids are numbered: each source counts its own entries in list order. */
const subtitleEntries = (list: readonly MpvTrack[]) => {
  const subs = list.filter((track) => track.type === 'sub')
  return subs.map((track, position) => {
    const source = track.external === true ? ('external' as const) : ('embedded' as const)
    const sourceIndex = subs
      .slice(0, position)
      .filter((earlier) => (earlier.external === true) === (source === 'external')).length
    return { track, source, id: `${source}-${sourceIndex}` }
  })
}

export const tracksFromMpv = ({
  list,
  frameRate,
}: {
  list: readonly MpvTrack[]
  frameRate: number | null
}): MediaTracks => {
  const audio = list
    .filter((track) => track.type === 'audio')
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

export const aidFor = ({ list, index }: { list: readonly MpvTrack[]; index: number }) =>
  list.filter((track) => track.type === 'audio')[index]?.id ?? null

export const sidFor = ({ list, id }: { list: readonly MpvTrack[]; id: string }) => {
  if (!SUBTITLE_ID.test(id)) return null
  return subtitleEntries(list).find((entry) => entry.id === id)?.track.id ?? null
}
