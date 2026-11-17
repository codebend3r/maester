import type { Cover } from '@/music/useCovers'

/** What leads a song row: its cover, its number on its album, or the equalizer while it plays. */
export const SONG_LEADS = { art: 'art', number: 'number', equalizer: 'equalizer' } as const

export type SongLead = (typeof SONG_LEADS)[keyof typeof SONG_LEADS]

/**
 * What a row is handed to lead with: its track's cover (null while there is none), as a list
 * of many albums' songs shows, or its number on its album, as the album's page does.
 */
export type SongLeadOf =
  | { kind: typeof SONG_LEADS.art; cover: Cover | null }
  | { kind: typeof SONG_LEADS.number; number: string }

type SongLeadOfProps = { hasArt: boolean; isPlaying: boolean }

/** A numbered row playing shows the equalizer in its number's place; a row with art keeps it. */
export const songLeadOf = ({ hasArt, isPlaying }: SongLeadOfProps): SongLead => {
  if (hasArt) return SONG_LEADS.art
  if (isPlaying) return SONG_LEADS.equalizer
  return SONG_LEADS.number
}
