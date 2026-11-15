import type { ApiClient } from '@/apiClient'
import {
  CREDIT_JOBS,
  DOLBY_VISION_PROFILES,
  type EpisodeSummary,
  ITEM_IMAGE_KINDS,
  ITEM_TYPES,
  type ItemDetails,
  type MediaItem,
  type MediaTracks,
  type SeasonSummary,
  VIDEO_RANGES,
} from '@/contract'
import { formatBitrate, formatBytes, formatChannels, formatRuntime } from '@/format'
import { languageName } from '@/languageName'
import { type Resolution, isResolution, resolutionLabel, splitResolution } from '@/media'
import { VIDEO_CODECS, VIDEO_RANGE_LABELS, codecLabel } from '@/playback'
import { plural } from '@/plural'

const present = (facts: ReadonlyArray<string | null>): string[] =>
  facts.filter((fact): fact is string => fact != null)

type ShowYearsProps = {
  year: number | null
  endedYear: number | null
}

/** "2011 to 2019", "2022 to now", or just the year for a show that began and ended in one. */
export const showYears = ({ year, endedYear }: ShowYearsProps): string | null => {
  if (year == null) return null
  if (endedYear == null) return `${year} to now`
  return endedYear === year ? String(year) : `${year} to ${endedYear}`
}

type RuntimeFactProps = {
  file: MediaItem | undefined
  runtime: number | null
}

/** How long it runs: the file's own length when probed, else TMDB's runtime in minutes. */
export const runtimeFact = ({ file, runtime }: RuntimeFactProps): string | null =>
  formatRuntime(file?.duration ?? null) ?? (runtime == null ? null : formatRuntime(runtime * 60))

/** "A", "A and B", "A, B and C". */
const joinNames = (names: readonly string[]): string =>
  names.length <= 1
    ? (names[0] ?? '')
    : `${names.slice(0, -1).join(', ')} and ${names.at(-1) ?? ''}`

const unique = (values: readonly string[]): string[] =>
  values.filter((value, index) => values.indexOf(value) === index)

/** "Directed by Lana Wachowski and Lilly Wachowski", or null without a director. */
export const directedBy = (details: ItemDetails): string | null => {
  const directors = unique(
    details.credits
      .filter((credit) => credit.job === CREDIT_JOBS.director)
      .map((credit) => credit.name),
  )
  return directors.length > 0 ? `Directed by ${joinNames(directors)}` : null
}

/** "Created by Dan Erickson", or null without a creator. */
export const createdBy = (details: ItemDetails): string | null => {
  const creators = unique(
    details.credits
      .filter((credit) => credit.job === CREDIT_JOBS.creator)
      .map((credit) => credit.name),
  )
  return creators.length > 0 ? `Created by ${joinNames(creators)}` : null
}

type MovieFactsProps = {
  details: ItemDetails
  primary: MediaItem | undefined
}

/** Release day (the year when TMDB gave none), runtime, up to three genres, and how many files the movie is once there are two or more. */
export const movieFacts = ({ details, primary }: MovieFactsProps): string[] =>
  present([
    releaseLabel(details),
    runtimeFact({ file: primary, runtime: details.runtime }),
    ...details.genres.slice(0, 3),
    details.versions.length > 1
      ? plural({ n: details.versions.length, one: 'file', many: 'files' })
      : null,
  ])

type EpisodeFactsProps = {
  details: ItemDetails
  primary: MediaItem | undefined
}

/** Air date and runtime. */
export const episodeFacts = ({ details, primary }: EpisodeFactsProps): string[] =>
  present([
    formatAirDate(details.released),
    runtimeFact({ file: primary, runtime: details.runtime }),
  ])

/** "Severance · Season 1 · Episode 2". */
export const episodeByline = (details: ItemDetails): string =>
  present([
    details.show?.title ?? null,
    details.season == null ? null : `Season ${details.season}`,
    details.episode == null ? null : `Episode ${details.episode}`,
  ]).join(' · ')

/** "2022 to now", the network, and up to three genres. */
export const showFacts = (details: ItemDetails): string[] =>
  present([
    showYears({
      year: details.year,
      endedYear: details.ended == null ? null : Number(details.ended.slice(0, 4)) || null,
    }),
    details.studio,
    ...details.genres.slice(0, 3),
  ])

const airDate = new Intl.DateTimeFormat(undefined, {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
})

/** "18 Feb 2022" from a YYYY-MM-DD date, or null. */
export const formatAirDate = (date: string | null): string | null => {
  if (date == null || !/^\d{4}-\d{2}-\d{2}/.test(date)) return null
  return airDate.format(new Date(`${date.slice(0, 10)}T12:00:00`))
}

type ReleaseLabelProps = { released?: string | null; year: number | null }

/** When a title came out: the day, "18 Feb 2022", or its year alone when the day is unknown; null for neither. */
export const releaseLabel = ({ released, year }: ReleaseLabelProps): string | null =>
  formatAirDate(released ?? null) ?? (year == null ? null : String(year))

type FileFactsProps = {
  media: MediaItem
  tracks: MediaTracks | undefined
}

/** A fact about a file: its label and its values, more than one where it is a list (the subtitle languages). */
export type FileFact = { label: string; values: string[] }

type FactOfProps = { label: string; values: ReadonlyArray<string | null> }

/** A fact with its empty values left out, or nothing when none is left. */
const factOf = ({ label, values }: FactOfProps): FileFact[] => {
  const kept = values.filter((value): value is string => value != null && value !== '')
  return kept.length === 0 ? [] : [{ label, values: kept }]
}

type AudioFactProps = { codec: string | null; channels: number | null; language: string | null }

/** "English (EAC3 5.1)", or just the sound when the track names no language. */
const audioFact = ({ codec, channels, language }: AudioFactProps): string => {
  const details = [codec == null ? null : codecLabel(codec), formatChannels(channels)].filter(
    (part): part is string => part != null,
  )
  const name = languageName({ tag: language })
  const bracketed = details.length > 0 ? `(${details.join(' ')})` : null
  return name == null
    ? details.join(' ')
    : [name, bracketed].filter((part): part is string => part != null).join(' ')
}

/**
 * How the facts name a file's high range of light from what the scan keeps:
 * Dolby Vision profile 5, which a browser cannot show, profile 7, a 4K
 * Blu-ray's, or any other HDR.
 */
export const PICTURE_RANGES = {
  hdr: 'HDR',
  dolbyVisionOnly: 'DV5',
  dolbyVisionDualLayer: 'DV7',
} as const

type DolbyVisionRangeProps = Pick<MediaItem, 'isDolbyVisionOnly' | 'dolbyVisionProfile'>

/** A file's Dolby Vision as a chip names it (`DV5`, `DV7`), or null for any other picture. */
export const dolbyVisionRange = ({
  isDolbyVisionOnly,
  dolbyVisionProfile,
}: DolbyVisionRangeProps): string | null => {
  if (!!isDolbyVisionOnly) return PICTURE_RANGES.dolbyVisionOnly
  return dolbyVisionProfile === DOLBY_VISION_PROFILES.dualLayer
    ? PICTURE_RANGES.dolbyVisionDualLayer
    : null
}

type RangeLabelProps = DolbyVisionRangeProps & Pick<MediaItem, 'hdr'>

/** A file's range as its facts name it (`DV5`, `DV7`, `HDR`), or null for SDR. */
export const rangeLabel = (media: RangeLabelProps): string | null =>
  dolbyVisionRange(media) ?? (media.hdr ? PICTURE_RANGES.hdr : null)

/** Every name a high range of light goes by in the facts: the scan's, and the probe's own. */
const HDR_RANGES: ReadonlySet<string> = new Set([
  ...Object.values(PICTURE_RANGES),
  VIDEO_RANGE_LABELS[VIDEO_RANGES.hdr10],
  VIDEO_RANGE_LABELS[VIDEO_RANGES.hlg],
  VIDEO_RANGE_LABELS[VIDEO_RANGES.dolbyVision],
])

/** The codec a video fact names in brackets after its resolution, as `fileFacts` writes it: `(HEVC) HDR`. */
const BRACKETED_CODEC = /^\(([^)]+)\)\s*/

/** What a video fact says after its resolution: its codec, its range, and any other words. */
type PictureRest = { codec: string | null; range: string | null; words: string | null }

/** Reads `splitResolution`'s rest of a video fact back into its codec, its range and the rest. */
export const splitPictureRest = (rest: string | null): PictureRest => {
  const bracketed = BRACKETED_CODEC.exec(rest ?? '')
  const after = (rest ?? '').slice(bracketed?.[0].length ?? 0)
  const isRange = HDR_RANGES.has(after)
  return {
    codec: bracketed?.[1] ?? null,
    range: isRange ? after : null,
    words: isRange || after === '' ? null : after,
  }
}

/**
 * What one part of a line of facts is, so every client marks the same
 * parts as chips: a resolution (`4K`), a video codec (`HEVC`), a high range
 * of light (`HDR`, `DV5`), or plain words.
 */
export const FACT_PART_KINDS = {
  resolution: 'resolution',
  codec: 'codec',
  range: 'range',
  text: 'text',
} as const

export type FactPartKind = (typeof FACT_PART_KINDS)[keyof typeof FACT_PART_KINDS]

/** A part of a line of facts and the words it shows. */
export type FactPart = { kind: FactPartKind; text: string }

/** The names the facts give the video codecs the clients treat apart: `H.264`, `HEVC`, `AV1`, `VP9`. */
const VIDEO_CODEC_NAMES: ReadonlySet<string> = new Set(Object.values(VIDEO_CODECS).map(codecLabel))

/**
 * One word of a list of facts, such as `versionFacts`' or a tile's, as the
 * part it is: a resolution, a video codec or a range when it is that whole
 * word, else words. Names someone chose (an edition, a library called "4K
 * Movies") are never more than words.
 */
export const wordPart = (word: string): FactPart => {
  if (isResolution(word)) return { kind: FACT_PART_KINDS.resolution, text: word }
  if (VIDEO_CODEC_NAMES.has(word)) return { kind: FACT_PART_KINDS.codec, text: word }
  if (HDR_RANGES.has(word)) return { kind: FACT_PART_KINDS.range, text: word }
  return { kind: FACT_PART_KINDS.text, text: word }
}

type PartOfProps = { kind: FactPartKind; text: string | null }

const partOf = ({ kind, text }: PartOfProps): FactPart[] => (text == null ? [] : [{ kind, text }])

type PictureRestPartsProps = { resolution: Resolution | null; rest: string | null }

/** A picture as its resolution, then `splitPictureRest`'s codec, range and any other words. */
export const pictureRestParts = ({ resolution, rest }: PictureRestPartsProps): FactPart[] => {
  const { codec, range, words } = splitPictureRest(rest)
  return [
    ...partOf({ kind: FACT_PART_KINDS.resolution, text: resolution }),
    ...partOf({ kind: FACT_PART_KINDS.codec, text: codec }),
    ...partOf({ kind: FACT_PART_KINDS.range, text: range }),
    ...partOf({ kind: FACT_PART_KINDS.text, text: words }),
  ]
}

/**
 * A fact `@raven/core` writes with the resolution first (`4K HDR`,
 * `1080p (HEVC) HDR`) as its parts; one with no resolution is a single
 * word's part (`DV5`, `HEVC`), or its words. Only for core's facts: a name
 * someone chose goes through `wordPart`, whole.
 */
export const factParts = (fact: string): FactPart[] => {
  const { resolution, rest } = splitResolution(fact)
  if (resolution == null) return [wordPart(fact)]
  return pictureRestParts({ resolution, rest: rest === '' ? null : rest })
}

type PicturePartsProps = Pick<
  MediaItem,
  'width' | 'height' | 'hdr' | 'isDolbyVisionOnly' | 'dolbyVisionProfile' | 'videoCodec'
>

/** A file's picture as chips: its resolution, its range, then its video codec; none before it is probed. */
export const pictureParts = (media: PicturePartsProps): FactPart[] => {
  const resolution = resolutionLabel(media)
  if (resolution == null) return []
  return [
    resolution,
    rangeLabel(media),
    media.videoCodec ? codecLabel(media.videoCodec) : null,
  ].flatMap((word) => (word == null ? [] : [wordPart(word)]))
}

/** The file's video, audio and subtitles, as the tracks the scan stored describe them. */
export const fileFacts = ({ media, tracks }: FileFactsProps): FileFact[] => {
  const resolution = resolutionLabel(media)
  const codec = media.videoCodec ? codecLabel(media.videoCodec) : null
  const video = [resolution, codec == null ? null : `(${codec})`, rangeLabel(media)]
    .filter((part): part is string => part != null)
    .join(' ')
  // Every track, the default first; a file whose tracks are unknown is its own codec alone.
  const listed = tracks?.audio ?? []
  const defaultAudio = tracks?.defaultAudio ?? null
  const audioTracks = [
    ...listed.filter((track) => track.index === defaultAudio),
    ...listed.filter((track) => track.index !== defaultAudio),
  ]
  const audio =
    audioTracks.length === 0
      ? [audioFact({ codec: media.audioCodec, channels: media.audioChannels, language: null })]
      : audioTracks.map(audioFact)
  const subtitles = unique(
    (tracks?.subtitles ?? []).flatMap((track) => languageName({ tag: track.language }) ?? []),
  )
  return [
    ...factOf({ label: 'Video', values: [video] }),
    ...factOf({ label: 'Audio', values: audio }),
    ...factOf({ label: 'Subtitles', values: subtitles }),
  ]
}

/** What sets one file of a movie apart from its other files: its resolution, HDR, codec and size. */
export const versionFacts = (media: MediaItem): string[] =>
  [
    resolutionLabel(media),
    rangeLabel(media),
    media.videoCodec ? codecLabel(media.videoCodec) : null,
    formatBytes(media.size),
  ].filter((fact): fact is string => fact != null && fact !== '')

type AllFileFactsProps = {
  media: MediaItem
  tracks: MediaTracks | undefined
}

/** The file's facts as label and value: its tracks, then its container, bitrate and size. */
export const allFileFacts = ({ media, tracks }: AllFileFactsProps): FileFact[] => [
  ...fileFacts({ media, tracks }),
  ...factOf({ label: 'Container', values: [media.container.toUpperCase()] }),
  ...factOf({ label: 'Bitrate', values: [formatBitrate(media.bitrate)] }),
  ...factOf({ label: 'Size', values: [formatBytes(media.size)] }),
]

/** A show's seasons on disk, in order. */
export const seasonsOf = (details: ItemDetails): SeasonSummary[] =>
  details.children.flatMap((child) => (child.type === ITEM_TYPES.season ? [child] : []))

/** A season's episodes on disk, in order. */
export const episodesOf = (details: ItemDetails): EpisodeSummary[] =>
  details.children.flatMap((child) => (child.type === ITEM_TYPES.episode ? [child] : []))

/** The first episode on disk not yet watched that has a file to play. */
export const nextEpisodeIn = (episodes: readonly EpisodeSummary[]): EpisodeSummary | undefined =>
  episodes.find((episode) => !episode.watched && episode.primary != null)

/** The first episode on disk with a file to play: where a watched season starts again. */
export const firstEpisodeIn = (episodes: readonly EpisodeSummary[]): EpisodeSummary | undefined =>
  episodes.find((episode) => episode.primary != null)

/** The season a show starts again from: its first, specials last. */
export const firstSeasonIn = (seasons: readonly SeasonSummary[]): SeasonSummary | undefined =>
  seasons.find((season) => season.season !== 0) ?? seasons[0]

/** A season's year, and how many of its episodes are on disk. */
export const seasonFacts = (season: ItemDetails): string[] =>
  present([
    season.year == null ? null : String(season.year),
    plural({ n: episodesOf(season).length, one: 'episode', many: 'episodes' }),
  ])

/** How many of some episodes are watched, of how many. */
type WatchedCount = { watched: number; total: number }

type WatchedCountLabelProps = WatchedCount

/** "3 of 8 watched". */
export const watchedCountLabel = ({ watched, total }: WatchedCountLabelProps): string =>
  `${watched} of ${total} watched`

/** How many of a show's episodes on disk are watched, across its seasons. */
export const seasonsWatched = (seasons: readonly SeasonSummary[]): WatchedCount =>
  seasons.reduce(
    (sum, season) => ({
      watched: sum.watched + season.watchedCount,
      total: sum.total + season.episodeCount,
    }),
    { watched: 0, total: 0 },
  )

/** How many of a season's episodes on disk are watched. */
export const episodesWatched = (episodes: readonly EpisodeSummary[]): WatchedCount => ({
  watched: episodes.filter((episode) => episode.watched).length,
  total: episodes.length,
})

/**
 * An episode row's air date and length, the file's own where it has been
 * probed, and `DV5` where its file is Dolby Vision profile 5, which a browser
 * plays purple and green, or `DV7` where it is a 4K Blu-ray's profile 7.
 */
export const episodeRowFacts = (episode: EpisodeSummary): string[] =>
  present([
    formatAirDate(episode.released),
    runtimeFact({ file: episode.primary ?? undefined, runtime: episode.runtime }),
    episode.primary ? dolbyVisionRange(episode.primary) : null,
  ])

type EpisodeStillUrlProps = {
  api: Pick<ApiClient, 'itemImageUrl' | 'thumbnailUrl'>
  episode: EpisodeSummary
}

/** The still an episode shows: TMDB's or the one beside the file, else a frame of the file. */
export const episodeStillUrl = ({ api, episode }: EpisodeStillUrlProps): string | null => {
  if (episode.stillVersion != null)
    return api.itemImageUrl({
      id: episode.id,
      kind: ITEM_IMAGE_KINDS.still,
      version: episode.stillVersion,
    })
  return episode.primary ? api.thumbnailUrl(episode.primary) : null
}
