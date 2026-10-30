import { COMMON_COPY } from '@/lib/copy'

export const SHOW_COPY = {
  noun: 'show',
  eyebrow: 'Show',
  play: (code: string | null) => (code ? `Play ${code}` : COMMON_COPY.play),
  seasons: 'Seasons',
} as const
