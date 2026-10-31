type NumberedProps = { place: number; title: string }

type PlayTimeProps = { at: string; length: string }

/** The words the shared music rows say, in every app. */
export const MUSIC_ROWS_COPY = {
  /** A disc's heading on an album of several. */
  disc: (n: number) => `Disc ${n}`,
  tracks: { one: 'track', many: 'tracks' },
  /** A playlist's length in whole minutes: "53 min". */
  minutes: (minutes: number) => `${minutes} min`,
  /** Facts on one line: "1997 · 12 tracks · 53:21". */
  facts: (facts: readonly string[]) => facts.join(' · '),
  /** A track as it is read out: "1. Airbag". */
  numbered: ({ place, title }: NumberedProps) => `${place}. ${title}`,
  /** How far the track has played and how long it is: "1:02 / 4:44". */
  playTime: ({ at, length }: PlayTimeProps) => `${at} / ${length}`,
} as const
