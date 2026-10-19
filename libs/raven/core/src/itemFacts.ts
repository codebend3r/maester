import { CREDIT_JOBS, type ItemDetails, type MediaItem, type MediaTracks } from '@/contract'
import { formatBytes, formatChannels, formatRuntime } from '@/format'
import { languageName } from '@/languageName'
import { resolutionLabel } from '@/media'
import { codecLabel } from '@/playback'
import { plural } from '@/plural'

const present = (facts: ReadonlyArray<string | null>): string[] =>
  facts.filter((fact): fact is string => fact != null)

/** "2011 to 2019", "2022 to now", or just the year for a show that began and ended in one. */
export const showYears = ({
  year,
  endedYear,
}: {
  year: number | null
  endedYear: number | null
}): string | null => {
  if (year == null) return null
  if (endedYear == null) return `${year} to now`
  return endedYear === year ? String(year) : `${year} to ${endedYear}`
}

/** How long it runs: the file's own length when probed, else TMDB's runtime in minutes. */
export const runtimeFact = ({
  file,
  runtime,
}: {
  file: MediaItem | undefined
  runtime: number | null
}): string | null =>
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

/** Year, runtime, up to three genres, and how many files the movie is once there are two or more. */
export const movieFacts = ({
  details,
  primary,
}: {
  details: ItemDetails
  primary: MediaItem | undefined
}): string[] =>
  present([
    details.year == null ? null : String(details.year),
    runtimeFact({ file: primary, runtime: details.runtime }),
    ...details.genres.slice(0, 3),
    details.versions.length > 1
      ? plural({ n: details.versions.length, one: 'file', many: 'files' })
      : null,
  ])

/** Air date and runtime. */
export const episodeFacts = ({
  details,
  primary,
}: {
  details: ItemDetails
  primary: MediaItem | undefined
}): string[] =>
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

/** The file's video, audio and subtitles, as the tracks the scan stored describe them. */
export const fileFacts = ({
  media,
  tracks,
}: {
  media: MediaItem
  tracks: MediaTracks | undefined
}): Array<{ label: string; value: string }> => {
  const resolution = resolutionLabel(media)
  const codec = media.videoCodec ? codecLabel(media.videoCodec) : null
  const video = [resolution, codec == null ? null : `(${codec})`, media.hdr ? 'HDR' : null]
    .filter((part): part is string => part != null)
    .join(' ')
  const audioTrack =
    tracks?.audio.find((track) => track.index === tracks.defaultAudio) ?? tracks?.audio[0]
  const audioCodec = audioTrack?.codec ?? media.audioCodec
  const audioDetails = [
    audioCodec == null ? null : codecLabel(audioCodec),
    formatChannels(audioTrack?.channels ?? media.audioChannels),
  ].filter((part): part is string => part != null)
  const language = languageName({ tag: audioTrack?.language ?? null })
  // "English (EAC3 5.1)", or just the details when the track names no language.
  const audio =
    language == null
      ? audioDetails.join(' ')
      : [language, audioDetails.length > 0 ? `(${audioDetails.join(' ')})` : null]
          .filter((part): part is string => part != null)
          .join(' ')
  const subtitles = unique(
    (tracks?.subtitles ?? []).flatMap((track) => languageName({ tag: track.language }) ?? []),
  ).join(', ')
  return [
    { label: 'Video', value: video },
    { label: 'Audio', value: audio },
    { label: 'Subtitles', value: subtitles },
  ].filter((fact) => fact.value !== '')
}

/** What sets one file of a movie apart from its other files: its resolution, HDR, codec and size. */
export const versionFacts = (media: MediaItem): string[] =>
  [
    resolutionLabel(media),
    media.hdr ? 'HDR' : null,
    media.videoCodec ? codecLabel(media.videoCodec) : null,
    formatBytes(media.size),
  ].filter((fact): fact is string => fact != null && fact !== '')
