import { type AudioTrack, type SubtitleTrack, codecLabel, formatChannels } from '@raven/core'

const names = (() => {
  try {
    return new Intl.DisplayNames(['en'], { type: 'language' })
  } catch {
    return null
  }
})()

/** "English" for 'en'; the code itself when the browser has no name for it. */
export const languageName = (tag: string | null): string | null => {
  if (tag == null) return null
  try {
    return names?.of(tag) ?? tag.toUpperCase()
  } catch {
    return tag.toUpperCase()
  }
}

/** How a track reads in a menu: a name, then the details in a quieter line. */
export type TrackLabel = { name: string; details: string }

const joined = (parts: ReadonlyArray<string | null | false>): string =>
  parts.filter((part): part is string => !!part).join(' · ')

export const audioLabel = (track: AudioTrack): TrackLabel => ({
  name: languageName(track.language) ?? `Track ${track.index + 1}`,
  details: joined([
    track.title,
    track.codec == null ? null : codecLabel(track.codec),
    formatChannels(track.channels),
  ]),
})

export const subtitleLabel = (track: SubtitleTrack): TrackLabel => ({
  name: languageName(track.language) ?? 'Unknown language',
  details: joined([
    track.title,
    track.forced && 'Forced',
    track.hearingImpaired && 'SDH',
    track.source === 'external' && 'File',
    !track.supported && "Picture subtitles, can't be shown",
  ]),
})
