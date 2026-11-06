export const PLAYER_TRACKS_COPY = {
  off: 'Off',
  /** Subtitles for the deaf and hard of hearing. */
  hearingImpaired: 'SDH',
  unknownLanguage: 'Unknown language',
} as const

type QualityLabelProps = { label: string; details: string }

export const QUALITY_COPY = {
  /** The first option, always: the file itself, as it is. */
  direct: 'Direct play (Original quality)',
  /** An option and its bitrate, as the track pickers set a label beside its details. */
  withDetails: ({ label, details }: QualityLabelProps) => `${label} · ${details}`,
} as const
