import {
  type ItemDetails,
  type MediaItem,
  type MediaTracks,
  codecLabel,
  formatChannels,
  formatRuntime,
  resolutionLabel,
} from '@raven/core'
import { languageName } from '@/lib/trackLabels'

/** "A", "A and B", "A, B and C". */
export const joinNames = (names: readonly string[]): string =>
  names.length <= 1
    ? (names[0] ?? '')
    : `${names.slice(0, -1).join(', ')} and ${names.at(-1) ?? ''}`

export const unique = (values: readonly string[]): string[] =>
  values.filter((value, index) => values.indexOf(value) === index)

/** "Directed by Lana Wachowski and Lilly Wachowski", or null without a director. */
export const directedBy = (details: ItemDetails): string | null => {
  const directors = unique(
    details.credits.filter((credit) => credit.job === 'director').map((credit) => credit.name),
  )
  return directors.length > 0 ? `Directed by ${joinNames(directors)}` : null
}

/** "Created by Dan Erickson", or null without a creator. */
export const createdBy = (details: ItemDetails): string | null => {
  const creators = unique(
    details.credits.filter((credit) => credit.job === 'creator').map((credit) => credit.name),
  )
  return creators.length > 0 ? `Created by ${joinNames(creators)}` : null
}

/** Year, runtime (the file's own length when probed, else TMDB's) and up to three genres. */
export const movieFacts = ({
  details,
  primary,
}: {
  details: ItemDetails
  primary: MediaItem | undefined
}): string[] =>
  [
    details.year == null ? null : String(details.year),
    formatRuntime(primary?.duration ?? null) ??
      (details.runtime == null ? null : formatRuntime(details.runtime * 60)),
    ...details.genres.slice(0, 3),
  ].filter((fact): fact is string => fact != null)

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
  const language = languageName(audioTrack?.language ?? null)
  // "English (EAC3 5.1)", or just the details when the track names no language.
  const audio =
    language == null
      ? audioDetails.join(' ')
      : [language, audioDetails.length > 0 ? `(${audioDetails.join(' ')})` : null]
          .filter((part): part is string => part != null)
          .join(' ')
  const subtitles = unique(
    (tracks?.subtitles ?? []).flatMap((track) => languageName(track.language) ?? []),
  ).join(', ')
  return [
    { label: 'Video', value: video },
    { label: 'Audio', value: audio },
    { label: 'Subtitles', value: subtitles },
  ].filter((fact) => fact.value !== '')
}
