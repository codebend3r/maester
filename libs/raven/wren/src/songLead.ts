/** What a row is handed to lead with: its track's cover, or its number on its album. */
export const SONG_LEAD_KINDS = { art: 'art', number: 'number' } as const

/**
 * What leads a song row: its cover, its number on its album, or, while it is the queue's track,
 * the equalizer in its number's place or over its cover.
 */
export const SONG_LEADS = {
  ...SONG_LEAD_KINDS,
  equalizer: 'equalizer',
  artEqualizer: 'artEqualizer',
} as const

export type SongLead = (typeof SONG_LEADS)[keyof typeof SONG_LEADS]

/**
 * What a row is handed to lead with: its track's cover (null while there is none), as a list
 * of many albums' songs shows, or its number on its album, as the album's page does. `Cover` is
 * each app's own picture.
 */
export type SongLeadOf<Cover> =
  | { kind: typeof SONG_LEAD_KINDS.art; cover: Cover | null }
  | { kind: typeof SONG_LEAD_KINDS.number; number: string }

/** What each lead draws besides its kind. */
type ShownLeadParts<Cover> = {
  [SONG_LEADS.art]: { cover: Cover | null }
  [SONG_LEADS.artEqualizer]: { cover: Cover | null }
  [SONG_LEADS.number]: { number: string }
  [SONG_LEADS.equalizer]: Record<never, never>
}

/**
 * The lead a row draws, with what it draws: any of them, or the one `Kind` names, so a view
 * keyed by kind is handed its own.
 */
export type ShownLead<Cover, Kind extends SongLead = SongLead> = {
  [K in Kind]: { kind: K } & ShownLeadParts<Cover>[K]
}[Kind]

type SongLeadOfProps<Cover> = {
  lead: SongLeadOf<Cover>
  /** Whether the row is the queue's track. */
  isCurrent: boolean
}

/** The queue's track shows the equalizer: over its cover where it has one, else in its number's place. */
export const songLeadOf = <Cover>({
  lead,
  isCurrent,
}: SongLeadOfProps<Cover>): ShownLead<Cover> => {
  if (lead.kind === SONG_LEAD_KINDS.art) {
    return { kind: isCurrent ? SONG_LEADS.artEqualizer : SONG_LEADS.art, cover: lead.cover }
  }
  return isCurrent
    ? { kind: SONG_LEADS.equalizer }
    : { kind: SONG_LEADS.number, number: lead.number }
}
